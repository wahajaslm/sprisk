import { expressionInterpreter } from "vega-interpreter";

const refuse = (what: string) => Promise.reject(new Error(`${what} is not fetched: charts draw only the data the step saved`));

/** A Vega loader that fetches nothing. An Altair chart carries its data inline; a spec that
 * names a URL or file is refused, so a chart can never reach the network or the disk. */
const noNetwork = {
  load: (uri: string) => refuse(uri),
  sanitize: (uri: string) => refuse(uri),
  http: (uri: string) => refuse(uri),
  file: (path: string) => refuse(path),
};

/** How sprisk draws an Altair (Vega-Lite) chart: no network, expressions interpreted rather
 * than compiled into code, no export or "open in editor" links, Studio colours. */
export function vegaOptions(color: (token: string) => string) {
  const text = color("--soft");
  const line = color("--line");
  return {
    actions: false as const,
    ast: true as const,
    expr: expressionInterpreter,
    loader: noNetwork,
    renderer: "svg" as const,
    config: {
      background: "transparent",
      axis: { labelColor: text, titleColor: text, gridColor: line, domainColor: line, tickColor: line },
      legend: { labelColor: text, titleColor: text },
      title: { color: text },
      view: { stroke: line },
    },
  };
}
