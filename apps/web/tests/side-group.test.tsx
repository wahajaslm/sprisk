import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SideGroup } from "../src/components/ui/SideGroup.tsx";

describe("SideGroup", () => {
  it("shows its label and count without a position number", () => {
    render(
      <>
        <SideGroup label="Data loading" meta="1 / 1">
          <span>File source</span>
        </SideGroup>
        <SideGroup label="Data cleaning" meta="2 / 2">
          <span>Column removal</span>
        </SideGroup>
      </>,
    );
    expect(screen.getByRole("button", { name: "Data loading1 / 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Data cleaning2 / 2" })).toBeInTheDocument();
  });
});
