// Private demo copies. On the public demo, every sign-in gets its own copy of the demo data, so one
// visitor's sends, changes or reset never reach another. Copies expire after a day, and only the
// newest MAX_COPIES are kept.
import { randomBytes } from 'node:crypto';
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';
import { runInContext } from './context';
import { generateDemoData } from './seed';
import { saveAll } from './store';

const MAX_COPIES = 50;
const EXPIRE_MS = 24 * 60 * 60 * 1000;
const ID = /^[a-f0-9]{12}$/;

const root = () => path.resolve(config.dataDir, 'visitors');
const dirOf = (id: string) => path.join(root(), id);

export async function listWorkspaces(): Promise<{ id: string; dir: string; at: number }[]> {
  let names: string[];
  try {
    names = await readdir(root());
  } catch {
    return [];
  }
  const found = await Promise.all(
    names.filter((n) => ID.test(n)).map(async (id) => {
      try {
        return { id, dir: dirOf(id), at: (await stat(dirOf(id))).mtimeMs };
      } catch {
        return undefined;
      }
    }),
  );
  return found.filter((w) => w !== undefined).sort((a, b) => b.at - a.at);
}

// Removes expired copies, and the oldest ones beyond `keep`.
export async function pruneWorkspaces(keep = MAX_COPIES) {
  const all = await listWorkspaces();
  const now = Date.now();
  await Promise.all(all.filter((w, i) => i >= keep || now - w.at > EXPIRE_MS).map((w) => rm(w.dir, { recursive: true, force: true })));
}

export async function createWorkspace(now = new Date()): Promise<string> {
  await pruneWorkspaces(MAX_COPIES - 1);
  const id = randomBytes(6).toString('hex');
  await runInContext({ dir: dirOf(id), workspace: id }, () => saveAll(generateDemoData(now, { buyerEmail: config.demoBuyerEmail })));
  return id;
}

// The folder of a live copy, or undefined if it is unknown or has expired.
export async function workspaceDir(id: string): Promise<string | undefined> {
  if (!ID.test(id)) return undefined;
  try {
    const s = await stat(dirOf(id));
    return s.isDirectory() && Date.now() - s.mtimeMs <= EXPIRE_MS ? dirOf(id) : undefined;
  } catch {
    return undefined;
  }
}

// Runs fn for the main data and every live demo copy, each in its own context.
export async function forEachDataCopy(fn: () => Promise<void>) {
  await fn();
  for (const w of await listWorkspaces()) {
    if (Date.now() - w.at > EXPIRE_MS) continue;
    try {
      await runInContext({ dir: w.dir, workspace: w.id }, fn);
    } catch (e) {
      console.error(`[workspaces] ${w.id}:`, e); // one broken copy never stops the others
    }
  }
}
