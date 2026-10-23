import type { LoadedTable } from "@sprisk/contracts";

/** "442 rows · 11 columns", as every page that lists a table says it. */
export const tableSize = (t: LoadedTable) => `${t.total_rows.toLocaleString()} rows · ${t.total_columns} columns`;
