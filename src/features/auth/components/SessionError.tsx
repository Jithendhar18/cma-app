import { Button } from '@/components/ui/Button';
import { useAuth } from '../authContext';
import { AuthLayout } from './AuthLayout';
import { Notice } from './Notice';

/** The stored session could not be checked (usually the network). Recoverable. */
export function SessionError() {
  const { retry } = useAuth();
  return (
    <AuthLayout title="Could not check your session">
      <Notice tone="error">We could not reach the sign-in service. Check your connection and try again. Nothing on this device was changed.</Notice>
      <Button variant="primary" className="mt-4" onClick={retry}>Try again</Button>
    </AuthLayout>
  );
}
