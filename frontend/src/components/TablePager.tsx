// Page controls under a table, for lists paged in the browser or on the server.
import TablePagination from '@mui/material/TablePagination';
import { PAGE_SIZES } from '../../../shared/schemas';
import { clampedPage, type PageSize, type Pagination } from '../hooks/usePagination';

export function TablePager({ count, pagination }: { count: number; pagination: Pagination }) {
  if (count <= PAGE_SIZES[0]) return null; // everything fits on the smallest page
  return (
    <TablePagination
      component="div"
      count={count}
      page={clampedPage(pagination, count)}
      rowsPerPage={pagination.pageSize}
      rowsPerPageOptions={[...PAGE_SIZES]}
      onPageChange={(_, page) => pagination.setPage(page)}
      onRowsPerPageChange={(e) => pagination.setPageSize(Number(e.target.value) as PageSize)}
      labelRowsPerPage="Per page"
      // Open the size menu above the control, not over it: near the bottom of the screen the
      // menu otherwise lands under the pointer and the same click picks the last size.
      slotProps={{
        select: {
          MenuProps: { anchorOrigin: { vertical: 'top', horizontal: 'left' }, transformOrigin: { vertical: 'bottom', horizontal: 'left' } },
        },
      }}
      sx={{ borderTop: 1, borderColor: 'divider' }}
    />
  );
}
