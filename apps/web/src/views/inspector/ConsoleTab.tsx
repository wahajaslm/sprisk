import type { Attempt, CodeDisplay } from "@sprisk/contracts";

import type { Read } from "../../api/code.ts";

/** What happened while the step ran: printed text, warnings, errors, and each attempt. */
export function ConsoleTab({ display, attempts }: { display: Read<CodeDisplay>; attempts: Attempt[] }) {
  const texts = display.status === "ready" ? display.value.items.filter((i) => i.kind === "text") : [];
  const failed = attempts.filter((a) => a.error);
  return (
    <div className="console">
      {display.status === "error" ? (
        <p role="alert" className="error">{display.message}</p>
      ) : display.status === "loading" ? (
        <p className="muted">Loading…</p>
      ) : texts.length === 0 ? (
        <p className="muted">{attempts.length === 0 ? "Not run yet." : "Nothing printed."}</p>
      ) : (
        <section className="console-text" aria-label="Printed output">
          {texts.map((t, i) => {
            const channel = t.channel ?? "stdout";
            return (
              <div key={i} className={`result-text ${channel}`} data-channel={channel}>
                {channel === "stderr" && <span className="result-tag">stderr</span>}
                <pre className="code">{t.text}</pre>
              </div>
            );
          })}
        </section>
      )}
      <section className="attempt-log" aria-label="Attempts in this run">
        <p className="found-label">Attempts in this run</p>
        {attempts.length === 0 ? (
          <p className="muted">Not run in this run.</p>
        ) : (
          <ol className="log">
            {attempts.map((a) => (
              <li key={a.id} className={`state-${a.state}`}>
                <span className="mono">#{a.number}</span> {a.state.replace("_", " ")}
                {a.error && <span className="error"> · {a.error.code}: {a.error.message}</span>}
              </li>
            ))}
          </ol>
        )}
        {failed.length > 0 && attempts.at(-1)?.error === undefined && (
          <p className="muted">An earlier attempt failed and was retried; the last one is what you see.</p>
        )}
      </section>
    </div>
  );
}

/** stderr blocks and failed attempts, for the tab badge. */
export function consoleProblems(display: Read<CodeDisplay>, attempts: Attempt[]): number {
  const stderr = display.status === "ready" ? display.value.items.filter((i) => i.kind === "text" && i.channel === "stderr").length : 0;
  return stderr + attempts.filter((a) => a.error).length;
}
