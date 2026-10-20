import { lazy, Suspense } from "react";
import { Loading } from "../components/ui/Loading.tsx";

export type CodeInputProps = {
  value: string;
  label: string;
  onChange: (value: string) => void;
  /** Shift+Enter. Receives the current text, which may be newer than `value`. */
  onRun: (value: string) => void;
  /** Built-in steps: read their code, never edit it. */
  readOnly?: boolean;
  /** Highlighting; Python unless a rule manifest is shown. */
  language?: "python" | "yaml";
  /** As tall as its code, as a notebook cell; otherwise it fills its box. A fit editor keeps
   * its own text while typing, and reads `value` only when it mounts: with many cells on a
   * page, pushing each keystroke back in would drop fast keystrokes. Remount it (new key) to
   * show other text. */
  fit?: boolean;
  /** Esc, when no editor widget is open: a notebook leaves the editor for the cell. */
  onEscape?: () => void;
  /** Ctrl/Cmd+Enter in a notebook: run and stay on the cell. Without it, it runs as Shift+Enter. */
  onRunStay?: (value: string) => void;
};

const MonacoCode = lazy(() => import("./MonacoCode.tsx"));

/** The code editor, loaded only when a step's code is opened. */
export function CodeInput(props: CodeInputProps) {
  return (
    <div className={props.fit ? "code-input fit" : "code-input"}>
      <Suspense fallback={<Loading text="Loading editor…" pad />}>
        <MonacoCode {...props} />
      </Suspense>
    </div>
  );
}
