import { describe, expect, it } from "vitest";

import { addCodeStep, CODE_OPERATOR, setCodeSource } from "../src/flow/edit.ts";
import { flows } from "../src/flow/flows.ts";
import { pipeline } from "./fixtures.ts";

describe("flow edits create a new pipeline version", () => {
  it("adds a code step reading one output, with a new id and the same project", () => {
    const { version, nodeId } = addCodeStep(pipeline, "load", "data");
    expect(version.id).toMatch(/^plv_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(version.id).not.toBe(pipeline.id);
    expect(version.project_id).toBe(pipeline.project_id);
    expect(version.parent_id).toBe(pipeline.id);
    expect(nodeId).toBe("code_1");
    expect(version.nodes.at(-1)).toEqual({ id: "code_1", operator: CODE_OPERATOR, params: { source: expect.stringContaining("data") } });
    expect(version.edges.at(-1)).toEqual({ from: "load.data", to: "code_1.data" });
    expect(version.created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(pipeline.nodes.some((n) => n.id === "code_1")).toBe(false);
  });

  it("numbers code steps past the ones already there", () => {
    const first = addCodeStep(pipeline, "load", "data").version;
    expect(addCodeStep(first, "split", "train").nodeId).toBe("code_2");
  });

  it("chains a code step onto another code step's output", () => {
    const first = addCodeStep(pipeline, "load", "data");
    const second = addCodeStep(first.version, first.nodeId, "data");
    expect(second.version.edges.at(-1)).toEqual({ from: "code_1.data", to: "code_2.data" });
  });

  it("changes only the code step's source", () => {
    const { version, nodeId } = addCodeStep(pipeline, "load", "data");
    const edited = setCodeSource(version, nodeId, "data.height");
    expect(edited.id).not.toBe(version.id);
    expect(edited.nodes.find((n) => n.id === nodeId)?.params).toEqual({ source: "data.height" });
    expect(edited.nodes.filter((n) => n.id !== nodeId)).toEqual(version.nodes.filter((n) => n.id !== nodeId));
    expect(edited.edges).toEqual(version.edges);
  });
});

describe("flows group versions by parent", () => {
  const v = (id: string, parent?: string) => ({ ...pipeline, id, ...(parent ? { parent_id: parent } : {}) });

  it("shows each flow once, as its latest version, with how many versions it has", () => {
    const versions = [v("plv_d"), v("plv_c", "plv_b"), v("plv_b", "plv_a"), v("plv_a")];
    expect(flows(versions).map((f) => [f.head.id, f.ids.length])).toEqual([
      ["plv_d", 1],
      ["plv_c", 3],
    ]);
  });

  it("keeps both branches when one version was edited twice", () => {
    const versions = [v("plv_c", "plv_a"), v("plv_b", "plv_a"), v("plv_a")];
    expect(flows(versions).map((f) => f.head.id)).toEqual(["plv_c", "plv_b"]);
  });
});
