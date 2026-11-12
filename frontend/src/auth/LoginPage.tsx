import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useAuthConfig, useLogin, useMe } from '../api/queries';
import { Brand } from '../components/AppLayout';

export function LoginPage() {
  const me = useMe();
  const config = useAuthConfig();
  const login = useLogin();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/billing';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (me.data) return <Navigate to={from} replace />;
  const demo = config.data?.demo;

  const submit = (credentials = { email, password }) =>
    login.mutate(credentials, { onSuccess: () => navigate(from, { replace: true }) });

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={3}>
            <Box>
              <Brand size="large" />
            </Box>
            <Stack
              component="form"
              spacing={2}
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              {login.isError && <Alert severity="error">{login.error.message}</Alert>}
              <TextField label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus fullWidth size="medium" />
              <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required fullWidth size="medium" />
              <Button type="submit" variant="contained" size="large" loading={login.isPending} disabled={!email || !password}>
                Sign in
              </Button>
            </Stack>
            {demo && (
              <Alert
                severity="info"
                action={
                  <Button color="inherit" size="small" onClick={() => submit(demo)} disabled={login.isPending}>
                    Use demo
                  </Button>
                }
              >
                Demo login: {demo.email}
              </Alert>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
