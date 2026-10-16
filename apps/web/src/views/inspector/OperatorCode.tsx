import { useOperatorSource } from "../../api/hooks.ts";
import { CodeInput } from "../CodeInput.tsx";

const ignore = () => undefined;

/** A built-in step's real code, read-only. Change how it runs in Parameters. */
export function OperatorCode({ operatorRef }: { operatorRef: string }) {
  const source = useOperatorSource(operatorRef);
  if (source.isPending) return <p className="muted">Loading code…</p>;
  if (source.isError) return <p role="alert" className="error">{source.error.message}</p>;
  return (
    <div className="code-editor">
      <p className="muted">
        <span className="tech">{source.data.path}</span> · read-only; ships with sprisk. Change how it runs in Parameters.
      </p>
      <CodeInput value={source.data.text} label={`Code of ${source.data.path}`} onChange={ignore} onRun={ignore} readOnly />
    </div>
  );
}
