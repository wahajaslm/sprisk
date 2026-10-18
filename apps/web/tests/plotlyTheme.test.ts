import type Plotly from "plotly.js-dist-min";
import { describe, expect, it } from "vitest";

import { thumbnail, themed } from "../src/views/plotlyTheme.ts";

describe("Plotly figures in the Studio theme", () => {
  it("makes room for axis titles and tick labels, keeping Python's titles", () => {
    const layout = themed({ yaxis: { title: { text: "Sample Number" } } }, () => "#000");
    expect(layout.yaxis).toMatchObject({ automargin: true, title: { text: "Sample Number" } });
    expect(layout.xaxis).toMatchObject({ automargin: true });
  });

  it("themes every subplot's axes, not only the first", () => {
    const layout = themed({ xaxis2: { title: { text: "age" } }, yaxis3: {} } as Partial<Plotly.Layout>, () => "#123");
    expect(layout).toMatchObject({ xaxis2: { gridcolor: "#123", title: { text: "age" } }, yaxis3: { gridcolor: "#123" } });
  });

  it("draws a card preview bare: no title, legend, axis labels or colour bar, thin margins", () => {
    const layout = themed({ title: { text: "Correlation" }, xaxis: { title: { text: "age" } } }, () => "#000");
    const small = thumbnail({ data: [{ type: "heatmap", z: [[1]] }], layout });
    expect(small.layout.title).toBeUndefined();
    expect(small.layout).toMatchObject({ showlegend: false, margin: { l: 2, r: 2, t: 2, b: 2 }, paper_bgcolor: "rgba(0,0,0,0)" });
    expect(small.layout.xaxis).toMatchObject({ showticklabels: false, automargin: false, title: { text: "" } });
    expect(small.layout.yaxis).toMatchObject({ showticklabels: false, automargin: false, title: { text: "" } });
    expect(small.data[0]).toMatchObject({ showscale: false });
  });
});
