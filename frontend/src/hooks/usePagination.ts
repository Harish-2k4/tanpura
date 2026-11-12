import { useCallback, useState } from 'react';
import { PAGE_SIZES } from '../../../shared/schemas';

export type PageSize = (typeof PAGE_SIZES)[number];

export type Pagination = {
  page: number;
  pageSize: PageSize;
  setPage: (page: number) => void;
  setPageSize: (size: PageSize) => void;
};

// Page state that goes back to the first page whenever `resetKey` changes (a new search or filter).
export function usePagination(resetKey: string, initialPageSize: PageSize = 25): Pagination {
  const [state, setState] = useState({ page: 0, key: resetKey });
  const [pageSize, setPageSizeState] = useState<PageSize>(initialPageSize);
  const setPage = useCallback((page: number) => setState({ page, key: resetKey }), [resetKey]);
  const setPageSize = useCallback(
    (size: PageSize) => {
      setPageSizeState(size);
      setState({ page: 0, key: resetKey });
    },
    [resetKey],
  );
  return { page: state.key === resetKey ? state.page : 0, pageSize, setPage, setPageSize };
}

// The page to show for `count` rows: never past the last page (e.g. after rows were removed).
export const clampedPage = ({ page, pageSize }: Pick<Pagination, 'page' | 'pageSize'>, count: number) =>
  Math.min(page, Math.max(0, Math.ceil(count / pageSize) - 1));

// The rows on the current page, for lists paged in the browser.
export function pageOf<T>(rows: T[], pagination: Pick<Pagination, 'page' | 'pageSize'>): T[] {
  const page = clampedPage(pagination, rows.length);
  return rows.slice(page * pagination.pageSize, (page + 1) * pagination.pageSize);
}
