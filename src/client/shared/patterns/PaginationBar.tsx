import { Button } from "../ui/Button.tsx";

export function PaginationBar({ currentPage, label, nextLabel, onPageChange, previousLabel, totalPages }: {
  currentPage: number;
  label: string;
  nextLabel: string;
  onPageChange: (page: number) => void;
  previousLabel: string;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label={label} className="paginationBar">
      <Button disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)} variant="quiet">{previousLabel}</Button>
      <span>{currentPage} / {totalPages}</span>
      <Button disabled={currentPage >= totalPages} onClick={() => onPageChange(currentPage + 1)} variant="quiet">{nextLabel}</Button>
    </nav>
  );
}
