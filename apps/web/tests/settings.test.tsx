import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import tableJson from "../../../tests/contract/loaded_table/valid/loaded-by-two-flows.json";
import missingMarkers from "../../../tests/contract/methodology_rule/valid/missing-markers.json";
import draftRule from "../../../tests/contract/methodology_rule/valid/multicollinearity.json";
import shortlist from "../../../tests/contract/methodology_rule/valid/shortlist.json";
import { SettingsPage } from "../src/views/settings/SettingsPage.tsx";
import { renderWithApi } from "./render.tsx";
import { server } from "./server.ts";

function installed() {
  server.use(
    http.get("/api/methodology_rules", () => HttpResponse.json([missingMarkers, draftRule, shortlist])),
    http.get("/api/loaded_tables", () => HttpResponse.json([tableJson])),
  );
}

const open = async (page: string) => {
  const side = await screen.findByRole("complementary", { name: "Settings" });
  await userEvent.click(within(side).getByRole("button", { name: new RegExp(`^${page}`) }));
};

describe("settings", () => {
  it("groups its pages as the design does: Platform, then Access", async () => {
    installed();
    renderWithApi(<SettingsPage />);
    const side = await screen.findByRole("complementary", { name: "Settings" });
    expect(within(side).getByText("Platform")).toBeInTheDocument();
    expect(within(side).getByText("Access")).toBeInTheDocument();
    for (const page of ["Packs", "Plugins", "Environments", "Compute", "Data", "Members"]) {
      expect(within(side).getByRole("button", { name: new RegExp(`^${page}`) })).toBeInTheDocument();
    }
  });

  it("lists the methodology packs with their active and draft rules", async () => {
    installed();
    renderWithApi(<SettingsPage />);
    const packs = await screen.findByRole("list", { name: "Packs" });
    expect(within(packs).getByText("supervised")).toBeInTheDocument();
    expect(packs).toHaveTextContent("1 active · 1 draft");
    expect(within(packs).getByText("common")).toBeInTheDocument();
  });

  it("lists the plugins' operators and shows one's ports and settings", async () => {
    installed();
    renderWithApi(<SettingsPage />);
    await open("Plugins");
    const ml = await screen.findByRole("list", { name: "ml" });
    await userEvent.click(within(ml).getByRole("button", { name: /Linear model/ }));
    const detail = screen.getByRole("region", { name: "sprisk.ml.linear_model@1.0.0" });
    expect(detail).toHaveTextContent("train (table)");
    expect(detail).toHaveTextContent("model (model)");
  });

  it("lists the loaded data", async () => {
    installed();
    renderWithApi(<SettingsPage />);
    await open("Data");
    const data = await screen.findByRole("list", { name: "Data" });
    expect(data).toHaveTextContent("diabetes.csv");
    expect(data).toHaveTextContent("442 rows · 11 columns · used by 2 flows");
  });

  it("says what is not available in local mode instead of showing made-up status", async () => {
    installed();
    renderWithApi(<SettingsPage />);
    await open("Compute");
    expect(await screen.findByText(/Local mode runs every step on this machine/)).toBeInTheDocument();
    expect(screen.queryByText("Connected")).toBeNull();
    expect(screen.queryByText("Live")).toBeNull();
  });

  it("shows why the operators cannot be read", async () => {
    server.use(http.get("/api/operators", () => HttpResponse.json({ errors: [{ code: "internal", message: "registry down" }] }, { status: 500 })));
    renderWithApi(<SettingsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("registry down");
  });
});
