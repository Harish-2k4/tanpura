// Students, their families, weekly classes (in both time zones) and their rate per class.
import MoreVert from '@mui/icons-material/MoreVert';
import PersonAddOutlined from '@mui/icons-material/PersonAddOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import type { TeacherView } from '../../../../shared/api';
import type { Slot, Student } from '../../../../shared/billing';
import { addDays, weekdayOf } from '../../../../shared/time';
import { useEndEnrolment, useReEnrol, useStudents, useTeacher } from '../../api/queries';
import { useConfirm } from '../../components/ConfirmDialog';
import { StudentDialog } from '../../features/students/StudentDialog';
import { DateField } from '../../components/pickers';
import { FormDialog } from '../../components/FormDialog';
import type { Country } from '../../../../shared/billing';
import { SearchField } from '../../components/SearchField';
import { CountryFilter } from '../../components/SelectFilter';
import { TablePager } from '../../components/TablePager';
import { toast } from '../../components/toast';
import { EmptyState, Money, PageHeader, QueryState, SCROLL_TABLE_SX } from '../../components/ui';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { pageOf, usePagination } from '../../hooks/usePagination';
import dayjs from '../../lib/dayjs';
import { formatShortDate, plural, zoneCity } from '../../lib/format';
import { useWords } from '../../hooks/useWords';

export function StudentsPage() {
  const teacher = useTeacher();
  const students = useStudents();
  return (
    <QueryState query={teacher}>
      {(t) => <QueryState query={students}>{(list) => <Students teacher={t} students={list} />}</QueryState>}
    </QueryState>
  );
}

// "Tue 5:30 am" in the teacher's zone and the same moment for the family, e.g. "Mon 7:00 pm New York".
function slotTimes(slot: Slot, teacher: TeacherView, student: Student) {
  let date = teacher.today;
  while (weekdayOf(date) !== slot.weekday) date = addDays(date, 1);
  const start = dayjs.tz(`${date} ${slot.time}`, teacher.timezone);
  return { teacher: start.format('ddd h:mm a'), family: `${start.tz(student.timezone).format('ddd h:mm a')} ${zoneCity(student.timezone)}` };
}

