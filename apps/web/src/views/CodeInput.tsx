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
  /** As tall as its code, as a notebook cell; otherwise it fills its box. */
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
