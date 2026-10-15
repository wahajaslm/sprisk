import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import artifactSchema from "../../schemas/artifact.schema.json" with { type: "json" };
import type { Artifact } from "./generated/artifact.ts";

export type { Artifact } from "./generated/artifact.ts";

export class ContractError extends Error {}

// ajv-formats ships CommonJS; under NodeNext its default export is the module object.
const addFormats = addFormatsModule.default;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateArtifact = ajv.compile<Artifact>(artifactSchema);

export function parseArtifact(json: unknown): Artifact {
  if (validateArtifact(json)) return json;
  throw new ContractError(`Invalid Artifact: ${ajv.errorsText(validateArtifact.errors)}`);
}
