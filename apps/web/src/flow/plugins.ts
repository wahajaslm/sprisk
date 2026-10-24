import type { Operator } from "@sprisk/contracts";

/** Operator ids are `sprisk.<plugin>.<operator>@<version>`. */
export const pluginOf = (op: Operator) => op.id.split(".")[1] ?? op.id;

/** The plugins the operators come from, by name. */
export const plugins = (ops: Operator[]) => [...new Set(ops.map(pluginOf))].sort();
