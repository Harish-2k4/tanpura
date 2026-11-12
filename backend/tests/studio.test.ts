// Translation between AG Studio's AI turns and Gemini, without calling Gemini.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { studioTurnSchema } from '../src/ai/studio';

test('a Studio turn with tools and a tool round trip is accepted', () => {
  const turn = studioTurnSchema.parse({
    instructions: 'You edit dashboards.',
    input: [
      { id: 'm1', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text: 'Add a chart' }] },
      { id: 'sig:abc', kind: 'output', type: 'function_call', callId: 'c1', name: 'addWidget', arguments: '{"type":"bar"}' },
      { type: 'function_call_output', callId: 'c1', output: '{"ok":true}', status: 'completed' },
    ],
    tools: [{ name: 'addWidget', description: 'Adds a widget', parameters: { type: 'object' } }],
    toolChoice: 'auto',
    responseFormat: { type: 'text' },
  });
  assert.equal(turn.input.length, 3);
});

test('unknown item types are rejected', () => {
  assert.throws(() => studioTurnSchema.parse({ input: [{ type: 'shell_command' }], responseFormat: { type: 'text' } }));
});
