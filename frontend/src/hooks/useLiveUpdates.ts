// Listens for live updates from the server (e.g. a family paid on PayPal): shows a toast and
// refreshes billing data. The browser reconnects by itself if the stream drops.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { LiveEvent } from '../../../shared/api';
import { refreshBilling } from '../api/queries';
import { toast } from '../components/toast';

export function useLiveUpdates(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/events');
    source.onmessage = (e: MessageEvent<string>) => {
      try {
        const event = JSON.parse(e.data) as LiveEvent;
        (event.type === 'invoice-paid' ? toast.success : toast.info)(event.message);
        void refreshBilling(qc);
      } catch {
        // Ignore anything that isn't one of our events.
      }
    };
    return () => source.close();
  }, [enabled, qc]);
}
