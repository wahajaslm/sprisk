import type { TablePage } from "@sprisk/contracts";

export const isText = (dataType: string) => /Utf8|String|Dictionary|Categorical/.test(dataType);

/** One page of rows as a table. Missing cells are marked, not left blank. */
export function RowsTable({ page, label }: { page: TablePage; label: string }) {
  const first = page.offset + 1;
  return (
    <div className="peek-scroll">
      <table className="peek-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col" className="row-num">#</th>
            {page.columns.map((c) => (
              <th key={c.name} scope="col" className={isText(c.data_type) ? "text" : undefined}>
                {c.name}
                <span className="col-type">{c.data_type}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.rows.map((row, i) => (
            <tr key={page.offset + i}>
              <td className="row-num">{first + i}</td>
              {row.values.map((value, col) =>
                row.missing.includes(col) ? (
                  <td key={col} className="missing" aria-label="missing">∅</td>
                ) : (
                  <td key={col} className={isText(page.columns[col]?.data_type ?? "") ? "text" : undefined}>
                    {value}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
