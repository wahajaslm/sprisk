import type { MethodologyRule } from "@sprisk/contracts";

import type { Chapter } from "./flowGraph.ts";
import { stageName } from "./ruleTree.ts";

const TOP = 40;
const RULE_GAP = 50;
const GROUP_GAP = 26;
const ROOT_X = 40;
const GROUP_X = 200;
const RULE_X = 430;

/** The design's rule map: a Rules root, one numbered disc per stage, and a dot per rule, drawn
 * left to right. The picked rule's path is bright. */
export function RuleTree({ chapters, picked, onPick }: {
  chapters: Chapter[];
  picked: string | undefined;
  onPick: (ruleId: string) => void;
}) {
  let y = TOP;
  const groups = chapters.map((c) => {
    const rules = c.rules.map((rule) => {
      const at = { rule, y };
      y += RULE_GAP;
      return at;
    });
    y += GROUP_GAP;
    return { chapter: c, rules, y: (rules[0]!.y + rules[rules.length - 1]!.y) / 2 };
  });
  const height = y;
  const rootY = groups.length === 0 ? TOP : (groups[0]!.y + groups[groups.length - 1]!.y) / 2;
  const curve = (x1: number, y1: number, x2: number, y2: number) => `M${x1} ${y1}C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`;
  const onPath = (rule: MethodologyRule) => rule.id === picked;

  return (
    <div className="rule-tree" role="region" aria-label="Rule map">
      <div className="rule-tree-inner" style={{ height }}>
        <svg className="rule-tree-lines" width={RULE_X + 8} height={height} aria-hidden="true">
          {groups.map((g) => {
            const lit = g.rules.some((r) => onPath(r.rule));
            return (
              <g key={g.chapter.key}>
                <path d={curve(ROOT_X + 22, rootY, GROUP_X - 14, g.y)} className={lit ? "lit" : undefined} />
                {g.rules.map((r) => (
                  <path key={r.rule.id} d={curve(GROUP_X + 110, g.y, RULE_X - 5, r.y)} className={onPath(r.rule) ? "lit" : undefined} />
                ))}
              </g>
            );
          })}
        </svg>
        <span className="rule-tree-root" style={{ left: ROOT_X - 22, top: rootY - 22 }}>
          Rules
        </span>
        {groups.map((g, i) => (
          <div key={g.chapter.key} className="rule-tree-group" style={{ left: GROUP_X - 14, top: g.y - 14 }}>
            <span className="rule-tree-disc">{i + 1}</span>
            <span className="rule-tree-group-text">
              <strong>{stageName(g.chapter.stage)}</strong>
              <span>{g.rules.length === 1 ? "1 rule" : `${g.rules.length} rules`}</span>
            </span>
          </div>
        ))}
        {groups.flatMap((g) =>
          g.rules.map(({ rule, y: at }) => {
            return (
              <button
                key={rule.id}
                type="button"
                className={`rule-tree-rule${onPath(rule) ? " picked" : ""}`}
                style={{ left: RULE_X - 5, top: at - 16 }}
                aria-pressed={onPath(rule)}
                onClick={() => onPick(rule.id)}
              >
                <span className="rule-tree-dot" aria-hidden="true" />
                <span className="rule-tree-rule-text">
                  <span className="rule-tree-rule-name">{rule.name}</span>
                  <span className="rule-tree-rule-id">{rule.decides}</span>
                </span>
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
