import React, { useMemo, useState } from "react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";

type DataTableProps<T> = {
  data: T[];
  columns: Array<ColumnDef<T, any>>;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
  dense?: boolean;
  className?: string;
};

export function DataTable<T>({
  data,
  columns,
  onRowClick,
  empty,
  dense = false,
  className,
}: DataTableProps<T>): React.ReactElement {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const rowPadding = dense ? "py-1.5" : "py-2.5";

  const headerGroups = useMemo(() => table.getHeaderGroups(), [table]);

  return (
    <div className={className}>
      <div className="overflow-auto rounded-lg border border-chamber-wall">
        <table className="w-full text-sm">
          <thead className="bg-chamber-wall/30 text-gray-300">
            {headerGroups.map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sortDir = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className={`px-3 ${rowPadding} text-left font-medium whitespace-nowrap ${
                        canSort ? "cursor-pointer select-none hover:text-white" : ""
                      }`}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <div className="flex items-center gap-2">
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                        {sortDir === "asc" && <span className="text-xs text-gray-400">▲</span>}
                        {sortDir === "desc" && <span className="text-xs text-gray-400">▼</span>}
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="bg-chamber-dark">
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-gray-500" colSpan={columns.length}>
                  {empty ?? "No rows"}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className={`border-t border-chamber-wall/60 ${
                    onRowClick ? "cursor-pointer hover:bg-chamber-wall/25" : ""
                  }`}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={`px-3 ${rowPadding} align-top text-gray-200`}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

