import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { AppLayout } from './components/AppLayout';
import { EmptyState, Loading } from './components/ui';
import { BillingPage } from './pages/billing/BillingPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { StudentsPage } from './pages/students/StudentsPage';

// The calendar and dashboard components are large; load them only when their page is opened.
const CalendarPage = lazy(() => import('./pages/calendar/CalendarPage'));
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage'));

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/billing" replace /> },
      { path: 'billing', element: <BillingPage /> },
      {
        path: 'calendar',
        element: (
          <Suspense fallback={<Loading label="Loading calendar…" />}>
            <CalendarPage />
          </Suspense>
        ),
      },
      {
        path: 'dashboard',
        element: (
          <Suspense fallback={<Loading label="Loading dashboard…" />}>
            <DashboardPage />
          </Suspense>
        ),
      },
      { path: 'students', element: <StudentsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <EmptyState title="Page not found" message="Use the tabs above to find your way." /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
