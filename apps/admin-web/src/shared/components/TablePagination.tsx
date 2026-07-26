import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const pageSizes = [10, 25, 50];

export function usePaginatedRows<T>(rows: T[], initialPageSize = 10) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  const startIndex = (page - 1) * pageSize;
  const pageRows = useMemo(() => rows.slice(startIndex, startIndex + pageSize), [rows, startIndex, pageSize]);

  function changePageSize(nextPageSize: number) {
    setPageSize(nextPageSize);
    setPage(1);
  }

  return {
    page,
    pageRows,
    pageSize,
    pageCount,
    startIndex,
    setPage,
    setPageSize: changePageSize,
    totalRows: rows.length
  };
}

interface TablePaginationProps {
  page: number;
  pageCount: number;
  pageSize: number;
  totalRows: number;
  startIndex: number;
  visibleCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export function TablePagination({
  page,
  pageCount,
  pageSize,
  totalRows,
  startIndex,
  visibleCount,
  onPageChange,
  onPageSizeChange
}: TablePaginationProps) {
  const from = totalRows === 0 ? 0 : startIndex + 1;
  const to = Math.min(totalRows, startIndex + visibleCount);

  return (
    <div className="table-pagination">
      <span>{from}-{to} of {totalRows}</span>
      <label>
        Rows
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
          {pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      <div className="pagination-actions">
        <button type="button" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft size={16} />
        </button>
        <strong>{page} / {pageCount}</strong>
        <button type="button" onClick={() => onPageChange(Math.min(pageCount, page + 1))} disabled={page >= pageCount} aria-label="Next page">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
