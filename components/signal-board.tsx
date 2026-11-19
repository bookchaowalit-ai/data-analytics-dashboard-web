"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { ChartPanel, Pill, Segmented, Stat } from "@/components/dashboard-shell";
import { WINDOWS, axisTicks, bucketLabel, dayLabel, bucketStarts, newestTimestamp, parseEventsCsv, sampleCsv, segmentBreakdown, summarizeWindow, type AnalyticsEvent, type WindowKey } from "@/lib/analytics";

type Source = { kind: "file"; name: string } | { kind: "demo" };

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PERIODS = (Object.keys(WINDOWS) as WindowKey[]).map((id) => ({ id, label: id }));
const BUCKET_UNIT: Record<WindowKey, string> = { "24H": "hour", "7D": "day", "30D": "day" };
const numberFormat = new Intl.NumberFormat("en-US");
const formatNumber = (value: number) => numberFormat.format(Math.round(value * 100) / 100);
/**
 * A sum without float noise (0.1 + 0.2 → 0.3) and with every digit a double holds: 15 significant digits is all a
 * double keeps exactly, so totals that really differ (…123 vs …124, 0.003 vs 0.004) stay apart and keep the peak.
 */
const exact = (value: number) => Number(value.toPrecision(15));
const valueFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const smallValueFormat = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 3 });
/** A value for display: two decimals, but a non-zero value under 0.01 keeps three significant digits (never 0 or -0). */
export function formatValue(value: number): string {
  const clean = exact(value);
  if (clean === 0) return "0";
  return Math.abs(clean) < 0.01 ? smallValueFormat.format(clean) : valueFormat.format(clean);
}
/** Segment rows rendered at a time; the stats and shares still use every segment. */
export const SEGMENT_PAGE = 50;

