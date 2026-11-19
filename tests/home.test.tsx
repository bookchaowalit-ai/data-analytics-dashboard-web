// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import RootLayout, { metadata } from "@/app/layout";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { MAX_FILE_BYTES } from "@/components/signal-board";

vi.mock("next/font/google", () => ({ Geist: () => ({ variable: "font-geist" }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.UTC(2026, 10, 19, 12, 0);
let root: Root;
let host: HTMLDivElement;
const $ = <T extends Element = HTMLElement>(selector: string) => host.querySelector(selector) as T | null;
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const press = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const stats = () => [...host.querySelectorAll(".ds-stat")].map((tile) => tile.textContent);
const upload = async (file: File) => {
  const input = $('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Home />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("Signal Ledger on the Dashboard shell", () => {
  it("opens with an honest empty state instead of placeholder figures", () => {
    expect($("h1")?.textContent).toBe("Events over time");
    expect($(".ds-head .ds-pill")?.textContent).toBe("No data yet");
    expect($(".sl-empty h2")?.textContent).toBe("No data yet");
    expect($(".ds-stats")).toBeNull();
    expect($("svg")).toBeNull();
    expect(button("Clear")).toBeUndefined();
    expect(host.querySelector("button:disabled")).toBeNull();
    expect($(".ds-skip")?.getAttribute("href")).toBe("#main");
    const links = [...host.querySelectorAll(".ds-foot a")].map((a) => a.getAttribute("href"));
    expect(links).toContain("https://bookchaowalit.com/");
    expect(links).toContain("https://github.com/bookchaowalit-ai/data-analytics-dashboard-web");
  });

  it("loads the sample from the empty state and labels it as sample data", () => {
    press($(".sl-empty .ds-button")!);
    expect($(".ds-head .ds-pill")?.textContent).toBe("Sample data");
    expect($("#source-heading + p")?.textContent).toBe("Sample data generated in this browser · 400 rows read");
    expect(stats()).toHaveLength(4);
    expect(stats()[0]).toMatch(/^Events\d+rows in the window$/);
    expect(stats()[3]).toMatch(/^Newest event\d\d:\d\dUTC\d+ Nov 2026$/);
    expect(host.textContent).toContain("Do not read the trend as real behaviour");
    expect([...host.querySelectorAll(".ds-chart-x span")].map((s) => s.textContent)).toEqual(["−24h", "−12h", "newest"]);
    expect([...host.querySelectorAll(".ds-rows .ds-row-name")].map((s) => s.textContent).sort()).toEqual(["direct", "organic", "referral"]);
  });

  it("switches the period and recomputes the window", () => {
    press(button("Load sample data")!);
    const events24 = stats()[0];
    press(button("30D")!);
    expect(button("30D")?.getAttribute("aria-pressed")).toBe("true");
    expect(stats()[0]).toBe("Events400rows in the window");
    expect(stats()[0]).not.toBe(events24);
    expect($(".ds-head p")?.textContent).toContain("Last 30 days · per day · UTC");
    expect([...host.querySelectorAll(".ds-chart-x span")].map((s) => s.textContent)).toEqual(["−30d", "−15d", "newest"]);
    press(button("7D")!);
    expect($(".ds-table thead")?.textContent).toBe("Day from (UTC)Value");
    expect(host.querySelectorAll(".ds-table tbody tr")).toHaveLength(7);
  });

  it("reads an uploaded file, names it and clears back to empty", async () => {
    await upload(new File(["timestamp,segment,value\n2026-11-19T10:00:00Z,web,3\n2026-11-19T11:30:00Z,,2\nbad,web,1"], "events.csv", { type: "text/csv" }));
    expect($(".ds-head .ds-pill")?.textContent).toBe("Your file");
    expect($("#source-heading + p")?.textContent).toBe("events.csv · 2 rows read");
    expect($(".sl-issues")?.textContent).toBe("Row 4: invalid timestamp.");
    expect(stats()).toEqual(["Events2rows in the window", "Total value5sum of the value column", "Segments1distinct segment values", "Newest event11:30UTC19 Nov 2026"]);
    expect([...host.querySelectorAll(".ds-rows .ds-row")].map((r) => r.textContent)).toEqual(["web1 events · 60% of value3", "No segment1 events · 40% of value2"]);
    expect(host.textContent).toContain("Figures come from your file");
    press(button("Clear")!);
    expect($(".sl-empty")).not.toBeNull();
    expect($(".sl-issues")).toBeNull();
  });

  it("refuses an oversized or unusable file without losing the empty state", async () => {
    const big = new File(["x"], "big.csv");
    Object.defineProperty(big, "size", { value: MAX_FILE_BYTES + 1 });
    await upload(big);
    expect($(".sl-issues")?.textContent).toContain("larger than 10 MB");
    await upload(new File(["when,value\n1,2"], "nope.csv"));
    expect($(".sl-issues")?.textContent).toContain('"timestamp"');
    expect($(".sl-empty")).not.toBeNull();
    expect(button("Clear")).toBeDefined();
    // No file chosen (the picker was cancelled): nothing changes.
    const input = $('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect($(".sl-empty")).not.toBeNull();
  });

  it("ends every window at the newest event, so an old row only counts in the longer windows", async () => {
    await upload(new File(["timestamp\n2026-11-19T10:00:00Z\n2026-10-01T10:00:00Z"], "gap.csv"));
    expect(stats()[0]).toBe("Events1rows in the window");
    press(button("30D")!);
    expect(stats()[0]).toBe("Events1rows in the window");
    expect([...host.querySelectorAll(".ds-rows .ds-row-name")].map((s) => s.textContent)).toEqual(["No segment"]);
  });
});

describe("review fixes 2026-11-19", () => {
  const csv = (rows: string[], name = "f.csv") => new File([["timestamp,segment,value", ...rows].join("\n")], name, { type: "text/csv" });
  const segmentRows = () => [...host.querySelectorAll("section[aria-labelledby='segments-heading'] .ds-row")];

  it("keeps a bucket that sums below zero out of the line chart and lists it as signed values instead", async () => {
    await upload(csv(["2026-11-19T09:00:00Z,web,5", "2026-11-19T11:00:00Z,web,-20"]));
    expect($(".ds-chart-panel")).toBeNull();
    const panel = $(".sl-signed")!;
    expect(panel.textContent).toContain("below zero");
    const cells = [...panel.querySelectorAll(".ds-table td")].map((td) => td.textContent);
    expect(cells).toContain("-20");
    expect(cells).toContain("5");
  });

  it("charts the real bucket values, so tiny values keep their order and the peak", async () => {
    await upload(csv(["2026-11-19T09:00:00Z,web,0.003", "2026-11-19T11:00:00Z,web,0.004"]));
    const cells = [...host.querySelectorAll(".ds-chart-panel .ds-table td")].map((td) => td.textContent);
    expect(cells).toContain("0.003");
    expect(host.querySelector(".ds-chart-panel tr[data-peak] td")?.textContent).toBe("0.004 (peak)");
  });

  it("renders segments 50 at a time while the stats still count all of them", async () => {
    await upload(csv(Array.from({ length: 120 }, (_, i) => `2026-11-19T11:00:00Z,s${i},1`)));
    expect(stats()[2]).toBe("Segments120distinct segment values");
    expect(segmentRows()).toHaveLength(50);
    press(button("Show 50 more")!);
    expect(segmentRows()).toHaveLength(100);
    press(button("Show 20 more")!);
    expect(segmentRows()).toHaveLength(120);
    expect(button("Show 20 more")).toBeUndefined();
    press(button("7D")!);
    expect(segmentRows()).toHaveLength(50);
  });

  it("leaves out shares and bars when a share of the net total has no meaning", async () => {
    await upload(csv(["2026-11-19T10:00:00Z,in,5", "2026-11-19T10:00:00Z,out,-5"]));
    expect(segmentRows().map((row) => row.textContent)).toEqual(["in1 events5", "out1 events-5"]);
    expect(host.querySelector("section[aria-labelledby='segments-heading'] .ds-meter")).toBeNull();
    expect($("section[aria-labelledby='segments-heading']")?.textContent).toContain("Shares are left out");
  });

  it("announces each load and clear in a polite status region that stays in the page", async () => {
    const status = () => $(".sl-source [role='status']");
    expect(status()?.getAttribute("aria-live")).toBe("polite");
    expect(status()?.textContent).toBe("");
    await upload(csv(["2026-11-19T10:00:00Z,web,3", "2026-11-19T11:30:00Z,,2"], "events.csv"));
    expect(status()?.textContent).toBe("Loaded events.csv: 2 rows read.");
    press(button("Load sample data")!);
    expect(status()?.textContent).toBe("Loaded sample data: 400 rows.");
    press(button("Clear")!);
    expect(status()?.textContent).toBe("Cleared. No data loaded.");
  });
});

describe("layout and metadata", () => {
  it("uses Geist on <html> and the site's own domain", () => {
    expect(renderToString(<RootLayout><p>child</p></RootLayout>)).toContain('<html lang="en" class="font-geist">');
    expect(String(metadata.metadataBase)).toBe("https://analytics-dashboard.bookchaowalit.com/");
    expect(sitemap().map((entry) => entry.url)).toEqual(["https://analytics-dashboard.bookchaowalit.com"]);
    expect(robots().sitemap).toBe("https://analytics-dashboard.bookchaowalit.com/sitemap.xml");
  });
});
