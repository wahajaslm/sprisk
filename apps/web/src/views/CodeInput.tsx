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
  /** As tall as its code, as a notebook cell; otherwise it fills its box. A fit editor keeps
   * its own text while typing, and reads `value` only when it mounts: with many cells on a
   * page, pushing each keystroke back in would drop fast keystrokes. Remount it (new key) to
   * show other text. */
  fit?: boolean;
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
