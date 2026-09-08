import './ValuationWorkspace.css';

/** The exact same self-contained artifact serves both the workbench and HTML export. */
export function ValuationWorkspace() {
  return <iframe
    className="awb-valuation-frame"
    src="/artifacts/market-valuation.html?embed=1"
    title="大盘估值分位监控"
    data-testid="valuation-frame"
  />;
}
