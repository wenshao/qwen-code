/**
 * PR #10802 verification rig — partially-cancelled Goal tool batch.
 *
 * Drives a REAL bundled qwen CLI in a PTY against a fake OpenAI endpoint.
 * Scenario: one Goal turn issues TWO shell calls in one response — a fast
 * `echo start` and a long `sleep`. The user presses Esc while the second is
 * still running, so the completed batch is partially cancelled.
 *
 * Oracle (host-independent, machine readable):
 *   1) number of `agent` model requests after the Esc  (0 => Goal stopped)
 *   2) final goal record status + lastReason from the chat JSONL journal
 *   3) rendered TUI screen text (for the screenshots)
 */
import { createRequire } from 'node:module';
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { startFakeOpenAI } from './fake-openai.mjs';

const WT = process.env.WT; // worktree root (has dist/cli.js)
const OUT = process.env.OUT; // output dir
const ARM = process.env.ARM ?? 'unknown';
const PRESS_ESC = process.env.PRESS_ESC !== '0';
const POST_ESC_WAIT = Number(process.env.POST_ESC_WAIT ?? 45000);
if (!WT || !OUT) throw new Error('WT and OUT are required');

const require_ = createRequire(join(WT, 'package.json'));
const pty = require_('@lydell/node-pty');
const xtermHeadless = require_('@xterm/headless');
const Terminal = xtermHeadless.Terminal ?? xtermHeadless.default?.Terminal;

