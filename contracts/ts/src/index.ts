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
  if (validate(json)) return json;
  throw new ContractError(`Invalid ${entity}: ${ajv.errorsText(validate.errors)}`);
}
