import type { ComponentPropsWithRef } from "react";

function mergeClassName(baseClassName: string, className: string | undefined): string {
  return className ? `${baseClassName} ${className}` : baseClassName;
}

export function Table({ className, ref, ...props }: ComponentPropsWithRef<"table">) {
  return <table className={mergeClassName("uiTable", className)} data-slot="table" ref={ref} {...props} />;
}

export function TableHeader({ className, ref, ...props }: ComponentPropsWithRef<"thead">) {
  return <thead className={mergeClassName("uiTableHeader", className)} data-slot="table-header" ref={ref} {...props} />;
}

export function TableBody({ className, ref, ...props }: ComponentPropsWithRef<"tbody">) {
  return <tbody className={mergeClassName("uiTableBody", className)} data-slot="table-body" ref={ref} {...props} />;
}

export function TableFooter({ className, ref, ...props }: ComponentPropsWithRef<"tfoot">) {
  return <tfoot className={mergeClassName("uiTableFooter", className)} data-slot="table-footer" ref={ref} {...props} />;
}

export function TableRow({ className, ref, ...props }: ComponentPropsWithRef<"tr">) {
  return <tr className={mergeClassName("uiTableRow", className)} data-slot="table-row" ref={ref} {...props} />;
}

export function TableHead({ className, ref, ...props }: ComponentPropsWithRef<"th">) {
  return <th className={mergeClassName("uiTableHead", className)} data-slot="table-head" ref={ref} {...props} />;
}

export function TableCell({ className, ref, ...props }: ComponentPropsWithRef<"td">) {
  return <td className={mergeClassName("uiTableCell", className)} data-slot="table-cell" ref={ref} {...props} />;
}

export function TableCaption({ className, ref, ...props }: ComponentPropsWithRef<"caption">) {
  return <caption className={mergeClassName("uiTableCaption", className)} data-slot="table-caption" ref={ref} {...props} />;
}
