// AG Studio's AI assistant for the dashboard. The adapter sends each turn to our backend
// (/api/assistant/studio), which asks Gemini; the key stays on the server.
import { createAiHarness, type AgAiEvent, type AgAiHarnessSetup, type AgAiPromptStarter, type AgLlmAdapter, type AgLlmResponse } from 'ag-studio';
import { api } from '../../../api/client';

const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: 'Summarise this page', prompt: 'Summarise what this page shows and what stands out.' },
  { label: 'Late payers', prompt: 'Which families take the longest to pay? Add a chart.' },
  { label: 'Cancellations', prompt: 'Add a chart of cancelled classes by month.' },
];

// Turns a finished response into the events Studio's chat streams.
function eventsOf(r: AgLlmResponse): AgAiEvent[] {
  const events: AgAiEvent[] = [];
  for (const item of r.output) {
    if (item.type === 'message') {
      const text = item.content.map((c) => (c.type === 'text' ? c.text : c.refusal)).join('');
      events.push({ type: 'TEXT_MESSAGE_START', messageId: item.id, role: 'assistant' });
      events.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: item.id, delta: text });
      events.push({ type: 'TEXT_MESSAGE_END', messageId: item.id });
    } else if (item.type === 'function_call') {
      events.push({ type: 'TOOL_CALL_START', toolCallId: item.callId, toolCallName: item.name });
      events.push({ type: 'TOOL_CALL_ARGS', toolCallId: item.callId, delta: item.arguments });
      events.push({ type: 'TOOL_CALL_END', toolCallId: item.callId });
    }
  }
  return events;
}

const geminiAdapter: AgLlmAdapter = {
  executeTurn(request) {
    const complete = api<AgLlmResponse>('/assistant/studio', { method: 'POST', body: request }).catch(
      (e: Error): AgLlmResponse => ({ id: 'error', createdAt: Date.now() / 1000, status: 'failed', output: [], error: { code: 'request_failed', message: e.message } }),
    );
    return {
      complete,
      stream: {
        async *[Symbol.asyncIterator]() {
          const r = await complete;
          if (r.error) yield { type: 'RUN_ERROR', message: r.error.message, code: r.error.code };
          else yield* eventsOf(r);
        },
      },
    };
  },
};

export const dashboardAi: AgAiHarnessSetup = ({ api: studioApi }) => createAiHarness(studioApi, { adapter: geminiAdapter, promptStarters: PROMPT_STARTERS });
