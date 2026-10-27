import type { Attempt, CodeDisplay } from "@sprisk/contracts";

import type { Read } from "../../api/code.ts";
import { Loading } from "../../components/ui/Loading.tsx";
import { P } from "../../styles/palette.ts";

/** The design's log view: monospace rows of a 76px time column beside the line. */
const LOG = { display: "flex", flexDirection: "column", fontFamily: "'IBM Plex Mono',monospace", fontSize: "12.5px", lineHeight: "1.8", margin: "0", padding: "0", listStyle: "none" } as const;
const ROW = { display: "grid", gridTemplateColumns: "76px minmax(0,1fr)", gap: "12px" } as const;
const TIME = { color: "var(--t-faint,#8c8c8c)" } as const;
const TEXT = { margin: "0", font: "inherit", whiteSpace: "pre-wrap", overflowWrap: "anywhere" } as const;
const LABEL = { margin: "0", fontSize: "12.5px", color: "var(--t-label,#959595)" } as const;
const NOTE = { margin: "0", fontSize: "12.5px", color: "var(--t-faint,#8c8c8c)" } as const;

/** What happened while the step ran: printed text, warnings, errors, and each attempt. */
export function ConsoleTab({ display, attempts }: { display: Read<CodeDisplay>; attempts: Attempt[] }) {
  const texts = display.status === "ready" ? display.value.items.filter((i) => i.kind === "text") : [];
  const failed = attempts.filter((a) => a.error);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {display.status === "error" ? (
        <p role="alert" className="error">{display.message}</p>
      ) : display.status === "loading" ? (
        <Loading />
      ) : texts.length === 0 ? (
        <p style={NOTE}>{attempts.length === 0 ? "Not run yet." : "Nothing printed."}</p>
      ) : (
        <section style={LOG} aria-label="Printed output">
          {texts.map((t, i) => {
            const channel = t.channel ?? "stdout";
            return (
              <div key={i} style={ROW} data-channel={channel}>
                <span style={TIME}>{channel}</span>
                <pre style={{ ...TEXT, color: channel === "stderr" ? P.red : P.t1 }}>{t.text}</pre>
              </div>
            );
          })}
        </section>
      )}
      <section style={{ display: "flex", flexDirection: "column", gap: "8px" }} aria-label="Attempts in this run">
        <p style={LABEL}>Attempts in this run</p>
        {attempts.length === 0 ? (
          <p style={NOTE}>Not run in this run.</p>
        ) : (
          <AttemptLog attempts={attempts} />
        )}
        {failed.length > 0 && attempts.at(-1)?.error === undefined && (
          <p style={NOTE}>An earlier attempt failed and was retried; the last one is what you see.</p>
        )}
      </section>
    </div>
  );
}

/** Each attempt as a log line: when it started, its number and state, and its error in red. */
export function AttemptLog({ attempts }: { attempts: Attempt[] }) {
  return (
    <ol style={LOG}>
      {attempts.map((a) => (
        <li key={a.id} style={ROW}>
          <span style={TIME}>{clock(a.created_at)}</span>
          <span style={{ color: a.error ? P.red : P.t1 }}>
            #{a.number} {a.state.replace("_", " ")}
            {a.error && <span className="error"> · {a.error.code}: {a.error.message}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** stderr blocks and failed attempts, for the tab badge. */
export function consoleProblems(display: Read<CodeDisplay>, attempts: Attempt[]): number {
  const stderr = display.status === "ready" ? display.value.items.filter((i) => i.kind === "text" && i.channel === "stderr").length : 0;
  return stderr + attempts.filter((a) => a.error).length;
}

function clock(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
