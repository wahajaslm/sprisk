import "@jupyterlab/theme-dark-extension/style/variables.css";
import "@jupyterlab/notebook/style/index.js";

import {
  CodeMirrorEditorFactory,
  CodeMirrorMimeTypeService,
  EditorExtensionRegistry,
  EditorLanguageRegistry,
  EditorThemeRegistry,
  ybinding,
} from "@jupyterlab/codemirror";
import type * as nbformat from "@jupyterlab/nbformat";
import { Notebook, NotebookActions, NotebookModel, NotebookPanel, StaticNotebook } from "@jupyterlab/notebook";
import { RenderMimeRegistry, standardRendererFactories } from "@jupyterlab/rendermime";
import type { IRenderMime } from "@jupyterlab/rendermime-interfaces";
import { CommandRegistry } from "@lumino/commands";
import { Widget } from "@lumino/widgets";
import type Plotly from "plotly.js-dist-min";

import { themed } from "../plotlyTheme.ts";
import { vegaOptions } from "../vegaOptions.ts";
import { PLOTLY_MIME, VEGALITE_MIME } from "./outputs.ts";

/** What the notebook asks sprisk to do: the notebook itself never runs code (ADR-0034). */
export type NotebookHandlers = { run: () => void; download: () => void };

export type JupyterNotebook = { notebook: Notebook; commands: CommandRegistry };

/** JupyterLab's own notebook, with no kernel: Run asks sprisk to save the flow and run it in
 * its workers (ADR-0034). Its toolbar is drawn by sprisk (NotebookToolbar): JupyterLab's
 * toolbar buttons are web components whose design tokens loop outside the JupyterLab app. */
export function createNotebook(cells: nbformat.ICodeCell[], handlers: NotebookHandlers): JupyterNotebook {
  const languages = new EditorLanguageRegistry();
  for (const language of EditorLanguageRegistry.getDefaultLanguages()) languages.addLanguage(language);
  const themes = new EditorThemeRegistry();
  for (const theme of EditorThemeRegistry.getDefaultThemes()) themes.addTheme(theme);
  const extensions = new EditorExtensionRegistry();
  for (const extension of EditorExtensionRegistry.getDefaultExtensions({ themes })) extensions.addExtension(extension);
  // Edits in an editor reach the cell's model through this binding, as in JupyterLab.
  extensions.addExtension({
    name: "shared-model-binding",
    factory: (options) => {
      const shared = options.model.sharedModel as unknown as { ysource: Parameters<typeof ybinding>[0]["ytext"]; undoManager: Parameters<typeof ybinding>[0]["undoManager"] | null };
      return EditorExtensionRegistry.createImmutableExtension(ybinding({ ytext: shared.ysource, ...(shared.undoManager ? { undoManager: shared.undoManager } : {}) }));
    },
  });
  const editors = new CodeMirrorEditorFactory({ extensions, languages });
  const notebook = new Notebook({
    rendermime: new RenderMimeRegistry({ initialFactories: [...standardRendererFactories, figureFactory(PLOTLY_MIME, drawPlotly), figureFactory(VEGALITE_MIME, drawVega)] }),
    contentFactory: new NotebookPanel.ContentFactory({ editorFactory: editors.newInlineEditor }),
    mimeTypeService: new CodeMirrorMimeTypeService(languages),
    notebookConfig: { ...StaticNotebook.defaultNotebookConfig, windowingMode: "none" },
  });
  const model = new NotebookModel();
  // Cells take their language from the notebook, as in a saved .ipynb.
  model.setMetadata("language_info", { name: "python" });
  model.sharedModel.insertCells(0, cells);
  notebook.model = model;
  notebook.addClass("jp-NotebookPanel-notebook");
  return { notebook, commands: notebookCommands(notebook, handlers) };
}

