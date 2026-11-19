/**
 * Local-only event analytics: parse a CSV export in the browser and summarise
 * it per time window. Nothing is uploaded; the page keeps data in memory.
 *
 * CSV contract: a header row containing `timestamp` (ISO 8601 or epoch ms),
 * and optionally `segment` and `value` (number, defaults to 1).
 */

export interface AnalyticsEvent {
  timestamp: number;
  segment: string;
  value: number;
}

export interface ParseResult {
  events: AnalyticsEvent[];
  errors: string[];
}

export const WINDOWS = {
  "24H": { label: "last 24 hours", mark: "01", durationMs: 24 * 60 * 60 * 1000, buckets: 24 },
  "7D": { label: "last 7 days", mark: "07", durationMs: 7 * 24 * 60 * 60 * 1000, buckets: 7 },
  "30D": { label: "last 30 days", mark: "30", durationMs: 30 * 24 * 60 * 60 * 1000, buckets: 30 },
} as const;

export type WindowKey = keyof typeof WINDOWS;

const MAX_ROWS = 100_000;

/** Split one CSV line, honouring double-quoted fields with escaped quotes. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/**
 * Split CSV text into records on CRLF, LF, lone CR (classic Mac exports) or
 * U+2028/U+2029, but never inside a double-quoted field, so a quoted segment
 * containing a line break stays in its row.
 */
export function splitCsvRecords(text: string): string[] {
  const records: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      quoted = !quoted;
      current += char;
    } else if (!quoted && (char === "\n" || char === "\r" || char === "\u2028" || char === "\u2029")) {
      records.push(current);
      current = "";
      if (char === "\r" && text[i + 1] === "\n") i += 1;
    } else {
      current += char;
    }
  }
  records.push(current);
  return records;
}

const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/i;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Epoch seconds (10 digits) / milliseconds (11-13 digits), or an ISO 8601
 * date / date-time. Date-times without an offset are read as UTC (the chart is
 * labelled UTC) instead of the viewer's local zone. Impossible calendar dates
 * ("2026-02-30") and loose strings the JS engine would guess at ("5" -> 2001)
 * are rejected.
 */
