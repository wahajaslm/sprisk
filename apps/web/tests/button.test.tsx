import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "../src/components/ui/Button.tsx";

describe("Button", () => {
  it("never submits the form it sits in", async () => {
    const submit = vi.fn((e: SubmitEvent) => e.preventDefault());
    render(
      <form onSubmit={(e) => submit(e.nativeEvent as SubmitEvent)}>
        <Button>Save</Button>
      </form>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(submit).not.toHaveBeenCalled();
  });

  it("takes its look from the design's classes, not inline styles", () => {
    render(<Button variant="primary" size="sm">Run flow</Button>);
    const button = screen.getByRole("button", { name: "Run flow" });
    expect(button).toHaveClass("btn", "btn-primary", "btn-sm");
    expect(button).not.toHaveAttribute("style");
  });
});
