import "@jupyterlab/theme-dark-extension/style/variables.css";
import "@jupyterlab/notebook/style/index.js";

import { Sanitizer } from "@jupyterlab/apputils";
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
import { errorRendererFactory, htmlRendererFactory, imageRendererFactory, RenderMimeRegistry, textRendererFactory } from "@jupyterlab/rendermime";
import type { IRenderMime } from "@jupyterlab/rendermime-interfaces";
import { CommandRegistry } from "@lumino/commands";
import { Widget } from "@lumino/widgets";
import type { VisualizationSpec } from "vega-embed";

import type { PlotlyFigureJson } from "../drawPlotly.ts";
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
    rendermime: outputRenderers(),
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

/** What outputs may show, all of it from sprisk's saved artifacts. Text never becomes links:
 * printed dataset text could carry a `javascript:` URL (rule 7). No JavaScript, LaTeX or
 * Markdown renderers: sprisk writes none, and cells added in the notebook would trust them. */
function outputRenderers(): RenderMimeRegistry {
  const sanitizer = new Sanitizer();
  sanitizer.setAutolink(false);
  return new RenderMimeRegistry({
    sanitizer,
    initialFactories: [
      htmlRendererFactory,
      imageRendererFactory,
      errorRendererFactory,
      textRendererFactory,
      chartFactory("image/svg+xml", "jp-RenderedSVG", async () => drawSvg),
      chartFactory(PLOTLY_MIME, "plotly-figure", async () => {
        const { drawPlotly } = await import("../drawPlotly.ts");
        return (node, data) => drawPlotly(node, data as PlotlyFigureJson);
      }),
      chartFactory(VEGALITE_MIME, "vega-figure", async () => {
        const { drawVega } = await import("../drawVega.ts");
        return (node, data) => drawVega(node, data as VisualizationSpec);
      }),
    ],
  });
}

/** Draws into a node; returns the cleanup. */
type Draw = (node: HTMLElement, data: unknown) => () => void;

/** A JupyterLab output renderer for a figure sprisk draws as everywhere else (ADR-0024). Safe:
 * it runs no code from the figure, so it draws in cells JupyterLab does not trust. */
function chartFactory(mime: string, className: string, load: () => Promise<Draw>): IRenderMime.IRendererFactory {
  return {
    safe: true,
    mimeTypes: [mime],
    defaultRank: 50,
    createRenderer: () => {
      const widget = new Widget() as Widget & IRenderMime.IRenderer;
      widget.addClass("jp-RenderedFigure");
      widget.addClass(className);
      let undo = () => undefined as void;
      widget.renderModel = async (model) => {
        const draw = await load();
        undo();
        undo = draw(widget.node, model.data[mime]);
      };
      const dispose = widget.dispose.bind(widget);
      widget.dispose = () => {
        undo();
        dispose();
      };
      return widget;
    },
  };
}

/** An SVG as a picture, as the Inspector draws it: nothing inside it runs. */
const drawSvg: Draw = (node, data) => {
  const img = document.createElement("img");
  img.className = "figure svg-figure";
  img.alt = "Figure";
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(data))}`;
  node.replaceChildren(img);
  return () => img.remove();
};
