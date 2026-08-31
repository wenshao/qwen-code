// Standalone launcher for the repo-owned fake OpenAI server.
// Holds each completion open for FAKE_DELAY_MS so the Java probe can inject a
// real control_request into the CLI while the prompt turn is still in flight.
import { writeFileSync } from 'node:fs';
import { startFakeOpenAIServer } from '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/d9018161-2c31-4088-93f7-e0e1e5cdd1bf/scratchpad/pr9924/head/integration-tests/fake-openai-server.js';

const delayMs = Number(process.env['FAKE_DELAY_MS'] ?? '4000');
const portFile = process.env['FAKE_PORT_FILE'] ?? '/tmp/pr9924-fake-openai.url';

const fake = await startFakeOpenAIServer(
  async () =>
    await new Promise((resolve) =>
      setTimeout(
        () => resolve({ content: 'real-cli probe answer' }),
        delayMs,
      ),
    ),
);
writeFileSync(portFile, fake.baseUrl);
console.log(`fake-openai listening on ${fake.baseUrl} (delay ${delayMs}ms)`);
process.on('SIGTERM', () => {
  void fake.close().then(() => process.exit(0));
});
