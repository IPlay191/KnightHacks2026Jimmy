"use client";

import { useId, useState, type ReactNode } from "react";
import { Table2 } from "lucide-react";

export interface DataTable {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}

/**
 * Accessible chart wrapper (R10.5): figure + caption, a text summary, and a
 * "Show data as table" toggle revealing an equivalent HTML table.
 */
export function ChartFigure({
  title,
  summary,
  table,
  children,
  headingLevel = 3,
  actions,
}: {
  title: string;
  summary: string;
  table: DataTable;
  children: (ids: { titleId: string; descId: string }) => ReactNode;
  headingLevel?: 2 | 3;
  actions?: ReactNode;
}) {
  const id = useId();
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const tableId = `${id}-table`;
  const [showTable, setShowTable] = useState(false);
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <figure aria-labelledby={titleId} aria-describedby={descId} className="m-0 flex flex-col gap-3">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <Heading id={titleId} className="text-h3 text-text">
          {title}
        </Heading>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <button
            type="button"
            aria-expanded={showTable}
            aria-controls={tableId}
            onClick={() => setShowTable((s) => !s)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-strong px-3 text-small text-text-secondary hover:text-text"
          >
            <Table2 aria-hidden="true" size={16} />
            {showTable ? "Hide data table" : "Show data as table"}
          </button>
        </div>
      </figcaption>
      <p id={descId} className="text-small text-text-secondary">
        {summary}
      </p>
      <div className="overflow-x-auto">{children({ titleId, descId })}</div>
      <div id={tableId} hidden={!showTable} className="overflow-x-auto">
        <table className="w-full min-w-[20rem] border-collapse text-left text-small">
          <caption className="sr-only">{table.caption}</caption>
          <thead>
            <tr>
              {table.columns.map((c) => (
                <th key={c} scope="col" className="border-b border-border-strong px-3 py-2 font-semibold text-text">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i} className="border-b border-border-subtle">
                {row.map((cell, j) =>
                  j === 0 ? (
                    <th key={j} scope="row" className="px-3 py-2 font-normal text-text">
                      {cell}
                    </th>
                  ) : (
                    <td key={j} className="px-3 py-2 tabular text-text-secondary">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
