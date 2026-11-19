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

/** The interactive board: data source, period switch, stat tiles, chart and segment breakdown. */
export function SignalBoard() {
  const [windowKey, setWindowKey] = useState<WindowKey>("24H");
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const period = WINDOWS[windowKey].label;
  const Period = period.charAt(0).toUpperCase() + period.slice(1);

  const view = useMemo(() => {
    if (!source) return null;
    const end = newestTimestamp(events);
    return {
      end,
      summary: summarizeWindow(events, windowKey),
      labels: bucketStarts(end, windowKey).map((start) => bucketLabel(start, windowKey)),
      segments: segmentBreakdown(events, windowKey),
    };
  }, [events, source, windowKey]);

  const load = (text: string, next: Source) => {
    const result = parseEventsCsv(text);
    setIssues(result.errors);
    if (result.events.length === 0) {
      setEvents([]);
      setSource(null);
      return;
    }
    setEvents(result.events);
    setSource(next);
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
        <Segmented label="Period" options={PERIODS} value={windowKey} onChange={setWindowKey} />
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
            <Stat label="Total value" value={formatNumber(view.summary.total)} note="sum of the value column" />
            <Stat label="Segments" value={formatNumber(view.summary.segments)} note="distinct segment values" />
            <Stat
              label="Newest event"
              value={view.summary.lastObservation === null ? "None" : bucketLabel(view.summary.lastObservation, "24H")}
              unit={view.summary.lastObservation === null ? undefined : "UTC"}
              note={view.summary.lastObservation === null ? "nothing in this window" : dayLabel(view.summary.lastObservation)}
            />
          </ul>

          <div className="ds-grid">
            <ChartPanel
              title="Value over time"
              subtitle={`${Period} · sum of value per ${BUCKET_UNIT[windowKey]}`}
              summary={`Value per ${BUCKET_UNIT[windowKey]}, ${period}: total ${formatNumber(view.summary.total)} across ${formatNumber(view.summary.eventCount)} events, highest bucket ${formatNumber(Math.max(...view.summary.buckets))}.`}
              values={view.summary.buckets.map((value) => Math.round(value * 100) / 100)}
              labels={view.labels}
              ticks={axisTicks(windowKey).ticks}
              tickLabels={axisTicks(windowKey).labels}
              max={Math.max(...view.summary.buckets)}
              unit="Value"
              labelHeading={`${BUCKET_UNIT[windowKey] === "hour" ? "Hour" : "Day"} from (UTC)`}
              buckets
            />

            <section className="ds-panel" aria-labelledby="segments-heading">
              <div className="ds-panel-head">
                <div>
                  <h2 id="segments-heading">Segments</h2>
                  <p>Share of value · {period}</p>
                </div>
              </div>
              {view.segments.length === 0 ? (
                <p className="ds-note">No events fall in this window. Try a longer period.</p>
              ) : (
                <ul className="ds-rows">
                  {view.segments.map((row) => {
                    const share = view.summary.total > 0 ? Math.round((row.total / view.summary.total) * 100) : 0;
                    return (
                      <li key={row.segment} className="ds-row">
                        <span className="ds-row-name">{row.segment || "No segment"}</span>
                        <span className="ds-row-detail">{formatNumber(row.events)} events · {share}% of value</span>
                        <span className="ds-row-value">{formatNumber(row.total)}</span>
                        <span className="ds-meter" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, share))}%` }} /></span>
                      </li>
                    );
                  })}
                </ul>
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
