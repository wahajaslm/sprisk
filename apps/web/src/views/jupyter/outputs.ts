import type { DisplayItem, TablePage } from "@sprisk/contracts";
import type * as nbformat from "@jupyterlab/nbformat";

/** Jupyter's mime types for Plotly and Altair, so a downloaded notebook draws them too. */
export const PLOTLY_MIME = "application/vnd.plotly.v1+json";
export const VEGALITE_MIME = "application/vnd.vegalite.v5+json";

const FIGURE_MIME = { svg: "image/svg+xml", plotly_json: PLOTLY_MIME, vega_lite_json: VEGALITE_MIME } as const;

/** What a code step showed, as the outputs Jupyter shows under a cell (ADR-0034). */
export function displayOutputs(items: DisplayItem[]): nbformat.IOutput[] {
  return items.map((item, i): nbformat.IOutput => {
    if (item.kind === "text") return { output_type: "stream", name: item.channel ?? "stdout", text: item.text ?? "" };
    if (item.kind === "table" && item.table) return display({ "text/html": tableHtml(item.table), "text/plain": `${item.table.rows.length} of ${item.table.total_rows} rows` });
    if (item.kind === "figure" && item.figure) {
      const { format, content } = item.figure;
      return display({ [FIGURE_MIME[format]]: format === "svg" ? content : (JSON.parse(content) as nbformat.IMimeBundle[string]) });
    }
    if (item.kind === "image" && item.png_base64) return display({ "image/png": item.png_base64 });
    return { output_type: "stream", name: "stderr", text: `Output item ${i + 1} (${item.kind}) has no content.\n` };
  });
}

/** A failed step, shown as Jupyter shows an exception. */
export const errorOutput = (error: { code: string; message: string }): nbformat.IError => ({
  output_type: "error",
  ename: error.code,
  evalue: error.message,
  traceback: [`${error.code}: ${error.message}`],
});

/** A table a built-in step made: its name and size. Its rows are in Data, never loaded here. */
export const tableSizeOutput = (name: string, rows: number, columns: number): nbformat.IDisplayData =>
  display({ "text/plain": `${name}: ${rows} rows × ${columns} columns` });

function display(data: nbformat.IMimeBundle): nbformat.IDisplayData {
  return { output_type: "display_data", data, metadata: {} };
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A page of rows as pandas writes it, so JupyterLab styles it as a DataFrame. Every value is
 * escaped: dataset text is untrusted (rule 7). */
function tableHtml(page: TablePage): string {
  const head = page.columns.map((c) => `<th>${escape(c.name)}</th>`).join("");
  const body = page.rows
    .map((row, i) => {
      const cells = row.values.map((v, col) => `<td>${row.missing.includes(col) ? "<i>missing</i>" : escape(v)}</td>`).join("");
      return `<tr><th>${page.offset + i}</th>${cells}</tr>`;
    })
    .join("");
  return `<table class="dataframe"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