function Students({ teacher, students }: { teacher: TeacherView; students: Student[] }) {
  const w = useWords();
  const [editing, setEditing] = useState<Student | null>(null);
  const [adding, setAdding] = useState(false);
  const [ending, setEnding] = useState<Student | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; student: Student } | null>(null);
  const reEnrol = useReEnrol();
  const confirm = useConfirm();

  const askReEnrol = async (s: Student) => {
    setMenu(null);
    const ok = await confirm({
      title: `Re-enrol ${s.name}?`,
      message: `Their weekly ${w.classes} go back on the calendar from today and are billed as usual.`,
      confirmText: 'Re-enrol',
    });
    if (ok) reEnrol.mutate(s.id, { onSuccess: (r) => toast.success(`${s.name} is enrolled again. ${plural(r.added, w.class, w.classes)} added to the calendar.`) });
  };
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState<Country | ''>('');
  const q = useDebouncedValue(search.trim().toLowerCase());
  const filtered = students.filter(
    (s) => (!country || s.country === country) && (!q || [s.name, s.parent.name, s.parent.email, s.country, zoneCity(s.timezone)].some((t) => t.toLowerCase().includes(q))),
  );
  const pagination = usePagination(`${q}|${country}`);
  const clearFilters = () => {
    setSearch('');
    setCountry('');
  };

  return (
    <>
      <PageHeader title={w.Students} actions={<Button variant="contained" startIcon={<PersonAddOutlined />} onClick={() => setAdding(true)}>Add {w.student}</Button>} />
      <Card>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ px: 2, py: 1.5 }}>
          <SearchField value={search} onChange={setSearch} placeholder={`Search ${w.student}, ${w.parent}, email or city`} label={`Search ${w.students}`} width={320} />
          <CountryFilter value={country} onChange={setCountry} />
        </Stack>
        {filtered.length === 0 && <EmptyState title={`No ${w.students} match these filters`} action={<Button onClick={clearFilters}>Clear filters</Button>} />}
        {filtered.length > 0 && (
          <TableContainer sx={SCROLL_TABLE_SX}>
            <Table stickyHeader size="small" aria-label={w.Students}>
              <TableHead>
                <TableRow>
                  <TableCell>{w.Student}</TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{w.Family === w.Student ? 'Billing contact' : w.Family}</TableCell>
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Weekly {w.classes} ({zoneCity(teacher.timezone)} · {w.family === w.student ? 'theirs' : w.family})</TableCell>
                  <TableCell align="right">Rate per {w.class}</TableCell>
                  <TableCell padding="checkbox" />
                </TableRow>
              </TableHead>
              <TableBody>
                {pageOf(filtered, pagination).map((s) => (
                  <TableRow key={s.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography sx={{ fontWeight: 600 }}>{s.name}</Typography>
                        {s.endedOn && <Chip size="small" label={`Ended ${formatShortDate(s.endedOn)}`} />}
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {zoneCity(s.timezone)}, {s.country}
                      </Typography>
                      <Box sx={{ display: { xs: 'block', sm: 'none' }, mt: 0.5 }}>
                        {s.slots.map((slot) => (
                          <Typography key={`${slot.weekday}-${slot.time}`} variant="caption" color="text.secondary" component="div">
                            {slotTimes(slot, teacher, s).teacher} · {slot.minutes} min
                          </Typography>
                        ))}
                      </Box>
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                      <Typography>{s.parent.name}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {s.parent.email}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                      <Stack spacing={0.25}>
                        {s.slots.map((slot) => {
                          const t = slotTimes(slot, teacher, s);
                          return (
                            <Typography key={`${slot.weekday}-${slot.time}`} variant="body2">
                              {t.teacher} · <Typography component="span" variant="body2" color="text.secondary">{t.family}</Typography> · {slot.minutes} min
                            </Typography>
                          );
                        })}
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <Money amount={s.rate} currency={s.currency} strong />
                    </TableCell>
                    <TableCell padding="checkbox">
                      <Tooltip title="Actions">
                        <span>
                          <IconButton
                            size="small"
                            disabled={reEnrol.isPending && reEnrol.variables === s.id}
                            onClick={(e) => setMenu({ anchor: e.currentTarget, student: s })}
                            aria-label={`Actions for ${s.name}`}
                          >
                            <MoreVert fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        <TablePager count={filtered.length} pagination={pagination} />
      </Card>
      <Menu anchorEl={menu?.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            setEditing(menu!.student);
            setMenu(null);
          }}
        >
          <ListItemText primary="Edit details" secondary={`Contact, rate and weekly ${w.classes}`} />
        </MenuItem>
        {menu?.student.endedOn ? (
          <MenuItem onClick={() => askReEnrol(menu.student)}>
            <ListItemText primary="Re-enrol" secondary={`Put their weekly ${w.classes} back from today`} />
          </MenuItem>
        ) : (
          <MenuItem
            onClick={() => {
              setEnding(menu!.student);
              setMenu(null);
            }}
          >
            <ListItemText primary="End enrolment" secondary={`They stopped ${w.classes}`} />
          </MenuItem>
        )}
      </Menu>
      {(editing || adding) && <StudentDialog student={editing ?? undefined} teacher={teacher} onClose={() => { setEditing(null); setAdding(false); }} />}
      {ending && <EndEnrolmentDialog student={ending} teacher={teacher} onClose={() => setEnding(null)} />}
    </>
  );
}

function EndEnrolmentDialog({ student, teacher, onClose }: { student: Student; teacher: TeacherView; onClose: () => void }) {
  const w = useWords();
  const [lastDate, setLastDate] = useState(teacher.today);
  const end = useEndEnrolment();
  const first = student.name.split(' ')[0];
  const min = addDays(teacher.today, -90);

  return (
    <FormDialog
      open
      title={`End ${first}'s enrolment`}
      submitText="End enrolment"
      busy={end.isPending}
      submitDisabled={!lastDate || lastDate < min}
      onClose={onClose}
      onSubmit={() =>
        end.mutate(
          { id: student.id, lastDate },
          {
            onSuccess: (r) => {
              toast.success(
                r.credited
                  ? `${first}'s enrolment ended. ${plural(r.credited, `paid ${w.class}`, `paid ${w.classes}`)} will be credited on the next bill.`
                  : `${first}'s enrolment ended. ${plural(r.removed, w.class, w.classes)} taken off the calendar.`,
              );
              onClose();
            },
          },
        )
      }
    >
      <DateField label={`Last ${w.class}`} value={lastDate} onChange={setLastDate} min={min} />
      <Alert severity="info">
        {w.Classes} after this day come off the calendar. {w.Classes} already paid for are credited on {first}&apos;s final bill, as an amount to refund from
        PayPal. Invoices already sent stay as they are. You can re-enrol {first} any time.
      </Alert>
    </FormDialog>
  );
}
