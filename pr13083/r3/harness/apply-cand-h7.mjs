// Candidate for round 3 (head b4e9d71b): after a takeover drives the parked Write/Edit executions,
// record the post-effect file history and clear the pending marker, as a normal batch does.
// usage: node apply-cand-h7.mjs <tree>
import { readFileSync, writeFileSync } from 'node:fs';
const tree = process.argv[2];
const file = `${tree}/packages/cli/src/serve/hosted-runtime-recovery.ts`;
let s = readFileSync(file, 'utf8');
const edit = (from, to) => {
  if (s.split(from).length !== 2) throw new Error(`anchor not unique: ${from.slice(0, 60)}`);
  s = s.replace(from, to);
};
edit(
  `import { writeStderrLineSafe } from '../utils/stdioHelpers.js';`,
  `import { writeStderrLineSafe } from '../utils/stdioHelpers.js';
import {
  commitHostedFileHistory,
  readHostedFileHistory,
} from './hosted-file-history.js';`,
);
edit(
  `          await harness.resolveAwaitRuntime(item.executionCallId, outcomeRef);
          states.set(item.executionCallId, { state: 'settled' });
        }
      } catch (cause) {`,
  `          await harness.resolveAwaitRuntime(item.executionCallId, outcomeRef);
          states.set(item.executionCallId, { state: 'settled' });
        }
        // The dead owner prepared this batch's file history before dispatch;
        // a normal batch records the post-effect state and clears the marker
        // once its Write/Edit settle. Do the same here, or the marker outlives
        // the Turn: undo of this prompt and every later load are refused.
        const savedHistory = await readHostedFileHistory(session);
        if (savedHistory?.pendingTurn === promptId && !savedHistory.pendingUndo) {
          const state = await broker.fileHistory({
            kind: 'raw-file-history',
            action: 'snapshot',
          });
          await commitHostedFileHistory(session, {
            schemaVersion: 1,
            state,
            pendingTurn: null,
            pendingUndo: null,
          });
        }
      } catch (cause) {`,
);
writeFileSync(file, s);
console.log('round-3 candidate applied to', tree);
