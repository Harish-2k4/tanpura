import ChatBubbleOutlined from '@mui/icons-material/ChatBubbleOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import InsightsOutlined from '@mui/icons-material/InsightsOutlined';
import Logout from '@mui/icons-material/Logout';
import PeopleOutlined from '@mui/icons-material/PeopleOutlined';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import AppBar from '@mui/material/AppBar';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useLogout, useMe, useTeacher } from '../api/queries';
import { useColorMode } from './ColorMode';
import { AssistantProvider, useAssistant } from '../features/assistant/AssistantProvider';
import { useLiveUpdates } from '../hooks/useLiveUpdates';
import { useWords } from '../hooks/useWords';

const NAV = [
  { to: '/billing', label: 'Billing', icon: <ReceiptLongOutlined fontSize="small" /> },
  { to: '/calendar', label: 'Calendar', icon: <CalendarMonthOutlined fontSize="small" /> },
  { to: '/dashboard', label: 'Dashboard', icon: <InsightsOutlined fontSize="small" /> },
  { to: '/students', label: 'students', icon: <PeopleOutlined fontSize="small" /> },
  { to: '/settings', label: 'Settings', icon: <SettingsOutlined fontSize="small" /> },
];

export function Brand({ size = 'medium' }: { size?: 'medium' | 'large' }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Box component="img" src="/favicon.svg" alt="" sx={{ width: size === 'large' ? 40 : 30, height: size === 'large' ? 40 : 30, borderRadius: 1 }} />
      <Typography variant={size === 'large' ? 'h5' : 'h6'} sx={{ fontWeight: 700, color: 'text.primary', letterSpacing: '-0.01em', display: size === 'large' ? 'block' : { xs: 'none', sm: 'block' } }}>
        Tanpura
      </Typography>
    </Stack>
  );
}

function IntegrationChips() {
  const { data: teacher } = useTeacher();
  if (!teacher) return null;
  const { paypal, ai } = teacher.integrations;
  return (
    <Stack direction="row" spacing={1} sx={{ display: { xs: 'none', md: 'flex' } }}>
      <Tooltip title={paypal === 'sandbox' ? 'Invoices are created in the PayPal sandbox' : 'No PayPal keys: invoices are recorded here only'}>
        <Chip size="small" variant="outlined" color={paypal === 'sandbox' ? 'success' : 'warning'} label={paypal === 'sandbox' ? 'PayPal sandbox' : 'PayPal mock'} />
      </Tooltip>
      <Tooltip title={ai === 'live' ? 'AI assistant uses Gemini' : 'No Gemini key: AI features use sample answers'}>
        <Chip size="small" variant="outlined" color={ai === 'live' ? 'success' : 'warning'} label={ai === 'live' ? 'AI live' : 'AI mock'} />
      </Tooltip>
    </Stack>
  );
}

function UserMenu() {
  const { data: me } = useMe();
  const { data: teacher } = useTeacher();
  const logout = useLogout();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const initial = (teacher?.name ?? me?.email ?? '?').charAt(0).toUpperCase();

  return (
    <>
      <Tooltip title="Account">
        <IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label="Account menu">
          <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.dark', color: '#fff', fontSize: 15 }}>{initial}</Avatar>
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle2">{teacher?.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {me?.email}
          </Typography>
        </Box>
        <MenuItem
          disabled={logout.isPending}
          onClick={() => {
            setAnchor(null);
            logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) });
          }}
        >
          <ListItemIcon>
            <Logout fontSize="small" />
          </ListItemIcon>
          Sign out
        </MenuItem>
      </Menu>
    </>
  );
}

function ColorModeButton() {
  const { mode, toggle } = useColorMode();
  const label = mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <Tooltip title={label}>
      <IconButton onClick={toggle} aria-label={label}>
        {mode === 'dark' ? <LightModeOutlined /> : <DarkModeOutlined />}
      </IconButton>
    </Tooltip>
  );
}

function AssistantButton() {
  const w = useWords();
  const assistant = useAssistant();
  return (
    <Tooltip describeChild title={`Paste a message from a ${w.family}, or describe your day`}>
      <Button variant="contained" aria-label="Assistant" startIcon={<ChatBubbleOutlined />} onClick={() => assistant.open()} sx={{ whiteSpace: 'nowrap', minWidth: { xs: 0, sm: 'auto' }, '.MuiButton-startIcon': { mr: { xs: 0, sm: 1 } } }}>
        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
          Assistant
        </Box>
      </Button>
    </Tooltip>
  );
}

export function AppLayout() {
  useLiveUpdates(true);
  return (
    <AssistantProvider>
      <Shell />
    </AssistantProvider>
  );
}

function Shell() {
  const w = useWords();
  const { pathname } = useLocation();
  const current = NAV.find((n) => pathname.startsWith(n.to))?.to ?? false;
  const label = (l: string) => (l === 'students' ? w.Students : l);
  const tabs = (
    <Tabs value={current} variant="scrollable" scrollButtons={false} sx={{ minWidth: 0, '.MuiTab-root': { minHeight: { xs: 48, md: 64 }, px: { xs: 1.5, md: 2 } } }}>
      {NAV.map((n) => (
        <Tab key={n.to} value={n.to} label={label(n.label)} icon={n.icon} iconPosition="start" component={Link} to={n.to} />
      ))}
    </Tabs>
  );

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar sx={{ gap: { xs: 1, md: 2 } }}>
          <Box component={Link} to="/billing" sx={{ textDecoration: 'none' }} aria-label="Tanpura home">
            <Brand />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0, display: { xs: 'none', md: 'block' } }}>{tabs}</Box>
          <Box sx={{ flex: 1, display: { xs: 'block', md: 'none' } }} />
          <Box sx={{ display: { xs: 'none', lg: 'flex' } }}>
            <IntegrationChips />
          </Box>
          <AssistantButton />
          <ColorModeButton />
          <UserMenu />
        </Toolbar>
        <Box sx={{ display: { xs: 'block', md: 'none' }, borderTop: 1, borderColor: 'divider' }}>{tabs}</Box>
      </AppBar>
      <Box component="main" sx={{ flex: 1, width: '100%', maxWidth: 1440, mx: 'auto', px: { xs: 1.5, md: 3 }, py: { xs: 1.5, md: 2.5 } }}>
        <Outlet />
      </Box>
    </Box>
  );
}
