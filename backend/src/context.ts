// Per-request context: which data folder this request uses (each demo visitor has their own copy)
// and who is asking (for the daily AI budget). Carried through async calls by AsyncLocalStorage.
import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestContext = { dir: string; workspace?: string; visitor?: string };

const storage = new AsyncLocalStorage<RequestContext>();

export const runInContext = <T>(ctx: RequestContext, fn: () => T): T => storage.run(ctx, fn);
export const currentContext = () => storage.getStore();

// Short code used in PayPal invoice numbers, so demo copies never share a number.
export const workspaceCode = (id: string) => id.slice(0, 6);