/** Jupyter's notebook commands and keys. Run is sprisk's; the rest are JupyterLab's actions. */
function notebookCommands(notebook: Notebook, handlers: NotebookHandlers): CommandRegistry {
  const commands = new CommandRegistry();
  const add = (id: string, label: string, execute: () => void) => commands.addCommand(id, { label, execute });
  add("notebook:run-cell", "Run this cell (Shift+Enter)", handlers.run);
  add("notebook:insert-cell-below", "Insert a cell below (B)", () => NotebookActions.insertBelow(notebook));
  add("notebook:insert-cell-above", "Insert a cell above (A)", () => NotebookActions.insertAbove(notebook));
  add("notebook:cut-cell", "Cut this cell (X)", () => NotebookActions.cut(notebook));
  add("notebook:copy-cell", "Copy this cell (C)", () => NotebookActions.copy(notebook));
  add("notebook:paste-cell-below", "Paste cells below (V)", () => NotebookActions.paste(notebook, "below"));
  add("notebook:delete-cell", "Delete this cell (D, D)", () => NotebookActions.deleteCells(notebook));
  add("notebook:undo-cell-action", "Undo the cell change (Z)", () => NotebookActions.undo(notebook));
  add("notebook:select-cell-above", "Select the cell above", () => NotebookActions.selectAbove(notebook));
  add("notebook:select-cell-below", "Select the cell below", () => NotebookActions.selectBelow(notebook));
  add("notebook:enter-edit-mode", "Edit this cell (Enter)", () => {
    notebook.mode = "edit";
  });
  add("notebook:enter-command-mode", "Leave the editor (Esc)", () => {
    notebook.mode = "command";
  });
  add("sprisk:download", "Download as .ipynb", handlers.download);

  // JupyterLab's default keys (notebook-extension), on this notebook only.
  const command = ".jp-Notebook.jp-mod-commandMode :focus:not(:read-write)";
  const anywhere = ".jp-Notebook";
  const keys: [string, string[], string][] = [
    ["notebook:run-cell", ["Shift Enter"], anywhere],
    ["notebook:run-cell", ["Accel Enter"], anywhere],
    ["notebook:enter-command-mode", ["Escape"], ".jp-Notebook.jp-mod-editMode"],
    ["notebook:enter-edit-mode", ["Enter"], command],
    ["notebook:insert-cell-above", ["A"], command],
    ["notebook:insert-cell-below", ["B"], command],
    ["notebook:cut-cell", ["X"], command],
    ["notebook:copy-cell", ["C"], command],
    ["notebook:paste-cell-below", ["V"], command],
    ["notebook:delete-cell", ["D", "D"], command],
    ["notebook:undo-cell-action", ["Z"], command],
    ["notebook:select-cell-above", ["ArrowUp"], command],
    ["notebook:select-cell-above", ["K"], command],
    ["notebook:select-cell-below", ["ArrowDown"], command],
    ["notebook:select-cell-below", ["J"], command],
  ];
  for (const [id, sequence, selector] of keys) commands.addKeyBinding({ command: id, keys: sequence, selector });
  return commands;
}

type Draw = (node: HTMLElement, data: unknown) => Promise<void>;

/** A JupyterLab output renderer for a chart sprisk already draws (ADR-0024). Safe: it draws the
 * chart's data and runs no code from it. */
function figureFactory(mime: string, draw: Draw): IRenderMime.IRendererFactory {
  return {
    safe: true,
    mimeTypes: [mime],
    defaultRank: 50,
    createRenderer: () => {
      const widget = new Widget() as Widget & IRenderMime.IRenderer;
      widget.addClass("jp-RenderedFigure");
      widget.renderModel = (model) => draw(widget.node, model.data[mime]);
      return widget;
    },
  };
}

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const drawPlotly: Draw = async (node, data) => {
  const { default: plotly } = await import("plotly.js-dist-min");
  const figure = data as { data: Plotly.Data[]; layout?: Partial<Plotly.Layout> };
  node.classList.add("plotly-figure");
  await plotly.react(node, figure.data, { ...themed(figure.layout ?? {}, token), autosize: true }, { responsive: true, displaylogo: false });
};

const drawVega: Draw = async (node, data) => {
  const { default: embed } = await import("vega-embed");
  await embed(node, data as Parameters<typeof embed>[1], vegaOptions(token));
};
