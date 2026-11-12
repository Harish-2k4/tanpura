// All families' bills for a month, selectable for sending, each expandable to its lines.
import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUp from '@mui/icons-material/KeyboardArrowUp';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { Fragment, useState } from 'react';
import type { DraftView } from '../../../../shared/api';
import { Money, SCROLL_TABLE_SX } from '../../components/ui';
import { plural } from '../../lib/format';
import { DraftDetails, REVIEW_FLAGS } from './DraftDetails';
import { useWords } from '../../hooks/useWords';

type Props = {
  rows: DraftView[]; // the current page
  selectableIds: string[]; // every ready bill matching the search, across pages
  selected: Set<string>;
  onSelectedChange: (ids: Set<string>) => void;
  onOpenSession: (id: string) => void;
  onShowInvoices: () => void;
};

const NOT_SENDABLE_LABEL: Record<string, string> = {
  already_invoiced: 'Invoiced',
  nothing_to_bill: 'Nothing to bill',
  credit_carried: 'Credit carried',
};

function summary(d: DraftView, w: { class: string; classes: string }): string {
  const classes = d.lines.filter((l) => l.kind !== 'credit').reduce((n, l) => n + l.quantity, 0);
  const credits = d.lines.filter((l) => l.kind === 'credit').reduce((n, l) => n + l.quantity, 0);
  return [classes && plural(classes, w.class, w.classes), credits && plural(credits, 'credit')].filter(Boolean).join(' · ') || '–';
}

export function DraftsTable({ rows, selectableIds, selected, onSelectedChange, onOpenSession, onShowInvoices }: Props) {
  const w = useWords();
  const [expanded, setExpanded] = useState<string | null>(null);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const toggleAll = () => {
    const next = new Set(selected);
    for (const id of selectableIds) {
      if (allSelected) next.delete(id);
      else next.add(id);
    }
    onSelectedChange(next);
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  };

  return (
    <TableContainer sx={SCROLL_TABLE_SX}>
      <Table stickyHeader size="small" aria-label="Bills">
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox">
              <Checkbox
                checked={allSelected}
                indeterminate={!allSelected && selectableIds.some((id) => selected.has(id))}
                disabled={!selectableIds.length}
                onChange={toggleAll}
                slotProps={{ input: { 'aria-label': 'Select all bills ready to send' } }}
              />
            </TableCell>
            <TableCell>{w.Student}</TableCell>
            <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Bill</TableCell>
            <TableCell align="right">Total</TableCell>
            <TableCell>Status</TableCell>
            <TableCell padding="checkbox" sx={{ display: { xs: 'none', sm: 'table-cell' } }} />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((d) => {
            const open = expanded === d.studentId;
            const review = d.flags.filter((f) => REVIEW_FLAGS.includes(f.code)).length;
            const blocked = d.flags.find((f) => NOT_SENDABLE_LABEL[f.code]);
            return (
              <Fragment key={d.studentId}>
                <TableRow hover sx={{ '& > td': { borderBottom: open ? 0 : undefined } }}>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={selected.has(d.studentId)}
                      disabled={!d.sendable}
                      onChange={() => toggle(d.studentId)}
                      slotProps={{ input: { 'aria-label': `Select ${d.student.name}` } }}
                    />
                  </TableCell>
                  <TableCell
                    onClick={() => setExpanded(open ? null : d.studentId)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setExpanded(open ? null : d.studentId))}
                    tabIndex={0}
                    role="button"
                    aria-expanded={open}
                    aria-label={`${open ? 'Hide' : 'Show'} ${d.student.name}'s bill`}
                    sx={{ cursor: 'pointer' }}
                  >
                    <Typography sx={{ fontWeight: 600 }}>{d.student.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {d.student.parent.name !== d.student.name && `${d.student.parent.name} · `}{d.student.country}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{summary(d, w)}</TableCell>
                  <TableCell align="right">
                    <Money amount={d.total} currency={d.currency} strong />
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      {d.sendable ? <Chip size="small" color="primary" variant="outlined" label="Ready" /> : <Chip size="small" label={blocked ? NOT_SENDABLE_LABEL[blocked.code] : 'Not sendable'} />}
                      {review > 0 && <Chip size="small" color="warning" label={`${review} to review`} />}
                    </Stack>
                  </TableCell>
                  {/* On phones, tapping the name opens the bill; the arrow column would push the table off screen. */}
                  <TableCell padding="checkbox" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                    <IconButton size="small" onClick={() => setExpanded(open ? null : d.studentId)} aria-label={open ? 'Hide bill' : 'Show bill'} aria-expanded={open}>
                      {open ? <KeyboardArrowUp /> : <KeyboardArrowDown />}
                    </IconButton>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={6} sx={{ py: 0, ...(open ? {} : { borderBottom: 0 }) }}>
                    <Collapse in={open} timeout="auto" unmountOnExit>
                      <Box sx={{ pl: { md: 7 }, pr: { md: 2 }, mx: { xs: -1, sm: 0 } }}>
                        <DraftDetails draft={d} onOpenSession={onOpenSession} onShowInvoices={onShowInvoices} />
                      </Box>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