const ESC = '\u001b';
const ANSI_RE = new RegExp(
  ESC + '\\[[0-9;?]*[a-zA-Z]|' + ESC + '\\][^\u0007]*\u0007|' + ESC + '[()#][0-9A-Za-z]',
  'g',
);
const stripAnsi = (s) => s.replace(ANSI_RE, '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const WORK = join(OUT, 'workspace');
const HOME = join(OUT, 'home');
const QWEN_HOME = join(HOME, '.qwen');
mkdirSync(WORK, { recursive: true });
mkdirSync(QWEN_HOME, { recursive: true });

writeFileSync(
  join(QWEN_HOME, 'settings.json'),
  JSON.stringify(
    {
      ui: { enableFollowupSuggestions: false },
      privacy: { usageStatisticsEnabled: false },
    },
    null,
    2,
  ),
);
writeFileSync(
  join(QWEN_HOME, 'trustedFolders.json'),
  JSON.stringify({ [WORK]: 'TRUST_FOLDER' }, null, 2),
);

// ── the scripted model ────────────────────────────────────────────────────
// SCENARIO=partial : one response issues `echo start` + a long sleep; Esc lands
//                    while only the sleep is still running (partial cancel).
// SCENARIO=stream  : the model streams text slowly; Esc lands mid-stream.
const SCENARIO = process.env.SCENARIO ?? 'partial';
// A genuinely long foreground command that the shell guard admits.
const LONG =
  'sleep 300 # intentional-sleep: hold the paired tool batch open for the interrupt probe';
const LONG_MARK = 'intentional-sleep';
let escAt = 0;
let agentRequests = 0;

const server = await startFakeOpenAI({
  logPath: join(OUT, 'wire.jsonl'),
  script: ({ kind }) => {
    if (kind === 'judge') {
      // never satisfied -> the Goal keeps looping unless something stops it
      return {
        content: JSON.stringify({
          ok: false,
          reason: 'the counted-files line was not pasted yet',
        }),
        summary: 'judge: not yet',
      };
    }
    agentRequests += 1;
    if (SCENARIO === 'loop') {
      // The same blocked call every turn -> the loop detector halts the turn.
      return {
        content: 'Running the paired calls now.',
        toolCalls: [
          {
            name: 'run_shell_command',
            args: {
              command: 'echo start',
              description: 'Print start (required first paired call)',
            },
          },
          {
            name: 'run_shell_command',
            args: {
              command: 'sleep 400',
              description: 'Long-running second paired call',
            },
          },
        ],
        summary: `agent#${agentRequests}: repeated identical batch`,
      };
    }
    if (SCENARIO === 'stream') {
      return {
        contentChunks: Array.from(
          { length: 120 },
          (_, i) => `thinking about step ${i + 1} of the objective... `,
        ),
        chunkDelayMs: 700,
        summary: `agent#${agentRequests}: slow text stream`,
      };
    }
    // Every agent turn issues the same paired batch: one fast, one long.
    return {
      content: 'Running the paired calls now.',
      toolCalls: [
        {
          name: 'run_shell_command',
          args: {
            command: 'echo start',
            description: 'Print start (required first paired call)',
          },
        },
        {
          name: 'run_shell_command',
          args: {
            command: LONG,
            description: 'Long-running second paired call',
          },
        },
      ],
      summary: `agent#${agentRequests}: paired echo+${LONG}`,
    };
  },
});

// ── the terminal ──────────────────────────────────────────────────────────
const cols = 120,
  rows = 40;
const term = new Terminal({
  cols,
  rows,
  scrollback: 4000,
  allowProposedApi: true,
});
let raw = '';
let pending = Promise.resolve();

const env = {
  ...process.env,
  HOME,
  QWEN_HOME,
  OPENAI_API_KEY: 'fake-key',
  OPENAI_BASE_URL: server.baseUrl,
  OPENAI_MODEL: 'fake-model',
  QWEN_MODEL: 'fake-model',
  QWEN_CODE_DISABLE_CRON: '1',
  NO_PROXY: '127.0.0.1,localhost',
  no_proxy: '127.0.0.1,localhost',
  http_proxy: '',
  https_proxy: '',
  HTTP_PROXY: '',
  HTTPS_PROXY: '',
  ALL_PROXY: '',
  all_proxy: '',
  TERM: 'xterm-256color',
};
delete env.NO_COLOR;

const bundle = join(WT, 'dist', 'cli.js');
if (!existsSync(bundle)) throw new Error(`missing bundle: ${bundle}`);

const p = pty.spawn('node', [bundle, '--approval-mode', 'yolo'], {
  name: 'xterm-256color',
  cols,
  rows,
  cwd: WORK,
  env,
});
p.onData((d) => {
  raw += d;
  pending = pending.then(() => new Promise((r) => term.write(d, r)));
});

const flush = () => pending;
async function screen() {
  await flush();
  const buf = term.buffer.active;
  const lines = [];
  for (let i = 0; i < buf.length; i++) {
    const l = buf.getLine(i);
    lines.push(l ? l.translateToString(true) : '');
  }
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n');
}
async function waitForRaw(text, timeout = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (stripAnsi(raw).toLowerCase().includes(text.toLowerCase())) return;
    await sleep(200);
  }
  throw new Error(
    `timeout waiting for ${JSON.stringify(text)}\ntail:\n${stripAnsi(raw).slice(-1500)}`,
  );
}
async function type(text) {
  for (const ch of text) {
    p.write(ch);
    await sleep(4);
  }
  await sleep(400);
  p.write('\r');
}
async function shot(name) {
  const s = await screen();
  writeFileSync(join(OUT, `screen-${name}.txt`), s);
  writeFileSync(join(OUT, `raw-${name}.ans`), raw);
  return s;
}

