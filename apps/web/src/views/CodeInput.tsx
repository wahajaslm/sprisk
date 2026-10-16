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
};

const MonacoCode = lazy(() => import("./MonacoCode.tsx"));

/** The code editor, loaded only when a step's code is opened. */
export function CodeInput(props: CodeInputProps) {
  return (
    <div className="code-input">
      <Suspense fallback={<Loading text="Loading editor…" pad />}>
        <MonacoCode {...props} />
      </Suspense>
    </div>
  );
}
