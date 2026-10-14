// usage: node mutate.mjs <tree> <mutant> — applies one named mutant; exit 1 if its anchor is not found exactly once
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [tree, name] = process.argv.slice(2);
const J = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/';
const M = {
  // design-doc mutation 1: replay cursor tiebreak includes the cursor row
  M1: [J + 'store/ManagedAgentStore.java', '" sequence_id > ? ORDER BY sequence_id ASC LIMIT ?"', '" sequence_id >= ? ORDER BY sequence_id ASC LIMIT ?"'],
  // design-doc mutation 3: WebShell replay window off by one at afterSequence (duplicate / gap)
  M3a: [J + 'api/WebShellAgentController.java', ': request.afterSequence();', ': request.afterSequence() - 1;'],
  M3b: [J + 'api/WebShellAgentController.java', ': request.afterSequence();', ': request.afterSequence() + 1;'],
  // design-doc mutation 4: resume watermark dropped to 0
  M4: ['packages/cli/src/serve/managed-runtime-tool-executor.ts', 'const MANAGED_BACKGROUND_OUTPUT_RESUME_BYTES = 4 * 1024 * 1024;', 'const MANAGED_BACKGROUND_OUTPUT_RESUME_BYTES = 0;'],
  // design-doc mutation 5: journal-commit retry mints a fresh transaction identity
  M5: ['packages/core/src/managed-runtime/http-managed-session-store.ts', '        if (!uncertain || attempt === 2) throw error;\n        await new Promise((resolve) => setTimeout(resolve, 250));\n', '        if (!uncertain || attempt === 2) throw error;\n        await new Promise((resolve) => setTimeout(resolve, 250));\n        commitBody.transactionId = randomUUID();\n'],
  // design-doc mutation 6: segment resource identity gains a fourth element
  M6: ['packages/core/src/managed-runtime/resource-tool-result-store.ts', 'JSON.stringify([captureId, streamId, ordinal])', 'JSON.stringify([captureId, streamId, ordinal, 1])'],
  // extra X1: SSE resume serves no SQL replay after a non-zero cursor (live hub only)
  X1: [J + 'service/ManagedAgentService.java', '        requireEventCursor(afterSequence);\n        return replayableEvents(session, afterSequence, STREAM_PAGE);', '        requireEventCursor(afterSequence);\n        if (afterSequence > 0) return List.of();\n        return replayableEvents(session, afterSequence, STREAM_PAGE);'],
  // extra X2: the background pipe never pauses (no 16 MiB pause watermark)
  X2: ['packages/cli/src/serve/managed-runtime-tool-executor.ts', '          if (!paused && bufferedBytes >= MANAGED_BACKGROUND_OUTPUT_PAUSE_BYTES)\n            applyPause(true);\n        },', '          if (false && !paused && bufferedBytes >= MANAGED_BACKGROUND_OUTPUT_PAUSE_BYTES)\n            applyPause(true);\n        },'],
  // extra X8: no uncertain-error re-drive of a journal commit at all
  X8: ['packages/core/src/managed-runtime/http-managed-session-store.ts', '        if (!uncertain || attempt === 2) throw error;', '        if (!uncertain || attempt === 2 || true) throw error;'],
};
const [rel, from, to] = M[name];
const file = join(tree, rel);
const text = readFileSync(file, 'utf8');
const count = text.split(from).length - 1;
if (count !== 1) { console.log(`ANCHOR ${name}: ${count} occurrences in ${rel}`); process.exit(1); }
writeFileSync(file, text.replace(from, to));
console.log(`APPLIED ${name} -> ${rel}`);
