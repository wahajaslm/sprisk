import { describe, expect, it } from "vitest";

import { themed } from "../src/views/plotlyTheme.ts";

describe("Plotly figures in the Studio theme", () => {
  it("makes room for axis titles and tick labels, keeping Python's titles", () => {
    const layout = themed({ yaxis: { title: { text: "Sample Number" } } }, () => "#000");
    expect(layout.yaxis).toMatchObject({ automargin: true, title: { text: "Sample Number" } });
    expect(layout.xaxis).toMatchObject({ automargin: true });
  });
});
