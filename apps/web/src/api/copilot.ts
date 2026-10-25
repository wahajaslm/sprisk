import type { CopilotDatasetSummary, CopilotMessage, DatasetProfile, QuestionVersion, Unknown } from "@sprisk/contracts";
import { ulid } from "ulid";

import { postOne } from "./client.ts";

export interface QuestionLedgerInferenceResult {
  question: QuestionVersion;
  copilotClarification: string;
  unknowns: string[];
}

/** Counts per column only, never values: what the local model may see (ADR-0014 level 2). */
export function summarizeDatasetProfile(profile: DatasetProfile | undefined): CopilotDatasetSummary | undefined {
  if (!profile) return undefined;
  return {
    total_rows: profile.total_rows,
    total_columns: profile.total_columns,
    columns: profile.columns.map((c) => {
      const isCandidateTarget = c.distinct > 1 && c.distinct <= 50;
      const isCandidateId = c.distinct === profile.total_rows;
      return {
        name: c.name,
        type: c.data_type,
        distinct: c.distinct,
        missing: c.missing,
        missing_pct: profile.total_rows > 0 ? Number(((c.missing / profile.total_rows) * 100).toFixed(1)) : 0,
        ...(isCandidateTarget ? { candidate_target_or_class: true } : {}),
        ...(isCandidateId ? { candidate_id: true } : {}),
      };
    }),
  };
}

/** A draft ledger from the local model, through the API (ADR-0066). */
export async function inferQuestionLedger(options: {
  userRequest: string;
  datasetProfile?: DatasetProfile;
  investigationId?: string;
}): Promise<QuestionLedgerInferenceResult> {
  const summary = summarizeDatasetProfile(options.datasetProfile);
  const draft = await postOne("CopilotLedgerDraft", "/copilot/ledger", {
    user_request: options.userRequest,
    ...(summary ? { dataset_summary: summary } : {}),
  });

  const question: QuestionVersion = {
    schema_version: "sprisk.question_version/v1",
    id: `qv_${ulid()}`,
    investigation_id: options.investigationId ?? `inv_${ulid()}`,
    objective: draft.objective,
    task: draft.task,
    ...(draft.target ? { target: draft.target } : {}),
    ...(draft.unit_of_analysis ? { unit_of_analysis: draft.unit_of_analysis } : {}),
    ...(draft.prediction_horizon ? { prediction_horizon: draft.prediction_horizon } : {}),
    assumptions: [],
    unknowns: draft.unknowns.map((q): Unknown => ({ question: q, blocks: "execution" })),
    acceptance_criteria: [],
    ...(draft.costs ? { costs: draft.costs } : {}),
    created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };

  return {
    question,
    copilotClarification: draft.clarification || "Here is the drafted Question Ledger based on your dataset profile.",
    unknowns: draft.unknowns,
  };
}

/** The local model's answer to a chat turn, through the API (ADR-0066). */
export async function askCopilot(messages: CopilotMessage[], context?: string): Promise<string> {
  const reply = await postOne("CopilotChatReply", "/copilot/chat", { messages, ...(context ? { context } : {}) });
  return reply.content;
}
