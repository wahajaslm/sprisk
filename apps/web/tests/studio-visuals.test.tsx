import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KeyValues, LineChart, MeterRows, ParallelChart, SolidBars } from "../src/components/ui/StudioVisuals.tsx";

describe("the design system's main-screen visuals", () => {
  it("draws solid bars scaled to the tallest, red where marked", () => {
    render(<SolidBars name="Missing share per column" values={[0.4, 0.2, 0]} warn={(i) => i === 0} />);
    const bars = within(screen.getByRole("img", { name: "Missing share per column" })).getAllByTestId("bar");
    expect(bars.map((b) => b.style.height)).toEqual(["100%", "50%", "0%"]);
    expect(bars[0]).toHaveClass("warn");
    expect(bars[1]).not.toHaveClass("warn");
  });

  it("lists each name with a bar and its value, red where marked", () => {
    render(<MeterRows label="Missing per column" rows={[{ name: "umami_score", share: 0.78, value: "31.2%", warn: true }, { name: "hydro", share: 0.12, value: "4.8%" }]} />);
    const rows = within(screen.getByRole("list", { name: "Missing per column" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("umami_score31.2%");
    expect(rows[0]).toHaveClass("warn");
    expect(within(rows[1]!).getByTestId("fill").style.width).toBe("12%");
  });

  it("lists settings as name and value", () => {
    render(<KeyValues label="Search space" rows={[["n_estimators", "100 – 800"]]} />);
    expect(screen.getByRole("list", { name: "Search space" })).toHaveTextContent("n_estimators100 – 800");
  });

  it("draws each series as a line, the second dimmer, with a line swatch per series", () => {
    render(<LineChart name="Folds" series={[{ name: "A", values: [0.9, 0.8] }, { name: "B", values: [0.7, 0.6] }]} xLabel="fold" />);
    const chart = screen.getByRole("img", { name: "Folds" });
    expect(chart.querySelectorAll("polyline")).toHaveLength(2);
    expect(screen.getByRole("list", { name: "Folds legend" })).toHaveTextContent("AB");
  });

  it("draws every trial as a faint line and the best one bright", () => {
    render(<ParallelChart name="Trials" axes={["depth", "score"]} lines={[[0, 0.2], [1, 1]]} best={1} />);
    const lines = screen.getByRole("img", { name: "Trials" }).querySelectorAll("polyline");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toHaveClass("best");
  });
});
