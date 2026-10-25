import { describe, expect, it } from "vitest";

import { canReplace } from "../src/views/experiments/runDiff.ts";

const names = { reference: "#1", run: "#2" };

describe("whether a run can replace the reference (design: Compare runs)", () => {
  it("replaces the reference when it scores better on the same test rows", () => {
    const r = canReplace({ accuracy: 0.9, n_rows: 1000 }, { accuracy: 0.93, n_rows: 1000 }, false, names);
    expect(r.verdict).toBe("replaces");
    expect(r.text).toBe("Run #2 can replace run #1: accuracy 0.9 → 0.93 (+0.03) on the same test rows.");
  });

  it("says a run scoring worse should not replace it", () => {
    const r = canReplace({ accuracy: 0.947 }, { accuracy: 0.9 }, false, names);
    expect(r.verdict).toBe("worse");
    expect(r.text).toBe("Run #2 should not replace run #1: accuracy 0.947 → 0.9 (−0.047) on the same test rows.");
  });

  it("reads a lower error as better", () => {
    expect(canReplace({ rmse: 2 }, { rmse: 1.5 }, false, names).verdict).toBe("replaces");
    expect(canReplace({ rmse: 1.5 }, { rmse: 2 }, false, names).verdict).toBe("worse");
  });

  it("calls a change smaller than one test row no change", () => {
    const r = canReplace({ accuracy: 0.9, n_rows: 50 }, { accuracy: 0.91, n_rows: 50 }, false, names);
    expect(r.verdict).toBe("same");
    expect(r.text).toBe("Run #2 scores the same as run #1 within one test row: accuracy 0.9 → 0.91 on 50 rows.");
  });

  it("will not weigh runs scored on different test rows", () => {
    const r = canReplace({ accuracy: 0.947 }, { accuracy: 0.9 }, true, names);
    expect(r.verdict).toBe("not_comparable");
    expect(r.text).toBe("Run #2 was scored on different test rows (the split changed), so its accuracy of 0.9 cannot be weighed against 0.947.");
  });

  it("says when there is no shared metric to weigh", () => {
    const r = canReplace({}, { accuracy: 0.9 }, false, names);
    expect(r.verdict).toBe("no_metrics");
    expect(r.text).toBe("Run #1 and run #2 share no test metric, so Sprisk cannot say whether run #2 can replace run #1.");
  });
});
