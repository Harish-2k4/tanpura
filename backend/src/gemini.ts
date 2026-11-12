// Gemini client, plain fetch. Answers are JSON constrained by a response schema, then validated
// again here; a bad or slow answer throws, and callers fall back to their rule-based version.
// Server-side only.
import { config } from './config';
import { currentContext } from './context';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const TIMEOUT_MS = 25_000;
const FAST_TIMEOUT_MS = 15_000; // short tasks (reading a message, a reminder): move on to a backup sooner

export const geminiEnabled = () => Boolean(config.gemini);

export class AiError extends Error {}
export class AiLimitError extends AiError {}

// Hourly and daily budgets of Gemini calls, per visitor and in total, so a public demo can't use up
// the key. Past one, callers fall back to their rule-based version (the dashboard assistant says so).
export const AI_LIMITS = {
  hour: { perVisitor: 40, total: 200, message: 'The AI limit for this hour is used up. It resets at the top of the hour.' },
  day: { perVisitor: 150, total: 600, message: "Today's AI limit for this demo is used up. It resets at midnight UTC." },
};
type Window = { key: string; total: number; byVisitor: Map<string, number> };
const fresh = (): Record<keyof typeof AI_LIMITS, Window> => ({ hour: { key: '', total: 0, byVisitor: new Map() }, day: { key: '', total: 0, byVisitor: new Map() } });
let budget = fresh();

export function spendBudget() {
  const now = new Date().toISOString();
  const keys = { hour: now.slice(0, 13), day: now.slice(0, 10) };
  const visitor = currentContext()?.visitor ?? 'server';
  for (const name of ['hour', 'day'] as const) {
    const w = budget[name];
    if (w.key !== keys[name]) budget[name] = { key: keys[name], total: 0, byVisitor: new Map() };
    const { total, byVisitor } = budget[name];
    const limit = AI_LIMITS[name];
    if (total >= limit.total || (byVisitor.get(visitor) ?? 0) >= limit.perVisitor) throw new AiLimitError(limit.message);
  }
  for (const name of ['hour', 'day'] as const) {
    const w = budget[name];
    w.total++;
    w.byVisitor.set(visitor, (w.byVisitor.get(visitor) ?? 0) + 1);
  }
}
export const resetAiBudget = () => (budget = fresh());

// Gemini's response schema format (an OpenAPI subset).
export type GeminiSchema = {
  type: 'OBJECT' | 'ARRAY' | 'STRING' | 'INTEGER' | 'NUMBER' | 'BOOLEAN';
  description?: string;
  enum?: string[];
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  items?: GeminiSchema;
};

const STABLE_BACKUPS = ['gemini-3.5-flash', 'gemini-2.5-flash'];

let modelChoice: Promise<string[]> | undefined;

// The configured model (or the newest general Flash model if this key can't use it), followed by
// established Flash models as backups for when it is busy, slow or over a free-tier quota. The
// newest previews are the ones most often overloaded, so the backups are the stable ones.
function chooseModels(apiKey: string, configured: string): Promise<string[]> {
  modelChoice ??= (async () => {
    const res = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return [configured];
    const { models = [] } = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    const usable = models.filter((m) => m.supportedGenerationMethods?.includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
    const flash = usable.filter((n) => /^gemini-[\d.]+-flash$/.test(n)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    let primary = configured;
    if (!usable.includes(configured)) {
      primary = flash[0] ?? usable.find((n) => n.includes('flash')) ?? configured;
      console.warn(`[gemini] ${configured} is not available to this key; using ${primary}`);
    }
    const backups = STABLE_BACKUPS.filter((n) => usable.includes(n) && n !== primary);
    return [primary, ...(backups.length ? backups : flash.filter((n) => n !== primary).slice(0, 2))];
  })().catch(() => [configured]);
  return modelChoice;
}

// After a model fails, the backup that answered is used first for a while.
let preferred: { model: string; until: number } | undefined;
const PREFER_MS = 10 * 60_000;

// Gemini sometimes answers 429/500/503 when busy ("high demand") or stops answering; then the
// request is retried once, and after that the next model is tried.
const RETRY_STATUS = new Set([429, 500, 503]);

async function postOnce(apiKey: string, model: string, body: unknown, timeoutMs: number): Promise<Response | string> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      return `${model} did not answer: ${(e as Error).message}`; // a timeout: don't wait on it again
    }
    if (res.ok) return res;
    const why = `${model} ${res.status}: ${(await res.text()).slice(0, 200)}`;
    if (!RETRY_STATUS.has(res.status)) throw new AiError(`Gemini ${why}`);
    if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 1200));
    else return why;
  }
  return `${model} failed`;
}

async function post(apiKey: string, body: unknown, timeoutMs: number): Promise<{ model: string; res: Response }> {
  if (!config.gemini) throw new AiError('Gemini is not configured');
  spendBudget();
  let models = await chooseModels(apiKey, config.gemini.model);
  if (preferred && Date.now() < preferred.until && models.includes(preferred.model)) models = [preferred.model, ...models.filter((m) => m !== preferred!.model)];
  const problems: string[] = [];
  for (const [i, model] of models.entries()) {
    const r = await postOnce(apiKey, model, body, timeoutMs);
    if (typeof r !== 'string') {
      if (i > 0) preferred = { model, until: Date.now() + PREFER_MS };
      return { model, res: r };
    }
    problems.push(r);
    console.warn(`[gemini] ${r}${models[i + 1] ? `; trying ${models[i + 1]}` : ''}`);
  }
  throw new AiError(`Gemini is busy: ${problems.join(' | ')}`);
}

export async function generateJson<T>(opts: { system: string; prompt: string; schema: GeminiSchema; validate: (value: unknown) => T }): Promise<T> {
  if (!config.gemini) throw new AiError('Gemini is not configured');
  const { apiKey } = config.gemini;
  const { res } = await post(apiKey, {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: opts.schema },
  }, FAST_TIMEOUT_MS);

  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  try {
    return opts.validate(JSON.parse(text));
  } catch (e) {
    throw new AiError(`Gemini returned an unusable answer: ${(e as Error).message}`);
  }
}

// A raw generateContent call, for callers that build their own request (the dashboard assistant).
export async function callGemini(body: unknown): Promise<{ model: string; data: GeminiResponse }> {
  if (!config.gemini) throw new AiError('Gemini is not configured');
  const { model, res } = await post(config.gemini.apiKey, body, 45_000);
  return { model, data: (await res.json()) as GeminiResponse };
}

export type GeminiPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
};
export type GeminiResponse = {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};
