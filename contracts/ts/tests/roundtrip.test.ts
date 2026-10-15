// Every valid fixture must round-trip unchanged; every invalid one must be rejected.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArtifact } from "../src/index.ts";

const fixtureRoot = join(import.meta.dirname, "../../../tests/contract/artifact");

function fixtures(kind: "valid" | "invalid"): [string, unknown][] {
  const dir = join(fixtureRoot, kind);
  const files = readdirSync(dir).sort();
  expect(files.length).toBeGreaterThan(0);
  return files.map((f) => [f, JSON.parse(readFileSync(join(dir, f), "utf8"))]);
}

describe("Artifact contract", () => {
  it.each(fixtures("valid"))("accepts and round-trips %s", (_name, json) => {
    const artifact = parseArtifact(json);
    expect(JSON.parse(JSON.stringify(artifact))).toEqual(json);
  });

  it.each(fixtures("invalid"))("rejects %s", (_name, json) => {
    expect(() => parseArtifact(json)).toThrow(/Invalid Artifact/);
  });
});