/** The interactive board: data source, period switch, stat tiles, chart and segment breakdown. */
export function SignalBoard() {
  const [windowKey, setWindowKey] = useState<WindowKey>("24H");
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [shownSegments, setShownSegments] = useState(SEGMENT_PAGE);
  // Said once per load or clear in a status region that stays in the page, so screen readers hear where figures come from.
  const [announcement, setAnnouncement] = useState("");
  const period = WINDOWS[windowKey].label;
  const Period = period.charAt(0).toUpperCase() + period.slice(1);

  const view = useMemo(() => {
    if (!source) return null;
    const end = newestTimestamp(events);
    const summary = summarizeWindow(events, windowKey);
    const segments = segmentBreakdown(events, windowKey);
    const buckets = summary.buckets.map(exact);
    return {
      end,
      summary,
      buckets,
      hasNegative: buckets.some((value) => value < 0),
      // A share of the net total only means something when nothing pulls it below zero.
      sharesValid: summary.total > 0 && segments.every((row) => row.total >= 0),
      labels: bucketStarts(end, windowKey).map((start) => bucketLabel(start, windowKey)),
      segments,
    };
  }, [events, source, windowKey]);

  const load = (text: string, next: Source) => {
    const result = parseEventsCsv(text);
    setIssues(result.errors);
    setShownSegments(SEGMENT_PAGE);
    if (result.events.length === 0) {
      setEvents([]);
      setSource(null);
      setAnnouncement("");
      return;
    }
    setEvents(result.events);
    setSource(next);
    const count = formatNumber(result.events.length);
    setAnnouncement(next.kind === "demo" ? `Loaded sample data: ${count} rows.` : `Loaded ${next.name}: ${count} rows read.`);
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setIssues(["The file is larger than 10 MB; export a smaller range."]);
      return;
    }
    load(await file.text(), { kind: "file", name: file.name });
  };

  const loadSample = () => load(sampleCsv(Date.now()), { kind: "demo" });
  const clear = () => {
    setEvents([]);
    setSource(null);
    setIssues([]);
    setShownSegments(SEGMENT_PAGE);
    setAnnouncement("Cleared. No data loaded.");
  };
  const pickWindow = (key: WindowKey) => {
    setWindowKey(key);
    setShownSegments(SEGMENT_PAGE);
  };

  const isDemo = source?.kind === "demo";
  const sourceLine = source === null ? "No data loaded" : isDemo ? "Sample data generated in this browser" : source.name;

  return (
    <main id="main" tabIndex={-1} className="ds-main">
      <div className="ds-head">
        <div>
          <h1>Events over time</h1>
          <p>
            {Period} · per {BUCKET_UNIT[windowKey]} · UTC
            {source ? <Pill tone={isDemo ? "grey" : "green"}>{isDemo ? "Sample data" : "Your file"}</Pill> : <Pill tone="amber">No data yet</Pill>}
          </p>
        </div>
        <Segmented label="Period" options={PERIODS} value={windowKey} onChange={pickWindow} />
      </div>

      <section className="ds-panel sl-source" aria-labelledby="source-heading">
        <div className="ds-panel-head">
          <div>
            <h2 id="source-heading">Data source</h2>
            <p>{sourceLine}{source ? ` · ${formatNumber(events.length)} rows read` : ""}</p>
          </div>
        </div>
        <div className="ds-actions">
          <label className="ds-button sl-file">
            Choose CSV file
            <input type="file" className="ds-sr" accept=".csv,text/csv" onChange={onFile} />
          </label>
          <button type="button" className="ds-plain" onClick={loadSample}>Load sample data</button>
          {source || issues.length > 0 ? <button type="button" className="ds-plain" onClick={clear}>Clear</button> : null}
        </div>
        <p className="ds-sr" role="status" aria-live="polite">{announcement}</p>
        <p>A header row with <code>timestamp</code> (ISO 8601 or epoch), and optional <code>segment</code> and <code>value</code> columns. Read in this browser only, up to 10 MB; nothing is uploaded.</p>
        {issues.length > 0 ? (
          <ul className="sl-issues" role="alert">
            {issues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        ) : null}
      </section>

      {view ? (
        <>
          <ul className="ds-stats" aria-label={`${Period} at a glance`}>
            <Stat label="Events" value={formatNumber(view.summary.eventCount)} note="rows in the window" />
            <Stat label="Total value" value={formatValue(view.summary.total)} note="sum of the value column" />
            <Stat label="Segments" value={formatNumber(view.summary.segments)} note="distinct segment values" />
            <Stat
              label="Newest event"
              value={view.summary.lastObservation === null ? "None" : bucketLabel(view.summary.lastObservation, "24H")}
              unit={view.summary.lastObservation === null ? undefined : "UTC"}
              note={view.summary.lastObservation === null ? "nothing in this window" : dayLabel(view.summary.lastObservation)}
            />
          </ul>

          <div className="ds-grid">
            {view.hasNegative ? (
              // The shared chart draws from 0 up, so a bucket below zero would sit on the zero line; list every bucket instead.
              <section className="ds-panel sl-signed" aria-labelledby="signed-heading">
                <div className="ds-panel-head">
                  <div>
                    <h2 id="signed-heading">Value over time</h2>
                    <p>{Period} · sum of value per {BUCKET_UNIT[windowKey]}</p>
                  </div>
                </div>
                <p className="ds-note">Some {BUCKET_UNIT[windowKey]}s sum below zero (refunds, corrections), which the line chart cannot draw, so every {BUCKET_UNIT[windowKey]} is listed with its signed value.</p>
                <div className="ds-table-wrap sl-signed-table" tabIndex={0} role="region" aria-label="Value over time as a table">
                  <table className="ds-table">
                    <thead><tr><th scope="col">{BUCKET_UNIT[windowKey] === "hour" ? "Hour" : "Day"} from (UTC)</th><th scope="col">Value</th></tr></thead>
                    <tbody>
                      {view.buckets.map((value, index) => (
                        <tr key={index}><th scope="row">{view.labels[index]}</th><td>{formatValue(value)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : (
            <ChartPanel
              title="Value over time"
              subtitle={`${Period} · sum of value per ${BUCKET_UNIT[windowKey]}`}
              summary={`Value per ${BUCKET_UNIT[windowKey]}, ${period}: total ${formatValue(view.summary.total)} across ${formatNumber(view.summary.eventCount)} events, highest bucket ${formatValue(Math.max(...view.buckets))}.`}
              values={view.buckets}
              labels={view.labels}
              ticks={axisTicks(windowKey).ticks}
              tickLabels={axisTicks(windowKey).labels}
              max={Math.max(...view.buckets)}
              unit="Value"
              labelHeading={`${BUCKET_UNIT[windowKey] === "hour" ? "Hour" : "Day"} from (UTC)`}
              buckets
            />
            )}

            <section className="ds-panel" aria-labelledby="segments-heading">
              <div className="ds-panel-head">
                <div>
                  <h2 id="segments-heading">Segments</h2>
                  <p>{view.sharesValid ? "Share of value" : "Value"} · {period}</p>
                </div>
              </div>
              {view.segments.length === 0 ? (
                <p className="ds-note">No events fall in this window. Try a longer period.</p>
              ) : (
                <>
                  <ul className="ds-rows">
                    {view.segments.slice(0, shownSegments).map((row) => {
                      const share = view.sharesValid ? Math.round((row.total / view.summary.total) * 100) : null;
                      return (
                        <li key={row.segment} className="ds-row">
                          <span className="ds-row-name">{row.segment || "No segment"}</span>
                          <span className="ds-row-detail">{formatNumber(row.events)} events{share === null ? "" : ` · ${share}% of value`}</span>
                          <span className="ds-row-value">{formatValue(row.total)}</span>
                          {share === null ? null : <span className="ds-meter" aria-hidden="true"><span style={{ width: `${share}%` }} /></span>}
                        </li>
                      );
                    })}
                  </ul>
                  {view.sharesValid ? null : (
                    <p className="ds-note">Shares are left out: {view.summary.total === 0 ? "the values net to zero" : "some segments sum below zero"}, so a share of the total has no clear meaning.</p>
                  )}
                  {view.segments.length > shownSegments ? (
                    <div className="ds-actions sl-more">
                      <span className="sl-more-count">Showing {formatNumber(shownSegments)} of {formatNumber(view.segments.length)} segments, largest first.</span>
                      <button type="button" className="ds-plain" onClick={() => setShownSegments((count) => count + SEGMENT_PAGE)}>
                        Show {formatNumber(Math.min(SEGMENT_PAGE, view.segments.length - shownSegments))} more
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </section>
          </div>

          <p className="ds-note">
            {isDemo
              ? "Sample data: 400 synthetic events made in this browser to show the mechanics. Do not read the trend as real behaviour."
              : "Figures come from your file, computed in this browser. Each window ends at the newest event in the file; reload the page to discard them."}
          </p>
        </>
      ) : (
        <section className="ds-panel sl-empty" aria-labelledby="empty-heading">
          <h2 id="empty-heading">No data yet</h2>
          <p>Choose a CSV export of events to see counts, value, segments and the trend for the last 24 hours, 7 or 30 days. Or load sample data to see how it works first.</p>
          <div className="ds-actions">
            <button type="button" className="ds-button" onClick={loadSample}>Load sample data</button>
          </div>
        </section>
      )}
    </main>
  );
}
