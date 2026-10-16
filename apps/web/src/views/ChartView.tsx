import type { ChartReport } from "@sprisk/contracts";
import * as echarts from "echarts";
import { useEffect, useRef } from "react";

/** Studio tokens, read once from the page so charts follow the theme (cockpit.css). */
function tokens() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { ink: v("--ink"), muted: v("--muted"), faint: v("--faint"), line: v("--line"), mark: v("--dim"), panel: v("--panel") };
}

function option(chart: ChartReport): echarts.EChartsCoreOption {
  const t = tokens();
  const axis = { axisLine: { lineStyle: { color: t.line } }, axisLabel: { color: t.muted }, splitLine: { lineStyle: { color: t.line } } };
  const base = {
    animation: false,
    grid: { left: 56, right: 24, top: 28, bottom: 44 },
    tooltip: { trigger: chart.kind === "scatter" ? "item" : "axis", backgroundColor: t.panel, borderColor: t.line, textStyle: { color: t.ink } },
    textStyle: { fontFamily: "Geist Variable, sans-serif" },
  };
  const named = (name: string, extra: object = {}) => ({ name, nameLocation: "middle", nameGap: 30, nameTextStyle: { color: t.muted }, ...axis, ...extra });
  // Every category gets its label; long ones wrap instead of hiding their neighbours.
  const categories = (data: string[]) => ({ type: "category", data, axisLabel: { color: t.muted, interval: 0, width: 120, overflow: "break" } });
  switch (chart.kind) {
    case "histogram": {
      const bins = chart.bins ?? [];
      return {
        ...base,
        xAxis: named(chart.x, { type: "category", data: bins.map((b) => b.lower.toPrecision(4)) }),
        yAxis: named("rows", { type: "value" }),
        series: [{ type: "bar", barCategoryGap: "4%", itemStyle: { color: t.mark }, data: bins.map((b) => b.count) }],
      };
    }
    case "bar": {
      const bars = chart.bars ?? [];
      return {
        ...base,
        xAxis: named(chart.x, categories(bars.map((b) => b.x))),
        yAxis: named(chart.y ? `mean ${chart.y}` : "rows", { type: "value" }),
        series: [{ type: "bar", itemStyle: { color: t.mark }, data: bars.map((b) => b.value) }],
      };
    }
    case "box": {
      const groups = chart.groups ?? [];
      return {
        ...base,
        xAxis: named(chart.y ? chart.x : "", { ...categories(groups.map((g) => g.group)), nameGap: 44 }),
        yAxis: named(chart.y ?? chart.x, { type: "value", scale: true }),
        series: [
          {
            type: "boxplot",
            itemStyle: { color: "transparent", borderColor: t.mark },
            data: groups.map((g) => [g.min, g.q1, g.median, g.q3, g.max]),
          },
        ],
      };
    }
    case "scatter":
    case "line":
      return {
        ...base,
        // Dates arrive as ISO text (ADR-0023); ECharts reads them on a time axis.
        xAxis: named(chart.x, typeof chart.points?.[0]?.[0] === "string" ? { type: "time" } : { type: "value", scale: true }),
        yAxis: named(chart.y ?? "", { type: "value", scale: true }),
        series: [
          chart.kind === "scatter"
            ? { type: "scatter", symbolSize: 4, itemStyle: { color: t.mark, opacity: 0.7 }, data: chart.points ?? [] }
            : { type: "line", showSymbol: false, lineStyle: { color: t.mark, width: 1.2 }, data: chart.points ?? [] },
        ],
      };
  }
}

/** Draws a chart step's aggregated numbers. Lazy-loaded: ECharts is heavy (apps/web rules). */
export default function ChartView({ chart }: { chart: ChartReport }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!box.current) return;
    const drawn = echarts.init(box.current, undefined, { renderer: "canvas" });
    drawn.setOption(option(chart));
    const resize = new ResizeObserver(() => drawn.resize());
    resize.observe(box.current);
    return () => {
      resize.disconnect();
      drawn.dispose();
    };
  }, [chart]);
  const label = `${chart.kind} of ${chart.x}${chart.y ? ` and ${chart.y}` : ""}`;
  return <figure ref={box} className="chart-figure" aria-label={label} data-kind={chart.kind} />;
}
