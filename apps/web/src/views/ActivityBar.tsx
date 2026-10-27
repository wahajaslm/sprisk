import { NAV, NAV_LABEL, type Nav, useSelection } from "../workbench/selection.ts";
import { ink, P } from "../styles/palette.ts";

/** The design's rail icons (designx main screen), three paths each on a 16px grid. Objective has
 * none there and takes the design's decision rings. */
const RAIL_ICON: Record<Nav, readonly [string, string, string]> = {
  Objective: ["M1.5 8a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0", "M4.6 8a3.4 3.4 0 1 0 6.8 0a3.4 3.4 0 1 0 -6.8 0", "M7.2 8a.8.8 0 1 0 1.6 0a.8.8 0 1 0 -1.6 0"],
  Flow: ["M3 4h4v3H3zM9 9h4v3H9z", "M7 5.5h1.5a1 1 0 0 1 1 1V9", ""],
  Datasets: ["M3 4a5 2 0 1 0 10 0a5 2 0 1 0 -10 0", "M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4", "M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"],
  Notebooks: ["M4 2.5h7.5a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4z", "M4 2.5v11M6.5 5.5h4M6.5 8h4", ""],
  Methodology: ["M8 2l5 2v4c0 3-2.2 5-5 6c-2.8-1-5-3-5-6V4z", "M5.8 8l1.6 1.6L10.4 6.6", ""],
  Experiments: ["M6 2v4L3 12.5a1 1 0 0 0 .9 1.5h8.2a1 1 0 0 0 .9-1.5L10 6V2", "M5 2h6M4.5 10h7", ""],
  Deploy: ["M8 13.5V6", "M5 9l3-3 3 3", "M3 3h10"],
  Reports: ["M4.5 1.5h5l3 3v9a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z", "M9.5 1.5v3h3", "M5.5 8.5h5M5.5 11h3.5"],
  Settings: ["M8 5.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5", "M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4", ""],
};

/** The design's 48px icon rail: one icon per page, Settings at the bottom. */
export function ActivityBar() {
  const { nav, setNav } = useSelection();
  const item = (tab: Nav) => {
    const on = tab === nav;
    const [p1, p2, p3] = RAIL_ICON[tab];
    return (
      <button
        key={tab}
        type="button"
        className="dx-btn dx-h-text"
        aria-label={NAV_LABEL[tab]}
        aria-current={on ? "page" : undefined}
        title={NAV_LABEL[tab]}
        onClick={() => setNav(tab)}
        style={{ position: "relative", width: "36px", height: "36px", borderRadius: "var(--r-md,8px)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: on ? P.t0 : P.t3, background: on ? ink(0.08) : "transparent" }}
      >
        <span style={{ position: "absolute", left: "-6px", top: "9px", bottom: "9px", width: "2px", borderRadius: "1px", background: on ? P.t0 : "transparent" }} />
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={p1} />
          <path d={p2} />
          <path d={p3} />
        </svg>
      </button>
    );
  };

  return (
    <nav aria-label="Navigation Rail" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", padding: "8px 0", background: "var(--bg-app,#0a0a0a)", minHeight: "0" }}>
      {NAV.filter((t) => t !== "Settings").map(item)}
      <span style={{ flex: "1" }} />
      {item("Settings")}
    </nav>
  );
}
