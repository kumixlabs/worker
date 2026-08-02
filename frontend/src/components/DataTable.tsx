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
  type Row,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search, Trash2, X } from "lucide-react";

import { DataGrid } from "@kumix/ui/reui/data-grid/data-grid";
import { DataGridPagination } from "@kumix/ui/reui/data-grid/data-grid-pagination";
import { DataGridScrollArea } from "@kumix/ui/reui/data-grid/data-grid-scroll-area";
import {
  DataGridTable,
  DataGridTableRowSelect,
  DataGridTableRowSelectAll,
} from "@kumix/ui/reui/data-grid/data-grid-table";
import { Frame, FrameFooter, FrameHeader, FramePanel } from "@kumix/ui/reui/frame";
import { Button } from "@kumix/ui/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@kumix/ui/ui/input-group";

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

function SortableHeader<T>({ column, title }: { column: Column<T, unknown>; title: string }) {
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
  actions,
  columns,
  data,
  empty,
  isLoading,
  isError,
  errorMessage,
  searchPlaceholder = "Search...",
  clearSearchLabel = "Clear search",
  initialSorting = [],
  selectedActionLabel,
  onDeleteSelected,
  getCanSelectRow,
}: {
  actions?: ReactNode;
  columns: ColumnDef<T>[];
  data: T[];
  empty: ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: ReactNode;
  searchPlaceholder?: string;
  clearSearchLabel?: string;
  initialSorting?: SortingState;
  selectedActionLabel?: string;
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
              size: 35,
              header: () => <DataGridTableRowSelectAll />,
              cell: ({ row }: { row: Row<T> }) => <DataGridTableRowSelect row={row} />,
              enableSorting: false,
              enableResizing: false,
            } satisfies ColumnDef<T>,
          ]
        : []),
      ...columns.map((column) => {
        if (typeof column.header !== "string") return column;
        const headerTitle = column.header as string;
        return {
          ...column,
          header: ({ column: tableColumn }: HeaderContext<T, unknown>) => (
            <SortableHeader column={tableColumn} title={headerTitle} />
          ),
        } as ColumnDef<T>;
      }),
    ],
    [columns, onDeleteSelected],
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
      <Frame stacked dense>
        <FrameHeader className="flex w-full flex-row flex-wrap items-center justify-between gap-3">
          <InputGroup className="w-48 bg-background">
            <InputGroupAddon align="inline-start">
              <Search className="size-4" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder={searchPlaceholder}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search.length > 0 ? (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  aria-label={clearSearchLabel}
                  title={clearSearchLabel}
                  size="icon-xs"
                  onClick={() => setSearch("")}
                >
                  <X className="size-4" />
                </InputGroupButton>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
          <div className="flex items-center gap-2.5">
            {onDeleteSelected && selectedIds.length > 0 ? (
              <Button variant="destructive" onClick={() => onDeleteSelected(selectedIds)}>
                <Trash2 />
                {selectedActionLabel ?? "Delete selected"} ({selectedIds.length})
              </Button>
            ) : null}
            {actions}
          </div>
        </FrameHeader>
        <FramePanel className="p-0 shadow-none">
          <DataGridScrollArea>
            <DataGridTable />
          </DataGridScrollArea>
        </FramePanel>
        <FrameFooter className="py-1.5 pr-2 pl-2.5">
          <DataGridPagination />
        </FrameFooter>
      </Frame>
    </DataGrid>
  );
}
