import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { stepTitle } from "../src/flow/stages.ts";
import { StepLibrary } from "../src/views/StepLibrary.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { operators, PV, RUN } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";

const impute = operators.find((o) => o.id === "sprisk.clean.impute@1.0.0")!;

describe("step titles", () => {
  it("are the manifest's title, the standard term; the operator's name only stands in when it has none", () => {
    expect(stepTitle(impute.id, impute)).toBe("Imputation");
    expect(stepTitle("sprisk.clean.strip_html@1.0.0", undefined)).toBe("Strip html");
  });

  it("show in the step library", async () => {
    useSelection.setState({ pipelineVersionId: PV, runId: RUN, nodeId: undefined });
    renderWithApi(<StepLibrary />);
    expect(await screen.findByRole("button", { name: /^Imputation/ })).toBeInTheDocument();
  });
});
