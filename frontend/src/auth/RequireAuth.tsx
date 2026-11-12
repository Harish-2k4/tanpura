import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useMe, useTeacher } from '../api/queries';
import { WorkTypePage } from '../features/onboarding/WorkTypePage';
import { ErrorState, Loading } from '../components/ui';

// Shows its children only to a signed-in teacher; everyone else goes to the sign-in page.
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <Loading label="Starting Tanpura…" />;
  if (me.isError) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <WorkTypeGate>{children}</WorkTypeGate>;
}

// The first time in, asks for the kind of work before anything else.
function WorkTypeGate({ children }: { children: ReactNode }) {
  const teacher = useTeacher();
  if (teacher.isPending) return <Loading label="Starting Tanpura…" />;
  if (teacher.data && !teacher.data.profession) return <WorkTypePage />;
  return <>{children}</>;
}
