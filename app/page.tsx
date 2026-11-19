import { DashFoot, DashTop } from "@/components/dashboard-shell";
import { SignalBoard } from "@/components/signal-board";

const SOURCE_URL = "https://github.com/bookchaowalit-ai/data-analytics-dashboard-web";

// Server page: the top bar and footer are plain HTML; the board (file, period, figures) is a client component.
export default function Home() {
  return (
    <div className="ds">
      <a className="ds-skip" href="#main">Skip to content</a>
      <DashTop name="Signal Ledger" tagline="Event analytics from your own CSV" />
      <SignalBoard />
      <DashFoot source={SOURCE_URL} />
    </div>
  );
}
