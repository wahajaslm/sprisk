import { addIcon, copyIcon, cutIcon, downloadIcon, type LabIcon, pasteIcon, runIcon } from "@jupyterlab/ui-components";
import type { CommandRegistry } from "@lumino/commands";

const BUTTONS: [string, LabIcon][] = [
  ["notebook:insert-cell-below", addIcon],
  ["notebook:cut-cell", cutIcon],
  ["notebook:copy-cell", copyIcon],
  ["notebook:paste-cell-below", pasteIcon],
  ["notebook:run-cell", runIcon],
  ["sprisk:download", downloadIcon],
];

/** JupyterLab's notebook toolbar: its classes and icons, its commands. On the right, where
 * JupyterLab names the kernel, it says who runs the cells (ADR-0034). */
export function NotebookToolbar({ commands }: { commands: CommandRegistry }) {
  return (
    <div className="lm-Widget jp-Toolbar jp-NotebookPanel-toolbar" role="toolbar" aria-label="Notebook">
      {BUTTONS.map(([id, icon]) => (
        <div key={id} className="lm-Widget jp-Toolbar-item">
          <button type="button" className="jp-ToolbarButtonComponent jp-mod-minimal" aria-label={commands.label(id)} title={commands.label(id)} onClick={() => void commands.execute(id)}>
            <icon.react tag="span" className="jp-ToolbarButtonComponent-icon" />
          </button>
        </div>
      ))}
      <div className="lm-Widget jp-Toolbar-spacer jp-Toolbar-item" />
      <div className="lm-Widget jp-Toolbar-item jp-Toolbar-kernelName" title="Each cell runs as a step of the flow, in sprisk's workers. There is no Jupyter kernel.">
        Python · runs in sprisk
      </div>
    </div>
  );
}
