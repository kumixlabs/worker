import { type ReactNode, useDeferredValue, useMemo, useState } from "react";
import {
  type Column,
  type ColumnDef,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type HeaderContext,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search, Trash2 } from "lucide-react";

import { DataGrid } from "@kumix/ui/reui/data-grid/data-grid";
import { DataGridPagination } from "@kumix/ui/reui/data-grid/data-grid-pagination";
import { DataGridTable } from "@kumix/ui/reui/data-grid/data-grid-table";
import { Button } from "@kumix/ui/ui/button";
import { Card, CardContent, CardFooter } from "@kumix/ui/ui/card";
import { Checkbox } from "@kumix/ui/ui/checkbox";
import { Input } from "@kumix/ui/ui/input";
import { ScrollArea, ScrollBar } from "@kumix/ui/ui/scroll-area";

function stringifyValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stringifyValue).join(" ");
  if (typeof value === "object") return Object.values(value).map(stringifyValue).join(" ");
  return "";
}

function searchableRow(row: unknown): string {
  return stringifyValue(row).toLowerCase();
}

/** Avoid @kumix/ui DataGridColumnHeader — memo'd on stable column ref, freezes sort UI. */
export function SortableHeader<T>({
  column,
  title,
}: {
  column: Column<T, unknown>;
  title: string;
}) {
  const sorted = column.getIsSorted();
  if (!column.getCanSort()) {
    return (
      <span className="inline-flex h-full items-center font-normal text-[0.8125rem] text-secondary-foreground/80">
        {title}
      </span>
    );
  }
  return (
    <div className="-ms-2 flex h-full items-center">
      <Button
        type="button"
        variant="ghost"
        className="h-6 rounded-lg px-2 font-normal text-secondary-foreground/80 hover:bg-secondary hover:text-foreground"
        onClick={() => {
          if (sorted === "asc") column.toggleSorting(true);
          else if (sorted === "desc") column.clearSorting();
          else column.toggleSorting(false);
        }}
      >
        {title}
        {sorted === "desc" ? (
          <ArrowDown className="size-3.25" aria-hidden />
        ) : sorted === "asc" ? (
          <ArrowUp className="size-3.25" aria-hidden />
        ) : (
          <ChevronsUpDown className="mt-px size-3.25" aria-hidden />
        )}
      </Button>
    </div>
  );
}

export function DataTable<T extends { id: string }>({
  columns,
  data,
  empty,
  isLoading,
  isError,
  errorMessage,
  searchPlaceholder = "Search...",
  initialSorting = [],
  selectedActionLabel,
  selectAllLabel = "Select all rows",
  selectRowLabel = "Select row",
  onDeleteSelected,
  getCanSelectRow,
}: {
  columns: ColumnDef<T>[];
  data: T[];
  empty: ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: ReactNode;
  searchPlaceholder?: string;
  initialSorting?: SortingState;
  selectedActionLabel?: string;
  selectAllLabel?: string;
  selectRowLabel?: string;
  onDeleteSelected?: (ids: string[]) => void;
  getCanSelectRow?: (row: T) => boolean;
}) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const searchableCache = useMemo(() => {
    const cache = new Map<T, string>();
    for (const row of data) cache.set(row, searchableRow(row));
    return cache;
  }, [data]);
  const filteredData = useMemo(() => {
    const term = deferredSearch.trim().toLowerCase();
    if (!term) return data;
    return data.filter((row) => (searchableCache.get(row) ?? "").includes(term));
  }, [data, deferredSearch, searchableCache]);
  const gridColumns = useMemo<ColumnDef<T>[]>(
    () => [
      ...(onDeleteSelected
        ? [
            {
              id: "select",
              size: 44,
              minSize: 44,
              maxSize: 44,
              header: ({ table }) => (
                <Checkbox
                  checked={table.getIsAllPageRowsSelected()}
                  indeterminate={
                    table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()
                  }
                  onCheckedChange={(value) => table.toggleAllPageRowsSelected(Boolean(value))}
                  aria-label={selectAllLabel}
                />
              ),
              cell: ({ row }) => (
                <Checkbox
                  checked={row.getIsSelected()}
                  disabled={!row.getCanSelect()}
                  onCheckedChange={(value) => row.toggleSelected(Boolean(value))}
                  aria-label={selectRowLabel}
                />
              ),
              enableSorting: false,
            } satisfies ColumnDef<T>,
          ]
        : []),
      ...columns.map((column) => {
        if (typeof column.header !== "string") return column;
        const title = column.header as string;
        return {
          ...column,
          header: ({ column: tableColumn }: HeaderContext<T, unknown>) => (
            <SortableHeader column={tableColumn} title={title} />
          ),
        } as ColumnDef<T>;
      }),
    ],
    [columns, onDeleteSelected, selectAllLabel, selectRowLabel],
  );
  const table = useReactTable({
    columns: gridColumns,
    data: filteredData,
    state: { pagination, sorting, rowSelection },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => row.id,
    enableRowSelection: (row) => getCanSelectRow?.(row.original) ?? true,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
  const selectedIds = table.getSelectedRowModel().rows.map((row) => row.original.id);

  return (
    <DataGrid
      table={table as never}
      recordCount={filteredData.length}
      isLoading={isLoading}
      tableLayout={{
        columnsMovable: false,
        columnsPinnable: false,
        columnsResizable: false,
        columnsVisibility: false,
      }}
      emptyMessage={isError ? (errorMessage ?? empty) : empty}
    >
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-2 border-border border-b p-3 sm:flex-row sm:items-center">
          <div className="relative min-w-55 flex-1">
            <Search className="absolute inset-s-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="ps-9"
            />
          </div>
          {onDeleteSelected && selectedIds.length > 0 ? (
            <Button variant="destructive" onClick={() => onDeleteSelected(selectedIds)}>
              <Trash2 />
              {selectedActionLabel ?? "Delete selected"} ({selectedIds.length})
            </Button>
          ) : null}
        </div>
        <CardContent className="p-0">
          <ScrollArea>
            <DataGridTable />
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </CardContent>
        <CardFooter>
          <DataGridPagination />
        </CardFooter>
      </Card>
    </DataGrid>
  );
}