export function parseTimestamp(raw: string): number | null {
  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw);
    return raw.length === 10 ? numeric * 1000 : numeric;
  }
  const match = ISO_TIMESTAMP.exec(raw);
  if (!match) return null;
  const [, y, mo, d, h = "00", mi = "00", sec = "00", zone] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (Number(h) > 23 || Number(mi) > 59 || Number(sec) > 59) return null;
  const normalized = raw.replace(" ", "T");
  const parsed = Date.parse(match[4] === undefined ? normalized : zone ? normalized : `${normalized}Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Plain decimal numbers only. `Number()` would also accept hex ("0x10" -> 16),
 * binary/octal literals and "Infinity"; those are rejected as typos.
 */
export function parseValue(raw: string): number | null {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function parseEventsCsv(text: string): ParseResult {
  const lines = splitCsvRecords(text.replace(/^\uFEFF/, "")).filter((line) => line.trim() !== "");
  if (lines.length === 0) return { events: [], errors: ["The file is empty."] };

  const header = splitCsvLine(lines[0]).map((cell) => cell.toLowerCase());
  const tsIndex = header.indexOf("timestamp");
  if (tsIndex === -1) return { events: [], errors: ['Header row must include a "timestamp" column.'] };
  const segmentIndex = header.indexOf("segment");
  const valueIndex = header.indexOf("value");

  const events: AnalyticsEvent[] = [];
  const errors: string[] = [];
  const rows = lines.slice(1, MAX_ROWS + 1);
  if (lines.length - 1 > MAX_ROWS) errors.push(`Only the first ${MAX_ROWS} rows were read.`);

  rows.forEach((line, index) => {
    const cells = splitCsvLine(line);
    const rowNumber = index + 2;
    const timestamp = parseTimestamp(cells[tsIndex] ?? "");
    if (timestamp === null) {
      if (errors.length < 20) errors.push(`Row ${rowNumber}: invalid timestamp.`);
      return;
    }
    let value = 1;
    if (valueIndex !== -1 && (cells[valueIndex] ?? "") !== "") {
      const parsedValue = parseValue(cells[valueIndex]);
      if (parsedValue === null) {
        if (errors.length < 20) errors.push(`Row ${rowNumber}: value is not a number.`);
        return;
      }
      value = parsedValue;
    }
    const segment = segmentIndex === -1 ? "" : (cells[segmentIndex] ?? "");
    events.push({ timestamp, segment, value });
  });

  return { events, errors };
}

export interface WindowSummary {
  total: number;
  eventCount: number;
  segments: number;
  lastObservation: number | null;
  buckets: number[];
}

/**
 * Summarise events inside the window ending at `now` (defaults to the newest
 * event so historical exports still show a meaningful window).
 */
export function summarizeWindow(events: readonly AnalyticsEvent[], key: WindowKey, now?: number): WindowSummary {
  const { durationMs, buckets: bucketCount } = WINDOWS[key];
  const end = now ?? newestTimestamp(events);
  const start = end - durationMs;
  const bucketSize = durationMs / bucketCount;
  const buckets = new Array<number>(bucketCount).fill(0);
  const segments = new Set<string>();
  let total = 0;
  let eventCount = 0;
  let lastObservation: number | null = null;

  for (const event of events) {
    if (event.timestamp <= start || event.timestamp > end) continue;
    const index = Math.min(bucketCount - 1, Math.floor((event.timestamp - start) / bucketSize));
    buckets[index] += event.value;
    total += event.value;
    eventCount += 1;
    if (event.segment) segments.add(event.segment);
    if (lastObservation === null || event.timestamp > lastObservation) lastObservation = event.timestamp;
  }

  return { total, eventCount, segments: segments.size, lastObservation, buckets };
}

/** The newest event's timestamp: every window ends there, so a historical export still shows its own last day. */
export function newestTimestamp(events: readonly AnalyticsEvent[]): number {
  return events.reduce((max, event) => Math.max(max, event.timestamp), 0);
}

/** Start time of each bucket in the window ending at `end` (oldest first). */
export function bucketStarts(end: number, key: WindowKey): number[] {
  const { durationMs, buckets } = WINDOWS[key];
  const size = durationMs / buckets;
  return Array.from({ length: buckets }, (_, index) => end - durationMs + index * size);
}

const pad = (value: number) => String(value).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "13:05" for the 24-hour window, "19 Nov 13:05" for the longer ones; always UTC, like the parser. */
export function bucketLabel(timestamp: number, key: WindowKey): string {
  const date = new Date(timestamp);
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  return key === "24H" ? time : `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${time}`;
}

/** "19 Nov 2026" (UTC): the date under the newest event's time. */
export function dayLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Short relative labels for the start, middle and end edges of the axis ("−24h", "−12h", "newest"). */
export function axisTicks(key: WindowKey): { ticks: number[]; labels: string[] } {
  const { buckets } = WINDOWS[key];
  const middle = Math.round(buckets / 2);
  const unit = key === "24H" ? "h" : "d";
  return { ticks: [0, middle, buckets], labels: [`−${buckets}${unit}`, `−${buckets - middle}${unit}`, "newest"] };
}

export interface SegmentRow {
  segment: string;
  events: number;
  total: number;
}

/** Events and summed value per segment inside the window, largest total first ("" is rows without a segment). */
export function segmentBreakdown(events: readonly AnalyticsEvent[], key: WindowKey, now?: number): SegmentRow[] {
  const end = now ?? newestTimestamp(events);
  const start = end - WINDOWS[key].durationMs;
  const rows = new Map<string, SegmentRow>();
  for (const event of events) {
    if (event.timestamp <= start || event.timestamp > end) continue;
    const row = rows.get(event.segment) ?? { segment: event.segment, events: 0, total: 0 };
    row.events += 1;
    row.total += event.value;
    rows.set(event.segment, row);
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || a.segment.localeCompare(b.segment));
}

/** Deterministic synthetic sample for the "load demo" action (clearly labelled in UI). */
export function sampleCsv(now: number, count = 400): string {
  const segments = ["organic", "referral", "direct"];
  const rows = ["timestamp,segment,value"];
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < count; i += 1) {
    const age = Math.floor(random() * 30 * 24 * 60 * 60 * 1000);
    rows.push(`${new Date(now - age).toISOString()},${segments[i % segments.length]},1`);
  }
  return rows.join("\n");
}
