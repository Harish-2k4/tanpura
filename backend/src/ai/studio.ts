// AG Studio's AI assistant, backed by Gemini. The browser sends one conversation turn in AG
// Studio's format; this translates it to a Gemini request (Studio's dashboard tools become Gemini
// function declarations) and translates the answer back. The Gemini key never leaves the server.
// The assistant only reads and edits the dashboard: it has no access to invoices or classes.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { callGemini, type GeminiPart } from '../gemini';

// Only the fields we use; Studio sends more, which are ignored.
const textContent = z.object({ type: z.string(), text: z.string().optional() }).passthrough();
const item = z.union([
  z.object({ type: z.literal('message'), role: z.enum(['user', 'system', 'assistant']), content: z.array(textContent) }).passthrough(),
  z.object({ type: z.literal('function_call'), id: z.string().optional(), callId: z.string(), name: z.string(), arguments: z.string() }).passthrough(),
  z.object({ type: z.literal('function_call_output'), callId: z.string(), output: z.string() }).passthrough(),
  z.object({ type: z.literal('reasoning') }).passthrough(),
]);

export const studioTurnSchema = z.object({
  instructions: z.string().max(200_000).optional(),
  input: z.array(item).max(400),
  tools: z.array(z.object({ name: z.string(), description: z.string(), parameters: z.record(z.string(), z.unknown()) }).passthrough()).max(100).optional(),
  toolChoice: z.union([z.enum(['auto', 'none', 'required']), z.object({ name: z.string() })]).optional(),
  responseFormat: z.union([z.object({ type: z.literal('text') }), z.object({ type: z.literal('json'), name: z.string(), schema: z.record(z.string(), z.unknown()) }).passthrough()]),
});
type Turn = z.infer<typeof studioTurnSchema>;

// Gemini 3 needs each function call's "thought signature" sent back on the next turn; Studio keeps
// the call's id, so the signature travels inside it.
const SIG = 'sig:';
const textOf = (content: { text?: string }[]) => content.map((c) => c.text ?? '').join('');

function toGemini(turn: Turn) {
  const system = [turn.instructions ?? ''];
  const contents: { role: 'user' | 'model'; parts: GeminiPart[] }[] = [];
  const names = new Map<string, string>();
  const push = (role: 'user' | 'model', part: GeminiPart) => {
    const last = contents.at(-1);
    if (last?.role === role) last.parts.push(part);
    else contents.push({ role, parts: [part] });
  };

  for (const it of turn.input) {
    if (it.type === 'message') {
      const text = textOf(it.content);
      if (!text) continue;
      if (it.role === 'system') system.push(text);
      else push(it.role === 'user' ? 'user' : 'model', { text });
    } else if (it.type === 'function_call') {
      names.set(it.callId, it.name);
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(it.arguments || '{}');
      } catch {
        // Malformed arguments from an earlier turn: send an empty object.
      }
      const signature = it.id?.startsWith(SIG) ? it.id.slice(SIG.length) : undefined;
      push('model', { functionCall: { name: it.name, args }, ...(signature ? { thoughtSignature: signature } : {}) });
    } else if (it.type === 'function_call_output') {
      let output: unknown = it.output;
      try {
        output = JSON.parse(it.output);
      } catch {
        // Plain text result.
      }
      push('user', { functionResponse: { name: names.get(it.callId) ?? 'tool', response: { result: output } } });
    }
  }

  const choice = turn.toolChoice;
  return {
    systemInstruction: { parts: [{ text: system.filter(Boolean).join('\n\n') }] },
    contents,
    ...(turn.tools?.length
      ? {
          tools: [{ functionDeclarations: turn.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }],
          toolConfig: {
            functionCallingConfig:
              choice === 'none' ? { mode: 'NONE' } : choice === 'required' ? { mode: 'ANY' } : typeof choice === 'object' ? { mode: 'ANY', allowedFunctionNames: [choice.name] } : { mode: 'AUTO' },
          },
        }
      : {}),
    generationConfig: {
      temperature: 0.2,
      ...(turn.responseFormat.type === 'json' ? { responseMimeType: 'application/json', responseJsonSchema: turn.responseFormat.schema } : {}),
    },
  };
}

export async function runStudioTurn(turn: Turn) {
  const { model, data } = await callGemini(toGemini(turn));
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const output: unknown[] = [];
  const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
  if (text) {
    output.push({ id: `msg_${randomUUID()}`, kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text, annotations: [] }] });
  }
  for (const p of parts) {
    if (!p.functionCall) continue;
    const callId = p.functionCall.id ?? `call_${randomUUID()}`;
    output.push({
      id: p.thoughtSignature ? `${SIG}${p.thoughtSignature}` : `fc_${randomUUID()}`,
      kind: 'output',
      type: 'function_call',
      callId,
      name: p.functionCall.name,
      arguments: JSON.stringify(p.functionCall.args ?? {}),
      status: 'completed',
    });
  }
  const finish = data.candidates?.[0]?.finishReason;
  return {
    id: `resp_${randomUUID()}`,
    createdAt: Math.floor(Date.now() / 1000),
    status: finish === 'MAX_TOKENS' ? 'incomplete' : 'completed',
    ...(finish === 'MAX_TOKENS' ? { incompleteDetails: { reason: 'max_output_tokens' } } : {}),
    output,
    model,
    usage: { inputTokens: data.usageMetadata?.promptTokenCount ?? 0, outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0 },
  };
}