const result = { arm: ARM, scenario: SCENARIO, worktree: WT, pressedEsc: PRESS_ESC };
try {
  await waitForRaw('Type your message', 60000);
  await shot('00-boot');

  const OBJECTIVE =
    'Outcome: report.txt contains COUNTED. Done when: 1) in ONE single response you call the shell tool twice at once, first with `echo start` and second with `' +
    LONG +
    '`, and paste both outputs; 2) you ran `echo COUNTED > report.txt`; 3) cat report.txt prints COUNTED (paste that line). Must not: skip the paired two-call response. Budget: stop as blocked after 5 turns.';
  await type('/goal ' + OBJECTIVE);

  // wait for the Goal turn to reach the interruptible moment
  const t0 = Date.now();
  let ready = false;
  while (Date.now() - t0 < 90000) {
    const s = await screen();
    if (SCENARIO === 'loop') {
      if (s.includes('A potential loop was detected')) {
        ready = true;
        break;
      }
    } else if (SCENARIO === 'stream') {
      if (s.includes('thinking about step 4')) {
        ready = true;
        break;
      }
    } else if (
      /[✓v]\s*Shell echo start/.test(s) &&
      s.includes(LONG_MARK) &&
      !s.includes('Blocked:')
    ) {
      ready = true;
      break;
    }
    await sleep(500);
  }
  result.reachedPairedBatch = ready;
  await shot('10-before-esc');
  result.agentRequestsBeforeEsc = agentRequests;

  if (!ready) throw new Error('never reached the paired batch:\n' + (await screen()));

  // let the fast call visibly finish
  await sleep(SCENARIO === 'stream' ? 1500 : 5000);
  await shot('11-batch-running');

  if (PRESS_ESC) {
    escAt = Date.now();
    result.escAt = escAt;
    result.agentRequestsAtEsc = agentRequests;
    p.write(ESC); // Esc
  }

  // Give the app a generous window to either stop or start another Goal turn.
  await sleep(POST_ESC_WAIT);
  await shot('20-after-esc');
  result.agentRequestsAfterEsc =
    agentRequests - (result.agentRequestsAtEsc ?? agentRequests);

  // Ask the card for the reason
  await type('/goal');
  await sleep(8000);
  await shot('30-goal-card');

  result.agentRequestsFinal = agentRequests;
} catch (e) {
  result.error = String(e && e.stack ? e.stack : e);
  try {
    await shot('99-error');
  } catch {}
} finally {
  // harvest the goal journal from the chat JSONL
  try {
    const projects = QWEN_HOME;
    const goalRecords = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const f = join(dir, e.name);
        if (e.isDirectory()) walk(f);
        else if (e.name.endsWith('.jsonl')) {
          for (const line of readFileSync(f, 'utf8').split('\n')) {
            if (!line.trim()) continue;
            let rec;
            try {
              rec = JSON.parse(line);
            } catch {
              continue;
            }
            if (rec?.subtype === 'goal_state') goalRecords.push(rec);
          }
        }
      }
    };
    if (existsSync(projects)) walk(projects);
    goalRecords.sort((a, b) =>
      String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? '')),
    );
    result.goalRecords = goalRecords.map((r) => ({
      ts: r.timestamp,
      cause: r.systemPayload?.cause,
      status: r.systemPayload?.snapshot?.goal?.status ?? r.systemPayload?.goal?.status,
      lastReason:
        r.systemPayload?.snapshot?.goal?.lastReason ??
        r.systemPayload?.goal?.lastReason,
      turnCount:
        r.systemPayload?.snapshot?.goal?.turnCount ??
        r.systemPayload?.goal?.turnCount,
    }));
    writeFileSync(
      join(OUT, 'goal-records-raw.json'),
      JSON.stringify(goalRecords, null, 2),
    );
  } catch (e) {
    result.journalError = String(e);
  }

  result.modelRequests = server.requests.map((r) => ({
    idx: r.idx,
    kind: r.kind,
    at: r.at,
    afterEsc: escAt ? r.at > escAt : null,
  }));
  result.agentAfterEscCount = escAt
    ? server.requests.filter((r) => r.kind === 'agent' && r.at > escAt).length
    : null;
  result.judgeAfterEscCount = escAt
    ? server.requests.filter((r) => r.kind === 'judge' && r.at > escAt).length
    : null;

  writeFileSync(join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  try {
    p.kill();
  } catch {}
  term.dispose();
  await server.close();
  console.log(
    JSON.stringify(
      {
        arm: ARM,
        scenario: SCENARIO,
        reachedPairedBatch: result.reachedPairedBatch,
        agentAfterEsc: result.agentAfterEscCount,
        judgeAfterEsc: result.judgeAfterEscCount,
        goalStates: result.goalRecords?.map(
          (g) => `${g.cause}/${g.status}/${g.lastReason ?? '-'}`,
        ),
        error: result.error?.split('\n')[0],
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
