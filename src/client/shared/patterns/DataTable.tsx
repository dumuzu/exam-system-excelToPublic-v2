import { tableFeatures, useTable, type ColumnDef, type RowData } from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/Table.tsx";

export interface DataTableColumnMeta {
  cellClassName?: string;
  headerClassName?: string;
  mobileLabel?: string;
}

export const dataTableFeatures = tableFeatures({
  columnMeta: {} as DataTableColumnMeta,
});

export type DataTableColumn<Row extends RowData> = ColumnDef<typeof dataTableFeatures, Row>;

export function DataTable<Row extends RowData>({ ariaLabel, columns, getRowId, rows }: {
  ariaLabel: string;
  columns: readonly DataTableColumn<Row>[];
  getRowId: (row: Row) => string;
  rows: readonly Row[];
}) {
  const table = useTable({
    columns,
    data: rows,
    features: dataTableFeatures,
    getRowId,
  });

  return (
    <div className="tableViewport tableViewportStacked">
      <Table aria-label={ariaLabel} className="dataTable" data-mobile-layout="stacked">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  className={header.column.columnDef.meta?.headerClassName}
                  colSpan={header.colSpan}
                  key={header.id}
                  scope="col"
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getAllCells().map((cell) => {
                const mobileLabel = cell.column.columnDef.meta?.mobileLabel
                  ?? (typeof cell.column.columnDef.header === "string" ? cell.column.columnDef.header : undefined);
                return (
                  <TableCell
                    className={cell.column.columnDef.meta?.cellClassName}
                    data-label={mobileLabel}
                    key={cell.id}
                  >
                    {mobileLabel ? <span aria-hidden="true" className="dataTableMobileLabel">{mobileLabel}</span> : null}
                    <div className="dataTableCellValue"><table.FlexRender cell={cell} /></div>
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
