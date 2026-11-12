// The AG Studio dashboard over Tanpura's own data, with the custom payment-rhythm widget.
// The layout can be edited; edits are kept in this browser only.
import EditOutlined from '@mui/icons-material/EditOutlined';
import RestartAlt from '@mui/icons-material/RestartAlt';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Box from '@mui/material/Box';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { AgStudioAiModule, type AgReportState, type AgStudioApi, type AgStudioMode } from 'ag-studio';
import { AgStudio, AgStudioProvider, createWidgets } from 'ag-studio-react';
import { useMemo, useRef, useState } from 'react';
import type { DashboardData } from '../../../../shared/api';
import { useDashboardData, useTeacher } from '../../api/queries';
import { useConfirm } from '../../components/ConfirmDialog';
import { PageHeader, QueryState } from '../../components/ui';
import { dashboardAi } from './studio/ai';
import { buildStudioData } from './studio/data';
import { paymentHeatmap, type TanpuraRegistry } from './studio/heatmap';
import { buildDashboardReport, pageTitles } from './studio/report';
import { useWords, type UiWords } from '../../hooks/useWords';
import { studioThemeFor } from './studio/theme';

// Saved per profession, since the report's titles use its words.
const storageKey = (w: UiWords) => `tanpura.dashboard.v1.${w.pro}`;

const widgets = createWidgets<TanpuraRegistry>({
  additionalTypes: [paymentHeatmap],
  menu: [{ label: 'Tanpura', widgetIds: ['payment-heatmap'] }],
});

function loadSaved(w: UiWords): AgReportState<TanpuraRegistry> | undefined {
  try {
    const raw = localStorage.getItem(storageKey(w));
    return raw ? (JSON.parse(raw) as AgReportState<TanpuraRegistry>) : undefined;
  } catch {
    return undefined;
  }
}

function save(w: UiWords, state: AgReportState<TanpuraRegistry> | undefined) {
  try {
    if (state) localStorage.setItem(storageKey(w), JSON.stringify(state));
    else localStorage.removeItem(storageKey(w));
  } catch {
    // Storage can be blocked (private windows); the dashboard still works without it.
  }
}

export default function DashboardPage() {
  const w = useWords();
  return <QueryState query={useDashboardData()}>{(data) => <Dashboard key={w.pro} data={data} w={w} />}</QueryState>;
}

function Dashboard({ data, w }: { data: DashboardData; w: UiWords }) {
  const dashboardReport = useMemo(() => buildDashboardReport(w), [w]);
  const apiRef = useRef<AgStudioApi | null>(null);
  const [mode, setMode] = useState<AgStudioMode>('view');
  const [version, setVersion] = useState(0); // remounts Studio after a reset
  const [initialState] = useState(() => loadSaved(w) ?? dashboardReport);
  const [page, setPage] = useState(initialState.selectedPageId ?? 'money');
  const studioData = useMemo(() => buildStudioData(data, w), [data, w]);
  const confirm = useConfirm();
  const muiTheme = useTheme();
  const phone = useMediaQuery(muiTheme.breakpoints.down('sm'));
  const studioTheme = useMemo(() => studioThemeFor(muiTheme), [muiTheme]);
  // The AI assistant appears only when the server has a Gemini key.
  const aiLive = useTeacher().data?.integrations.ai === 'live';

  const selectPage = (id: string) => {
    setPage(id);
    const api = apiRef.current;
    if (api) api.setState({ ...api.getState(), selectedPageId: id });
  };

  const reset = async () => {
    if (!(await confirm({ title: 'Reset the dashboard?', message: 'Your layout changes in this browser are removed.', confirmText: 'Reset', tone: 'danger' }))) return;
    save(w, undefined);
    setPage(dashboardReport.selectedPageId ?? 'money');
    setVersion((v) => v + 1);
    setMode('view');
  };

  return (
    <>
      <PageHeader
        title="Dashboard"
        actions={
          <>
            <Button startIcon={<RestartAlt />} onClick={reset}>
              Reset
            </Button>
            <Button variant={mode === 'edit' ? 'contained' : 'outlined'} startIcon={mode === 'edit' ? <VisibilityOutlined /> : <EditOutlined />} onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')}>
              {mode === 'edit' ? 'Done editing' : 'Edit layout'}
            </Button>
          </>
        }
      />
      {!data.licenseKey && (
        <Alert severity="info" sx={{ mb: 2 }}>
          AG Studio runs with a trial watermark until a licence key is added (AG_STUDIO_LICENSE).
        </Alert>
      )}
      <Card sx={{ overflow: 'hidden' }}>
        <Tabs value={page} onChange={(_, v: string) => selectPage(v)} sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
          {Object.entries(pageTitles(w)).map(([id, label]) => (
            <Tab key={id} value={id} label={label} />
          ))}
        </Tabs>
        <Box sx={{ height: { xs: 'calc(100vh - 200px)', sm: 'calc(100vh - 290px)' }, minHeight: { xs: 520, sm: 640 } }}>
          <AgStudioProvider licenseKey={data.licenseKey} modules={aiLive ? [AgStudioAiModule] : undefined}>
            <AgStudio<TanpuraRegistry>
              key={version}
              style={{ height: '100%', width: '100%' }}
              theme={studioTheme}
              layout={{ widgetBorderEnabled: true }}
              // On a phone the filters side panel would cover the charts; the page's own filters stay.
              panels={phone ? { view: { right: [] } } : undefined}
              data={studioData}
              widgets={widgets}
              ai={aiLive ? dashboardAi : undefined}
              initialState={version ? dashboardReport : initialState}
              mode={mode}
              onApiReady={(e) => {
                apiRef.current = e.api;
              }}
              onStateUpdated={(e) => {
                save(w, e.state);
                if (e.state.selectedPageId) setPage(e.state.selectedPageId);
              }}
            />
          </AgStudioProvider>
        </Box>
      </Card>
    </>
  );
}
