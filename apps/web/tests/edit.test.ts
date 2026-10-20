import { describe, expect, it } from "vitest";

import { addCodeStep, CODE_OPERATOR, readersOf, removeStep, setCodeSource, setNodeCode, setParams } from "../src/flow/edit.ts";
import { settingChanges } from "../src/flow/diff.ts";
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




  it("removes a step and the edges into it as a new version; readers are listed", () => {
    expect(readersOf(pipeline, "load").sort()).toEqual(["profile", "split"]);
    expect(readersOf(pipeline, "profile")).toEqual([]);
    const removed = removeStep(pipeline, "profile");
    expect(removed.parent_id).toBe(pipeline.id);
    expect(removed.nodes.some((n) => n.id === "profile")).toBe(false);
    expect(removed.edges).toEqual(pipeline.edges.filter((e) => !e.to.startsWith("profile.")));
  });

  it("gives a step its own code, and takes it away again (ADR-0028)", () => {
    const edited = setNodeCode(pipeline, "split", { source: "def f(data):\n    return data\n", function: "f" });
    expect(edited.parent_id).toBe(pipeline.id);
    expect(edited.nodes.find((n) => n.id === "split")?.code).toEqual({ source: "def f(data):\n    return data\n", function: "f" });
    const reverted = setNodeCode(edited, "split", undefined);
    expect(reverted.nodes.find((n) => n.id === "split")).not.toHaveProperty("code");
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

  it("keeps exposed settings and the chosen output when the code changes", () => {
    const { version, nodeId } = addCodeStep(pipeline, "load", "data");
    const exposed = setParams(version, nodeId, { source: "k = 1", parameters: { k: 2 }, output: "out" });
    expect(setCodeSource(exposed, nodeId, "k = 1\nout = data").nodes.find((n) => n.id === nodeId)?.params).toEqual({
      source: "k = 1\nout = data",
      parameters: { k: 2 },
      output: "out",
    });
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

  it("leaves out a version that compares models, which is not a flow", () => {
    const comparison = { ...v("plv_b"), compares: "mpr_01JABCDEFGHJKMNPQRSTVWXYZ0" };
    expect(flows([comparison, v("plv_a")]).map((f) => f.head.id)).toEqual(["plv_a"]);
  });

  it("keeps both branches when one version was edited twice", () => {
    const versions = [v("plv_c", "plv_a"), v("plv_b", "plv_a"), v("plv_a")];
    expect(flows(versions).map((f) => f.head.id)).toEqual(["plv_c", "plv_b"]);
  });
});

describe("setting changes between versions", () => {
  it("lists changed params, changed operators and added steps", () => {
    const after = {
      ...pipeline,
      nodes: [
        ...pipeline.nodes.map((n) => (n.id === "split" ? { ...n, params: { ...n.params, seed: 7 } } : n)),
        { id: "code_1", operator: "sprisk.code.python@1.1.0", params: { source: "data" } },
      ],
    };
    expect(settingChanges(pipeline, after)).toEqual([
      { node: "split", key: "seed", before: 42, after: 7 },
      { node: "code_1", key: "step", before: undefined, after: "present" },
    ]);
    expect(settingChanges(pipeline, pipeline)).toEqual([]);
  });
});
