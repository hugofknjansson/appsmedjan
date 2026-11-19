// A tiny stand-in for the Claude Messages API, used by the end-to-end test.
// It plays a fixed script: write code with a deliberate error, build, fix, build again, answer.
import http from 'node:http';

const BROKEN = `import SwiftUI

struct ContentView: View {
    var body: some View {
        Text("Vanor") // MOCK_BUILD_ERROR
    }
}
`;

const SCRIPT = [
  {
    text: 'Jag bygger en vanespårare åt dig.',
    tools: [
      { name: 'rename_app', input: { name: 'Vanor' } },
      { name: 'write_file', input: { path: 'Sources/ContentView.swift', content: BROKEN } },
      { name: 'write_file', input: { path: 'Sources/Models/Habit.swift', content: 'struct Habit { var name: String }\n' } },
    ],
  },
  { tools: [{ name: 'build_and_run', input: {} }] },
  {
    tools: [
      { name: 'edit_file', input: { path: 'Sources/ContentView.swift', old_string: ' // MOCK_BUILD_ERROR', new_string: '' } },
    ],
  },
  { tools: [{ name: 'build_and_run', input: {} }] },
  { text: 'Klart! Din vanespårare är igång. Tryck på en vana för att bocka av den.' },
];

let toolCounter = 0;

function events(step) {
  const out = [];
  const push = (type, data) => out.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  push('message_start', {
    message: {
      id: 'msg_test', type: 'message', role: 'assistant', model: 'fake', content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 },
    },
  });
  let index = 0;
  if (step.text) {
    push('content_block_start', { index, content_block: { type: 'text', text: '' } });
    for (const word of step.text.split(/(?<= )/)) push('content_block_delta', { index, delta: { type: 'text_delta', text: word } });
    push('content_block_stop', { index });
    index++;
  }
  for (const tool of step.tools ?? []) {
    push('content_block_start', {
      index,
      content_block: { type: 'tool_use', id: `toolu_${++toolCounter}`, name: tool.name, input: {} },
    });
    const json = JSON.stringify(tool.input);
    // Split the input into small pieces, the way eager input streaming delivers it.
    for (let i = 0; i < json.length; i += 40) {
      push('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: json.slice(i, i + 40) } });
    }
    push('content_block_stop', { index });
    index++;
  }
  push('message_delta', {
    delta: { stop_reason: step.tools ? 'tool_use' : 'end_turn', stop_sequence: null },
    usage: { output_tokens: 20 },
  });
  push('message_stop', {});
  return out;
}

export function startFakeAnthropic(port) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) {
        res.writeHead(404).end();
        return;
      }
      const params = JSON.parse(body);
      requests.push(params);
      // The position in the script is the number of tool-result turns sent so far.
      const turn = params.messages.filter(
        (m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'),
      ).length;
      const step = SCRIPT[Math.min(turn, SCRIPT.length - 1)];
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      for (const chunk of events(step)) {
        res.write(chunk);
        await new Promise((r) => setTimeout(r, 15));
      }
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, requests })));
}
