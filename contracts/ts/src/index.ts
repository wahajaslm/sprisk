import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import bundle from "../../bundle.schema.json" with { type: "json" };
import type * as C from "./generated/contracts.ts";

export type * from "./generated/contracts.ts";

/** Entities that can be parsed from wire JSON. Add one line per new top-level entity. */
export interface Entities {
  Artifact: C.Artifact;
  Operator: C.Operator;
  PipelineVersion: C.PipelineVersion;
  Run: C.Run;
  Attempt: C.Attempt;
  WorkerMessage: C.WorkerMessage;
  QuestionVersion: C.QuestionVersion;
  MethodologyCheck: C.MethodologyCheck;
  DecisionProposal: C.DecisionProposal;
  ApplyMethodologyDecision: C.ApplyMethodologyDecision;
  MethodologyDecision: C.MethodologyDecision;
  AppliedMethodologyDecision: C.AppliedMethodologyDecision;
  CreateRun: C.CreateRun;
  AttemptOutput: C.AttemptOutput;
  Problem: C.Problem;
  TablePage: C.TablePage;
  CodeDisplay: C.CodeDisplay;
  CodeInterface: C.CodeInterface;
  CodeSplitRequest: C.CodeSplitRequest;
  CodeSplit: C.CodeSplit;
  OperatorSource: C.OperatorSource;
  MethodologyRule: C.MethodologyRule;
  MethodologyRuleSource: C.MethodologyRuleSource;
  RuleObservation: C.RuleObservation;
  RuleDecision: C.RuleDecision;
  FigureSet: C.FigureSet;
  LoadedTable: C.LoadedTable;
  DatasetProfile: C.DatasetProfile;
  NotebookVersion: C.NotebookVersion;
  NotebookExecute: C.NotebookExecute;
  NotebookExecution: C.NotebookExecution;
  NotebookExecutionEvent: C.NotebookExecutionEvent;
  NotebookVariables: C.NotebookVariables;
  NotebookKernelRequest: C.NotebookKernelRequest;
  SelectionDecision: C.SelectionDecision;
  ModelSelection: C.ModelSelection;
}

export class ContractError extends Error {}

// ajv-formats ships CommonJS; under NodeNext its default export is the module object.
const addFormats = addFormatsModule.default;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(bundle);

export function parse<K extends keyof Entities>(entity: K, json: unknown): Entities[K] {
  // getSchema returns an untyped validator; the bundle guarantees $defs/<entity> matches Entities[K].
  const validate = ajv.getSchema(`${bundle.$id}#/$defs/${entity}`) as
    | ValidateFunction<Entities[K]>
    | undefined;
  if (!validate) throw new ContractError(`Unknown entity: ${entity}`);
  const nullAt = findNull(json, "$");
  if (nullAt) throw new ContractError(`Invalid ${entity}: null is not allowed (at ${nullAt})`);
  if (validate(json)) return json;
  throw new ContractError(`Invalid ${entity}: ${ajv.errorsText(validate.errors)}`);
}

/** Path of the first JSON null, or undefined. Null is never valid wire data. */
function findNull(value: unknown, path: string): string | undefined {
  if (value === null) return path;
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) {
      const found = findNull(v, `${path}[${i}]`);
      if (found) return found;
    }
  } else if (typeof value === "object" && value !== undefined) {
    for (const [k, v] of Object.entries(value)) {
      const found = findNull(v, `${path}.${k}`);
      if (found) return found;
    }
  }
  return undefined;
}
