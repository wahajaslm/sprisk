// Every valid fixture must round-trip unchanged; every invalid one must be rejected.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Entities, parse } from "../src/index.ts";

const fixtureRoot = join(import.meta.dirname, "../../../tests/contract");

const entities: [keyof Entities, string][] = [
  ["Artifact", "artifact"],
  ["Operator", "operator"],
  ["PipelineVersion", "pipeline_version"],
  ["Run", "run"],
  ["Attempt", "attempt"],
  ["WorkerMessage", "worker_message"],
  ["QuestionVersion", "question_version"],
  ["MethodologyCheck", "methodology_check"],
  ["CreateRun", "create_run"],
  ["AttemptOutput", "attempt_output"],
  ["Problem", "problem"],
  ["TablePage", "table_page"],
];

it("every fixture dir has an entity", () => {
  const dirs = readdirSync(fixtureRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  expect(dirs).toEqual(entities.map(([, dir]) => dir).sort());
});

function fixtures(dir: string, kind: "valid" | "invalid"): [string, unknown][] {
  const path = join(fixtureRoot, dir, kind);
  const files = readdirSync(path).filter((f) => f.endsWith(".json")).sort();
  expect(files.length).toBeGreaterThan(0);
  return files.map((f) => [f, JSON.parse(readFileSync(join(path, f), "utf8"))]);
}

describe.each(entities)("%s contract", (entity, dir) => {
  it.each(fixtures(dir, "valid"))("accepts and round-trips %s", (_name, json) => {
    expect(JSON.parse(JSON.stringify(parse(entity, json)))).toEqual(json);
  });

  it.each(fixtures(dir, "invalid"))("rejects %s", (_name, json) => {
    expect(() => parse(entity, json)).toThrow(`Invalid ${entity}`);
  });
});
