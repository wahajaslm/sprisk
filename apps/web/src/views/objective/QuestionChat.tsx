import type { CopilotMessage, DatasetProfile, DatasetVersion } from "@sprisk/contracts";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ulid } from "ulid";

import { askCopilot } from "../../api/copilot.ts";
import { useDatasetVersionProfile, useDatasetVersions } from "../../api/datasets.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { timestamp } from "../../flow/edit.ts";
import { useSelection } from "../../workbench/selection.ts";
import { SendIcon } from "../Icons.tsx";
import { answer, chips, nextSlot, opening, prompt, toQuestion, type Chat, type Said } from "./conversation.ts";
import { StartWalk } from "./StartWalk.tsx";

type Message = CopilotMessage | { role: "error"; content: string };

const CONTEXT_LIMIT = 500;

/** The walk reads file paths: a single local CSV or Parquet file can be filled in for the person. */
function localFile(source: DatasetVersion): string[] {
  if (source.file_count !== 1 || !source.location.startsWith("file://")) return [];
  if (!/\.(csv|parquet)$/i.test(source.location)) return [];
  return [decodeURIComponent(new URL(source.location).pathname)];
}

/** A question drafted in a conversation that starts from a data source (ADR-0068). */
export function QuestionChat({ investigationId, onPick, onLeave }: {
  investigationId?: string;
  onPick: () => void;
  onLeave?: () => void;
}) {
  const sources = useDatasetVersions();
  const setNav = useSelection((s) => s.setNav);
  const [picked, setPicked] = useState<DatasetVersion>();

  if (picked) return <SourceChat key={picked.id} source={picked} investigationId={investigationId} onLeave={onLeave} />;
  if (sources.isPending) return <Loading text="Loading data sources…" pad />;
  if (sources.isError) return <p role="alert" className="error pad">{sources.error.message}</p>;
  return (
    <section className="qchat-pick" aria-label="Pick a data source">
      <h1 className="objective-empty-title">Which data is the question about?</h1>
      {sources.data.length === 0 ? (
        <p className="objective-empty-sub">
          No data source yet. <Button size="sm" onClick={() => setNav("Datasets")}>Add one on the Datasets page</Button>
        </p>
      ) : (
        <ul className="qchat-sources">
          {sources.data.map((source) => (
            <li key={source.id}>
              <button
                type="button"
                className="qchat-source"
                onClick={() => {
                  onPick();
                  setPicked(source);
                }}
              >
                <strong>{source.name}</strong>
                <span>{source.format} · {source.file_count} {source.file_count === 1 ? "file" : "files"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {onLeave && <Button size="sm" onClick={onLeave}>Back to ledger</Button>}
    </section>
  );
}

function SourceChat({ source, investigationId, onLeave }: {
  source: DatasetVersion;
  investigationId?: string | undefined;
  onLeave?: (() => void) | undefined;
}) {
  const profile = useDatasetVersionProfile(source.id);
  if (profile.isPending) return <Loading text={`Reading ${source.name}…`} pad />;
  if (profile.isError) return <p role="alert" className="error pad">{source.name} cannot be profiled: {profile.error.message}</p>;
  return <Conversation source={source} profile={profile.data} investigationId={investigationId} onLeave={onLeave} />;
}

function Conversation({ source, profile, investigationId, onLeave }: {
  source: DatasetVersion;
  profile: DatasetProfile;
  investigationId?: string | undefined;
  onLeave?: (() => void) | undefined;
}) {
  const [chat, setChat] = useState<Chat>({ draft: {}, done: [] });
  const [messages, setMessages] = useState<Message[]>(() => [{ role: "assistant", content: opening(source.name, profile) }]);
  const [text, setText] = useState("");
  const [ids] = useState(() => ({ id: `qv_${ulid()}`, investigation: investigationId ?? `inv_${ulid()}` }));
  const copilot = useMutation({ mutationFn: (turn: CopilotMessage[]) => askCopilot(turn, context()) });
  const offered = chips(chat, profile);
  const question = nextSlot(chat) ? undefined : toQuestion(chat, ids.id, ids.investigation, timestamp());

  // Dataset text in the context reaches the model only as a user message (ADR-0066).
  function context(): string {
    const choices = offered.map((c) => c.label).join(", ");
    return `Drafting a question about ${source.name}. Asked: ${prompt(chat)} Choices: ${choices || "typed"}`.slice(0, CONTEXT_LIMIT);
  }

  function reply(shown: string, value: string, said: Said) {
    const said_ = { role: "user" as const, content: shown };
    const next = answer(chat, profile, value, said);
    if (next) {
      setChat(next);
      setMessages([...messages, said_, { role: "assistant", content: prompt(next) }]);
      return;
    }
    // The model only talks: its reply is shown, and the same question is asked again.
    const sent = [...messages, said_];
    setMessages(sent);
    const turn = sent.filter((m): m is CopilotMessage => m.role !== "error");
    copilot.mutate(turn, {
      onSuccess: (content) => setMessages((all) => [...all, { role: "assistant", content }, { role: "assistant", content: prompt(chat) }]),
      onError: (error) =>
        setMessages((all) => [
          ...all,
          { role: "error", content: `I could not read that, and the Copilot cannot help: ${error.message}` },
          { role: "assistant", content: prompt(chat) },
        ]),
    });
  }

  const send = () => {
    const typed = text.trim();
    if (!typed) return;
    setText("");
    reply(typed, typed, "explicit");
  };

  return (
    <div className="qchat">
      <section className="qchat-main" aria-label="Question conversation">
        <div className="qchat-log" role="log" aria-label="Conversation">
          {messages.map((m, i) =>
            m.role === "error" ? (
              <p key={i} role="alert" className="error">{m.content}</p>
            ) : (
              <div key={i} className={`copilot-message ${m.role}`}>
                <div className="copilot-message-body">{m.content}</div>
              </div>
            ),
          )}
          {copilot.isPending && <Loading text="Asking the Copilot…" />}
          {question && <StartWalk question={question} draft initialSources={localFile(source)} />}
        </div>
        {offered.length > 0 && (
          <div className="qchat-chips" aria-label="Choices">
            {offered.map((c) => (
              <button key={c.label} type="button" className="qchat-chip" disabled={copilot.isPending} onClick={() => reply(c.label, c.value, "confirmed")}>
                {c.label}
              </button>
            ))}
          </div>
        )}
        {!question && (
          <form
            className="qchat-input"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              className="ds-input"
              aria-label="Your answer"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Pick a choice or type an answer"
              disabled={copilot.isPending}
            />
            <button type="submit" className="objective-send-btn" aria-label="Send" disabled={!text.trim() || copilot.isPending}>
              <SendIcon />
            </button>
          </form>
        )}
        {onLeave && <Button size="sm" onClick={onLeave}>Back to ledger</Button>}
      </section>
      <LedgerDraft chat={chat} />
    </div>
  );
}

function LedgerDraft({ chat }: { chat: Chat }) {
  const { draft } = chat;
  const bar = draft.success_bar?.value;
  const rows: [string, string | undefined][] = [
    ["Objective", draft.objective?.value],
    ["Target", draft.target?.value],
    ["Task", draft.task?.value],
    ["Unit of analysis", draft.unit_of_analysis?.value],
    ["Success bar", bar && `${bar.metric} ${bar.metric === "rmse" ? "≤" : "≥"} ${bar.score}`],
    ["Interpretability", draft.interpretability?.value],
  ];
  return (
    <aside className="qchat-ledger" aria-label="Ledger draft">
      <h2>Ledger draft</h2>
      <dl>
        {rows.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd className={value ? undefined : "muted"}>{value ?? "Open"}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">Nothing is saved until you start the auto run.</p>
    </aside>
  );
}
