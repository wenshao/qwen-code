// Verification-only fake model for the runner's default (non-failover) mode.
// It answers the default mode's prompt the way a compliant model would: visible
// MODEL_READY text plus one write_file call, then TOOL_DONE after a tool result.
import { appendFileSync, writeFileSync } from 'node:fs';
import {
  fakeToolCall,
  startFakeOpenAIServer,
} from '../integration-tests/fake-openai-server.js';

const [portFile, logFile] = process.argv.slice(2);
const server = await startFakeOpenAIServer(({ body, requestIndex }) => {
  const messages = Array.isArray(body['messages']) ? body['messages'] : [];
  const serialized = JSON.stringify(messages);
  const tools = Array.isArray(body['tools']) ? body['tools'].length : 0;
  appendFileSync(
    logFile,
    `${JSON.stringify({ requestIndex, tools, hasToolResult: serialized.includes('"role":"tool"'), stream: body['stream'] === true })}\n`,
  );
  const pathMatch = /to this absolute path: \\"([^"\\]+)\\"/.exec(serialized);
  if (serialized.includes('MODEL_READY') && pathMatch) {
    if (serialized.includes('"role":"tool"')) return { content: 'TOOL_DONE' };
    return {
      content: 'MODEL_READY',
      toolCalls: [
        fakeToolCall('write_file', {
          file_path: pathMatch[1],
          content: 'managed agent real model tool execution complete',
        }),
      ],
    };
  }
  return { content: 'OK' };
});
writeFileSync(portFile, server.baseUrl);
process.on('SIGTERM', () => void server.close().then(() => process.exit(0)));
