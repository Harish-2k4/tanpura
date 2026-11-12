// Live updates to signed-in browsers over Server-Sent Events, e.g. "Priya paid US$90".
import type { Response } from 'express';
import type { LiveEvent } from '../../shared/api';
import { currentContext } from './context';

// Each stream belongs to one data copy, and only hears about its own invoices.
const clients = new Map<Response, string | undefined>();
const HEARTBEAT_MS = 25_000; // keeps proxies from closing an idle stream

export function subscribe(res: Response) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 5000\n\n');
  clients.set(res, currentContext()?.workspace);
  const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  res.on('close', () => {
    clearInterval(beat);
    clients.delete(res);
  });
}

export function broadcast(event: LiveEvent) {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  const workspace = currentContext()?.workspace;
  for (const [res, ws] of clients) if (ws === workspace) res.write(frame);
}
