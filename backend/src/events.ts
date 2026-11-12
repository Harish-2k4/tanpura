// Live updates to signed-in browsers over Server-Sent Events, e.g. "Priya paid US$90".
import type { Response } from 'express';
import type { LiveEvent } from '../../shared/api';

const clients = new Set<Response>();
const HEARTBEAT_MS = 25_000; // keeps proxies from closing an idle stream

export function subscribe(res: Response) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 5000\n\n');
  clients.add(res);
  const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  res.on('close', () => {
    clearInterval(beat);
    clients.delete(res);
  });
}

export function broadcast(event: LiveEvent) {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(frame);
}
