import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { axisTicks, bucketLabel, dayLabel, bucketStarts, newestTimestamp, parseEventsCsv, sampleCsv, segmentBreakdown, splitCsvLine, summarizeWindow } from "../lib/analytics.ts";

const HOUR = 60 * 60 * 1000;

describe("parseEventsCsv", () => {
  it("parses timestamps, segments, and values", () => {
    const { events, errors } = parseEventsCsv(
      "Timestamp,Segment,Value\n2026-09-01T00:00:00Z,organic,2\n1756684800000,direct,\n1756684800,\"ref, paid\",3",
    );
    assert.deepEqual(errors, []);
    assert.equal(events.length, 3);
    assert.equal(events[0].value, 2);
    assert.equal(events[1].value, 1);
    assert.equal(events[2].timestamp, 1756684800000);
    assert.equal(events[2].segment, "ref, paid");
  });

  it("reports missing header and bad rows without throwing", () => {
    assert.match(parseEventsCsv("when,value\n1,2").errors[0], /timestamp/);
    const result = parseEventsCsv("timestamp,value\nnot-a-date,1\n2026-09-01T00:00:00Z,abc\n2026-09-01T00:00:00Z,4");
    assert.equal(result.events.length, 1);
    assert.equal(result.errors.length, 2);
    assert.deepEqual(parseEventsCsv("").errors, ["The file is empty."]);
  });

  it("handles escaped quotes", () => {
    assert.deepEqual(splitCsvLine('a,"b ""q"" c",d'), ["a", 'b "q" c', "d"]);
  });
});

describe("summarizeWindow", () => {
  const now = Date.UTC(2026, 8, 30, 12);
  const events = [
    { timestamp: now - 1 * HOUR, segment: "a", value: 1 },
    { timestamp: now - 2 * HOUR, segment: "b", value: 2 },
    { timestamp: now - 3 * 24 * HOUR, segment: "a", value: 5 },
    { timestamp: now - 40 * 24 * HOUR, segment: "c", value: 9 },
  ];

  it("counts only events inside the window", () => {
    const day = summarizeWindow(events, "24H", now);
    assert.equal(day.total, 3);
    assert.equal(day.eventCount, 2);
    assert.equal(day.segments, 2);
    assert.equal(day.lastObservation, now - HOUR);
    assert.equal(day.buckets.length, 24);
    assert.equal(day.buckets.reduce((a, b) => a + b, 0), 3);
    assert.equal(summarizeWindow(events, "7D", now).total, 8);
    assert.equal(summarizeWindow(events, "30D", now).eventCount, 3);
  });

  it("anchors to the newest event when now is omitted", () => {
    assert.equal(summarizeWindow(events, "24H").lastObservation, now - HOUR);
  });

  it("returns an empty summary for no events", () => {
    const empty = summarizeWindow([], "7D", now);
    assert.equal(empty.total, 0);
    assert.equal(empty.lastObservation, null);
  });
});

describe("window helpers", () => {
  const end = Date.UTC(2026, 10, 19, 13, 5);

  it("finds the newest event and the bucket starts that end there", () => {
    assert.equal(newestTimestamp([]), 0);
    assert.equal(newestTimestamp([{ timestamp: 5, segment: "", value: 1 }, { timestamp: 9, segment: "", value: 1 }]), 9);
    const starts = bucketStarts(end, "24H");
    assert.equal(starts.length, 24);
    assert.equal(starts[0], end - 24 * HOUR);
    assert.equal(starts[23], end - HOUR);
    assert.equal(bucketStarts(end, "30D").length, 30);
  });

  it("labels buckets in UTC, with the date on the longer windows", () => {
    assert.equal(bucketLabel(end, "24H"), "13:05");
    assert.equal(bucketLabel(end, "7D"), "19 Nov 13:05");
    assert.equal(bucketLabel(Date.UTC(2026, 0, 2, 3, 4), "30D"), "2 Jan 03:04");
    assert.equal(dayLabel(end), "19 Nov 2026");
  });

  it("names the start, middle and end of each axis", () => {
    assert.deepEqual(axisTicks("24H"), { ticks: [0, 12, 24], labels: ["−24h", "−12h", "newest"] });
    assert.deepEqual(axisTicks("7D"), { ticks: [0, 4, 7], labels: ["−7d", "−3d", "newest"] });
    assert.deepEqual(axisTicks("30D"), { ticks: [0, 15, 30], labels: ["−30d", "−15d", "newest"] });
  });

  it("breaks the window down by segment, largest total first", () => {
    const events = [
      { timestamp: end, segment: "organic", value: 2 },
      { timestamp: end - HOUR, segment: "direct", value: 5 },
      { timestamp: end - 2 * HOUR, segment: "organic", value: 4 },
      { timestamp: end - 2 * HOUR, segment: "", value: 1 },
      { timestamp: end - 48 * HOUR, segment: "old", value: 99 },
    ];
    assert.deepEqual(segmentBreakdown(events, "24H"), [
      { segment: "organic", events: 2, total: 6 },
      { segment: "direct", events: 1, total: 5 },
      { segment: "", events: 1, total: 1 },
    ]);
    assert.equal(segmentBreakdown(events, "7D")[0].segment, "old");
    assert.deepEqual(segmentBreakdown([], "24H"), []);
  });

  it("produces a deterministic parseable sample", () => {
    const now = Date.UTC(2026, 8, 30);
    const sample = sampleCsv(now, 30);
    assert.equal(sample, sampleCsv(now, 30));
    assert.equal(parseEventsCsv(sample).events.length, 30);
  });
});

describe("CSV edge cases", () => {
  it("splits rows on lone CR and U+2028, but not inside quoted fields", () => {
    const { events, errors } = parseEventsCsv(
      'timestamp,segment\r2026-09-01T00:00:00Z,a 2026-09-01T01:00:00Z,"multi\nline"\r\n2026-09-01T02:00:00Z,c',
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(events.map((event) => event.segment), ["a", "multi\nline", "c"]);
  });

  it("rejects hex, binary, Infinity and locale-comma values instead of misreading them", () => {
    const { events, errors } = parseEventsCsv(
      'timestamp,value\n2026-09-01T00:00:00Z,0x10\n2026-09-01T00:00:00Z,0b11\n2026-09-01T00:00:00Z,Infinity\n2026-09-01T00:00:00Z,"12,50"\n2026-09-01T00:00:00Z,-2.5\n2026-09-01T00:00:00Z,1e3',
    );
    assert.equal(errors.length, 4);
    assert.deepEqual(events.map((event) => event.value), [-2.5, 1000]);
  });

  it("rejects impossible dates and loose strings the JS engine would guess at", () => {
    const { events, errors } = parseEventsCsv("timestamp\n2026-02-30\n5\n2026-02-28T24:00:00Z\n2024-02-29");
    assert.equal(errors.length, 3);
    assert.deepEqual(events.map((event) => event.timestamp), [Date.UTC(2024, 1, 29)]);
  });

  it("reads zone-less date-times as UTC whatever the viewer's time zone", () => {
    const previous = process.env.TZ;
    process.env.TZ = "Asia/Bangkok";
    try {
      const { events } = parseEventsCsv("timestamp\n2026-09-30 10:00\n2026-09-30T10:00:00+07:00");
      assert.deepEqual(events.map((event) => event.timestamp), [Date.UTC(2026, 8, 30, 10), Date.UTC(2026, 8, 30, 3)]);
    } finally {
      process.env.TZ = previous;
    }
  });
});
