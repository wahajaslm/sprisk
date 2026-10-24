import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";

import { DeployPage } from "../src/views/deploy/DeployPage.tsx";
import { useSelection } from "../src/workbench/selection.ts";
import { renderWithApi } from "./render.tsx";

it("says what each tab will hold, since no model is served yet", async () => {
  renderWithApi(<DeployPage />);
  expect(screen.getByText(/A promoted model's card/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("tab", { name: "Monitoring" }));
  expect(screen.getByText(/Drift and latency alerts/)).toBeInTheDocument();
});

it("sends a person to compare models in Experiments", async () => {
  renderWithApi(<DeployPage />);
  await userEvent.click(screen.getByRole("button", { name: "Go to Experiments" }));
  expect(useSelection.getState()).toMatchObject({ nav: "Experiments", experimentsTab: "Compare" });
});
