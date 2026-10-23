import { parse } from "@sprisk/contracts";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import questionJson from "../../../tests/contract/question_version/valid/classification-all-fields.json";
import { openEntries } from "../src/views/objective/ledger.ts";
import { TopBar } from "../src/views/TopBar.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { PV } from "./fixtures.ts";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

const question = parse("QuestionVersion", questionJson);
const { target: _target, ...noTarget } = question;

describe("the question ledger", () => {
  it("counts each unset core fact and each unknown as open", () => {
    expect(openEntries(question)).toBe(question.unknowns.length);
    expect(openEntries({ ...noTarget, unknowns: [] })).toBe(1);
  });
});

describe("top bar on the Objective page", () => {
  beforeEach(() => useSelection.setState({ nav: "Objective", pipelineVersionId: PV }));

  it("shows how many ledger entries are still open, from the question", async () => {
    server.use(http.get("/api/question_versions", () => HttpResponse.json([noTarget])));
    renderWithApi(<TopBar />);

    const open = openEntries(noTarget);
    expect(await screen.findByText(`${open} open in ledger`)).toBeInTheDocument();
    const tab = screen.getByRole("button", { name: /^Objective/ });
    expect(within(tab).getByText(String(open))).toBeInTheDocument();
  });

  it("says when there is no question yet, and offers no button that does nothing", async () => {
    renderWithApi(<TopBar />);

    expect(await screen.findByText("No question yet")).toBeInTheDocument();
    expect(screen.queryByText("Ledger complete")).toBeNull();
    expect(screen.queryByRole("button", { name: "Generate pipeline" })).toBeNull();
  });

  it("shows why the questions cannot be read, instead of saying there are none", async () => {
    server.use(http.get("/api/question_versions", () => HttpResponse.json({ errors: [{ code: "internal", message: "disk full" }] }, { status: 500 })));
    renderWithApi(<TopBar />);

    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(screen.queryByText("No question yet")).toBeNull();
  });
});
