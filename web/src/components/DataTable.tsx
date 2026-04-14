import React, { useState, useMemo } from "react";

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  width?: string;
  render?: (row: T, index: number) => React.ReactNode;
  getValue?: (row: T) => string | number | null | undefined;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyField: string;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  expandedRowRender?: (row: T) => React.ReactNode;
  expandedRows?: Set<string>;
  className?: string;
}

type SortDirection = "asc" | "desc";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function DataTable<T extends Record<string, any>>({
  columns,
  data,
  keyField,
  emptyMessage = "No data available",
  onRowClick,
  expandedRowRender,
  expandedRows,
  className,
}: DataTableProps<T>): React.ReactElement {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return data;

    return [...data].sort((a, b) => {
      const aVal = col.getValue ? col.getValue(a) : (a[col.key] as string | number | null | undefined);
      const bVal = col.getValue ? col.getValue(b) : (b[col.key] as string | number | null | undefined);

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      let cmp: number;
      if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir, columns]);

  return (
    <div className={`table-wrapper ${className ?? ""}`}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                style={col.width ? { width: col.width } : undefined}
                className={col.sortable ? "sortable" : undefined}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
              >
                <span className="th-content">
                  {col.header}
                  {col.sortable && sortKey === col.key && (
                    <span className="sort-indicator">
                      {sortDir === "asc" ? " \u25B2" : " \u25BC"}
                    </span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="empty-message">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sortedData.map((row, idx) => {
              const rowKey = String(row[keyField]);
              const isExpanded = expandedRows?.has(rowKey);
              return (
                <React.Fragment key={rowKey}>
                  <tr
                    className={`${onRowClick ? "clickable" : ""} ${isExpanded ? "expanded" : ""}`}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map((col) => (
                      <td key={col.key}>
                        {col.render
                          ? col.render(row, idx)
                          : (row[col.key] as React.ReactNode) ?? "\u2014"}
                      </td>
                    ))}
                  </tr>
                  {isExpanded && expandedRowRender && (
                    <tr className="expanded-row">
                      <td colSpan={columns.length}>
                        {expandedRowRender(row)}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
