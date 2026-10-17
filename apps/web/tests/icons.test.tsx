import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { NodeKind } from "../src/flow/stages.ts";
import { KindIcon } from "../src/views/Icons.tsx";

const KINDS: NodeKind[] = ["source", "recipe", "view", "decision", "model"];
const css = readFileSync(join(__dirname, "../src/styles/cockpit.css"), "utf8");

describe("step kind icons", () => {
  it("each kind's outline has its own colour token", () => {
    for (const kind of KINDS) {
      const { container } = render(<KindIcon kind={kind} />);
      expect(container.querySelector("svg")).toHaveClass(`kind-${kind}`);
      expect(css).toMatch(new RegExp(`--kind-${kind}: #[0-9a-f]{6};`));
      expect(css).toContain(`.kind-icon.kind-${kind} { color: var(--kind-${kind}); }`);
    }
  });

  it("an icon has no square behind it: only its outline is coloured", () => {
    expect(css).not.toMatch(/\.kind-(source|recipe|view|decision|model)[^{]*\{[^}]*background/);
    expect(css).not.toMatch(/\.icon-tile\.ring\s*\{/);
  });

  it("no kind is drawn in the alert red, which means a problem", () => {
    const tokens = KINDS.map((k) => css.match(new RegExp(`--kind-${k}: (#[0-9a-f]{6});`))?.[1]);
    expect(tokens).not.toContain("#ff5c5c");
    expect(new Set(tokens).size).toBe(KINDS.length);
  });
});
