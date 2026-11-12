// The class calendar (Bryntum Calendar), in the teacher's time zone. Clicking a class opens
// the same class dialog the billing page uses.
import '@bryntum/calendar/calendar.css';
import '@bryntum/calendar/fontawesome/css/fontawesome.css';
import '@bryntum/calendar/fontawesome/css/solid.css';
import darkThemeUrl from '@bryntum/calendar/material3-dark.css?url';
import lightThemeUrl from '@bryntum/calendar/material3-light.css?url';
import './calendar.css';
import { BryntumCalendar } from '@bryntum/calendar-react';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import Box from '@mui/material/Box';
import useMediaQuery from '@mui/material/useMediaQuery';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import { useTheme } from '@mui/material/styles';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionView, TeacherView } from '../../../../shared/api';
import type { Student } from '../../../../shared/billing';
import { addDays } from '../../../../shared/time';
import { useSessions, useStudents, useTeacher } from '../../api/queries';
import { PageHeader, QueryState } from '../../components/ui';
import { useAssistant } from '../../features/assistant/AssistantProvider';
import { SessionDialog } from '../../features/sessions/SessionDialog';
import { zoneCity } from '../../lib/format';
import { SESSION_STATUS } from '../../lib/status';

const LEGEND: { label: string; color: string }[] = [
  { label: 'Scheduled', color: '#2196f3' },
  { label: 'Held', color: '#4caf50' },
  { label: 'Missed, charged', color: '#ff9800' },
  { label: 'Cancelled / not charged', color: '#9e9e9e' },
  { label: 'Cancelled by you', color: '#7c4dff' },
];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function toEvent(s: SessionView) {
  const missedFree = s.waived || s.status === 'cancelled_student';
  const color = missedFree ? 'gray' : SESSION_STATUS[s.effectiveStatus].calendar;
  const first = s.studentName.split(' ')[0];
  return {
    id: s.id,
    name: s.makeupFor ? `${first} (makeup)` : first, // short, fits small events
    startDate: new Date(s.start),
    endDate: new Date(Date.parse(s.start) + s.minutes * 60_000),
    resourceId: s.studentId,
    eventColor: color,
    iconCls: s.makeupFor ? 'fa fa-rotate' : undefined,
    cls: s.status.startsWith('cancelled') ? 'tp-cancelled' : undefined,
  };
}

export default function CalendarPage() {
  const teacher = useTeacher();
  const students = useStudents();
  return (
    <QueryState query={teacher}>
      {(t) => <QueryState query={students}>{(list) => <ClassCalendar teacher={t} students={list} />}</QueryState>}
    </QueryState>
  );
}

// Bryntum's themes are global stylesheets; load the one matching the app's mode.
function useBryntumTheme() {
  const dark = useTheme().palette.mode === 'dark';
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = dark ? darkThemeUrl : lightThemeUrl;
    document.head.appendChild(link);
    return () => link.remove();
  }, [dark]);
}

function ClassCalendar({ teacher, students }: { teacher: TeacherView; students: Student[] }) {
  // A week of seven columns is unreadable on a phone: show one day there.
  const phone = useMediaQuery(useTheme().breakpoints.down('sm'));
  useBryntumTheme();
  const [range, setRange] = useState(() => ({ from: addDays(teacher.today, -10), to: addDays(teacher.today, 10) }));
  const [selected, setSelected] = useState<string | null>(null);
  const [initialDate] = useState(() => new Date());
  const sessions = useSessions(range.from, range.to);
  const assistant = useAssistant();

  const events = useMemo(() => (sessions.data ?? []).map(toEvent), [sessions.data]);
  const resources = useMemo(() => students.map((s) => ({ id: s.id, name: s.name })), [students]);

  // Load a couple of days either side of what is visible, so time-zone edges are covered.
  const onDateRangeChange = useCallback(({ new: visible }: { new: { startDate: Date; endDate: Date } }) => {
    const next = { from: addDays(ymd(visible.startDate), -2), to: addDays(ymd(visible.endDate), 2) };
    setRange((prev) => (prev.from === next.from && prev.to === next.to ? prev : next));
  }, []);

  const onEventClick = useCallback(({ eventRecord }: { eventRecord: { id: string | number } }) => setSelected(String(eventRecord.id)), []);

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle={`${zoneCity(teacher.timezone)} time`}
        actions={
          <Button variant="outlined" startIcon={<AutoAwesomeOutlined />} onClick={() => assistant.open()}>
            Paste a message
          </Button>
        }
      />
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 2 }}>
        {LEGEND.map((l) => (
          <Chip key={l.label} size="small" variant="outlined" label={l.label} icon={<Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: l.color, ml: 1 }} />} />
        ))}
      </Stack>
      <Card sx={{ height: 'calc(100vh - 260px)', minHeight: 560, overflow: 'hidden' }}>
        <BryntumCalendar
          key={phone ? 'day' : 'week'}
          date={initialDate}
          mode={phone ? 'day' : 'week'}
          timeZone={teacher.timezone}
          weekStartDay={1}
          events={events}
          resources={resources}
          autoCreate={false}
          eventEditFeature={false}
          eventMenuFeature={false}
          scheduleMenuFeature={false}
          eventTooltipFeature={false}
          eventCopyPasteFeature={false}
          dragFeature={false}
          onEventClick={onEventClick}
          onDateRangeChange={onDateRangeChange}
        />
      </Card>
      <SessionDialog sessionId={selected} onClose={() => setSelected(null)} />
    </>
  );
}
