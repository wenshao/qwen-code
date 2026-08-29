#!/usr/bin/env npx tsx
/**
 * Real-stack probe for PR #10090 — "reject ambiguous send_message
 * destinations" (fixes #10073).
 *
 * Drives the BUNDLED CLI (dist/cli.js) in a real interactive TUI against a
 * fake OpenAI server, inside an isolated HOME, with the agent-team feature
 * really enabled. The scripted model:
 *
 *   1. creates a real team via `team_create`;
 *   2. launches a real named teammate `qa-reviewer` via `agent`;
 *   3. fires a battery of `send_message` probes, one per model turn;
 *   4. finishes with a marker so the harness knows the run is done.
 *
 * The behaviour under test lives in `llmContent` — the text the MODEL sees,
 * not the TUI's `returnDisplay`. So the decisive evidence is taken off the
 * wire: every tool result is read back out of the fake server's recorded
 * request bodies, keyed by the deterministic tool_call ids below.
 *
 * Usage (from the repo root):
 *   npm run build && npm run bundle
 *   npx tsx integration-tests/terminal-capture/pr10090-send-message-destinations.ts
 *
 * Env:
 *   PR10090_OUT   output dir (screenshots + evidence json)
 *   PR10090_LABEL label stamped into the evidence json ("head" / "base")
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { TerminalCapture } from './terminal-capture.js';
import {
  fakeToolCall,
  startFakeOpenAIServer,
  type FakeOpenAIResponse,
} from '../fake-openai-server.js';

const TERMINAL_COLS = 104;
const TERMINAL_ROWS = 44;

const TEAM_NAME = 'pr10090';
const TEAMMATE_NAME = 'qa-reviewer';
const LEAD_AGENT_ID = `leader@${TEAM_NAME}`;
const TEAMMATE_MARKER = 'PR10090_TEAMMATE_PROBE';
const DONE_MARKER = 'PR10090_ALL_PROBES_DONE';
const PROMPT_TEXT = 'Run the PR10090 send_message destination probes.';

type Probe = {
  id: string;
  title: string;
  args: Record<string, unknown>;
  expectation: string;
};

/**
 * One probe per model turn so each tool result lands in its own wire frame.
 *
 * `agent-1` in P1 is deliberately a task id that does not exist: the point of
 * P1 is that the call is rejected for being ambiguous BEFORE any registry or
 * team lookup happens, so the id's validity is irrelevant.
 */
const PROBES: Probe[] = [
  {
    id: 'p1_both_fields',
    title: 'both "to" and "task_id"',
    args: { to: TEAMMATE_NAME, task_id: 'agent-1', message: 'ping' },
    expectation: 'rejected as ambiguous (never routed)',
  },
  {
    id: 'p2_task_id_is_teammate',
    title: 'task_id = teammate name (the #10073 report)',
    args: { task_id: TEAMMATE_NAME, message: 'ping' },
    expectation: 'not found + team-destination hint',
  },
  {
    id: 'p3_task_id_is_teammate_unsanitized',
    title: 'task_id = "QA Reviewer" (sanitizes to the teammate)',
    args: { task_id: 'QA Reviewer', message: 'ping' },
    expectation: 'not found + team-destination hint',
  },
  {
    id: 'p4_task_id_is_leader',
    title: 'task_id = "leader"',
    args: { task_id: 'leader', message: 'ping' },
    expectation: 'not found + team-destination hint',
  },
  {
    id: 'p5_task_id_is_leader_mixed_case',
    title: 'task_id = "Leader" (case-insensitive leader)',
    args: { task_id: 'Leader', message: 'ping' },
    expectation: 'not found + team-destination hint',
  },
  {
    id: 'p6_task_id_is_lead_agent_id',
    title: `task_id = "${LEAD_AGENT_ID}" (leadAgentId)`,
    args: { task_id: LEAD_AGENT_ID, message: 'ping' },
    expectation: 'not found + team-destination hint',
  },
  {
    id: 'p7_task_id_leader_bang',
    title: 'task_id = "Leader!" (the "to" route would NOT accept it)',
    args: { task_id: 'Leader!', message: 'ping' },
    expectation: 'not found, NO hint',
  },
  {
    id: 'p8_task_id_unknown',
    title: 'task_id = "no-such-task-anywhere"',
    args: { task_id: 'no-such-task-anywhere', message: 'ping' },
    expectation: 'not found, NO hint',
  },
  {
    id: 'p9_task_id_star',
    title: 'task_id = "*" (the "to" route accepts * as broadcast)',
    args: { task_id: '*', message: 'ping' },
    expectation: 'not found; hint behaviour is the open question',
  },
  {
    id: 'p10_to_only_control',
    title: 'CONTROL: to = teammate name only',
    args: { to: TEAMMATE_NAME, message: 'ping from the control probe' },
    expectation: 'delivered normally (no regression)',
  },
];

/** Optional probe subset, e.g. PR10090_ONLY=p1_both_fields,p10_to_only_control */
const ONLY = (process.env['PR10090_ONLY'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ACTIVE_PROBES = ONLY.length
  ? PROBES.filter((p) => ONLY.includes(p.id))
  : PROBES;

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  return content === undefined ? '' : JSON.stringify(content);
}

function roleContentMessages(body: Record<string, unknown>): string {
  const messages = body['messages'];
  if (!Array.isArray(messages)) return '';
  return messages
    .filter(
      (m): m is Record<string, unknown> => typeof m === 'object' && m !== null,
    )
    .filter((m) => m['role'] === 'system' || m['role'] === 'user')
    .map((m) => messageText(m['content']))
    .join('\n');
}

function startProbeServer(): ReturnType<typeof startFakeOpenAIServer> {
  let leaderTurn = 0;
  const verbose = process.env['PR10090_VERBOSE'] === '1';
  const log = (...args: unknown[]) => {
    if (verbose) console.error('[fake-openai]', ...args);
  };

  return startFakeOpenAIServer(({ body, requestIndex }) => {
    const roleContent = roleContentMessages(body);
    // The teammate's own loop carries the marker we planted in its prompt.
    if (roleContent.includes(TEAMMATE_MARKER)) {
      log('teammate turn (req', requestIndex + 1, ')');
      return {
        content: 'Standing by.',
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      } satisfies FakeOpenAIResponse;
    }

    leaderTurn += 1;
    log('leader turn', leaderTurn, '(req', requestIndex + 1, ')');

    if (leaderTurn === 1) {
      return {
        toolCalls: [
          fakeToolCall('team_create', { team_name: TEAM_NAME }, 'call_team'),
        ],
        usage: { prompt_tokens: 32, completion_tokens: 16, total_tokens: 48 },
      };
    }

    if (leaderTurn === 2) {
      return {
        toolCalls: [
          fakeToolCall(
            'agent',
            {
              description: 'QA reviewer standby',
              prompt: `${TEAMMATE_MARKER}: stand by and do nothing. Reply "Standing by."`,
              name: TEAMMATE_NAME,
            },
            'call_launch',
          ),
        ],
        usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 },
      };
    }

    const probeIndex = leaderTurn - 3;
    if (probeIndex < ACTIVE_PROBES.length) {
      const probe = ACTIVE_PROBES[probeIndex];
      return {
        toolCalls: [
          fakeToolCall('send_message', probe.args, `call_${probe.id}`),
        ],
        usage: { prompt_tokens: 50, completion_tokens: 12, total_tokens: 62 },
      };
    }

    return {
      content: DONE_MARKER,
      usage: { prompt_tokens: 60, completion_tokens: 4, total_tokens: 64 },
    };
  });
}

type ToolResult = { toolCallId: string; content: string };

/** Pull every `role: "tool"` frame out of every recorded request body. */
function collectToolResults(
  requests: Array<{ body: Record<string, unknown> }>,
): Map<string, string> {
  const results = new Map<string, string>();
  for (const req of requests) {
    const messages = req.body['messages'];
    if (!Array.isArray(messages)) continue;
    for (const raw of messages) {
      if (typeof raw !== 'object' || raw === null) continue;
      const m = raw as Record<string, unknown>;
      if (m['role'] !== 'tool') continue;
      const id = m['tool_call_id'];
      if (typeof id !== 'string') continue;
      if (!results.has(id)) results.set(id, messageText(m['content']));
    }
  }
  return results;
}

async function main(): Promise<void> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(scriptDir, '../..');
  const label = process.env['PR10090_LABEL'] ?? 'head';
  const outputDir = resolve(
    process.env['PR10090_OUT'] ?? join(tmpdir(), `pr10090-${label}`),
  );

  if (existsSync(outputDir)) rmSync(outputDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  const fakeServer = await startProbeServer();
  console.error('[fake-openai] baseUrl =', fakeServer.baseUrl);

  const homeDir = join(outputDir, 'home');
  mkdirSync(homeDir, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: '1',
    NODE_NO_WARNINGS: '1',
    QWEN_CODE_DISABLE_SYNCHRONIZED_OUTPUT: '1',
    QWEN_CODE_NO_RELAUNCH: '1',
    QWEN_CODE_ENABLE_AGENT_TEAM: '1',
    QWEN_SANDBOX: 'false',
    TERM: 'xterm-256color',
    HOME: homeDir,
    USERPROFILE: homeDir,
  };
  delete env['NO_COLOR'];
  delete env['QWEN_CODE_SIMPLE'];
  for (const key of [
    'HTTP_PROXY',
    'http_proxy',
    'HTTPS_PROXY',
    'https_proxy',
    'ALL_PROXY',
    'all_proxy',
  ]) {
    delete env[key];
  }

  const terminal = await TerminalCapture.create({
    cols: TERMINAL_COLS,
    rows: TERMINAL_ROWS,
    cwd: repoRoot,
    outputDir,
    title: `PR #10090 send_message destinations — ${label}`,
    theme: 'github-dark',
    chrome: false,
    fontSize: 14,
    env,
  });

  let doneMarkerSeen = true;
  try {
    await terminal.spawn('node', [
      'dist/cli.js',
      '--approval-mode',
      'yolo',
      '--auth-type',
      'openai',
      '--openai-api-key',
      'dummy',
      '--openai-base-url',
      fakeServer.baseUrl,
      '--model',
      'dummy',
    ]);
    await terminal.waitFor('Type your message', { timeout: 60000 });

    await terminal.type(PROMPT_TEXT, { slow: true, delay: 8 });
    await terminal.idle(400, 4000);
    await terminal.type('\n');

    try {
      await terminal.waitFor(DONE_MARKER, { timeout: 180000 });
    } catch {
      doneMarkerSeen = false;
      console.error('[warn] done marker never appeared; capturing anyway');
    }
    await terminal.idle(1500, 8000);

    await terminal.capture(`pr10090-${label}-viewport.png`, outputDir);
    await terminal.captureFull(`pr10090-${label}-full.png`, outputDir);

    const screenText = await terminal.getScreenText();
    writeFileSync(join(outputDir, 'screen.txt'), screenText, 'utf8');
    writeFileSync(
      join(outputDir, 'raw.ansi'),
      terminal.getRawOutput(),
      'utf8',
    );

    const toolResults = collectToolResults(
      fakeServer.requests as Array<{ body: Record<string, unknown> }>,
    );

    const evidence = {
      label,
      doneMarkerSeen,
      requestCount: fakeServer.requests.length,
      teamCreate: toolResults.get('call_team') ?? null,
      teammateLaunch: toolResults.get('call_launch') ?? null,
      probes: ACTIVE_PROBES.map((probe) => ({
        id: probe.id,
        title: probe.title,
        args: probe.args,
        expectation: probe.expectation,
        toolResult: toolResults.get(`call_${probe.id}`) ?? null,
      })),
    };
    const evidencePath = join(outputDir, 'evidence.json');
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

    console.log('\n===== PR #10090 wire evidence (' + label + ') =====');
    console.log('requests:', evidence.requestCount, 'done:', doneMarkerSeen);
    for (const probe of evidence.probes) {
      console.log('\n--- ' + probe.id + ' :: ' + probe.title);
      console.log('    args     : ' + JSON.stringify(probe.args));
      console.log('    expected : ' + probe.expectation);
      console.log('    observed : ' + (probe.toolResult ?? '<no result>'));
    }
    console.log('\nevidence  :', evidencePath);
    console.log('screenshots:', outputDir);
  } finally {
    await terminal.close();
    await fakeServer.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export type { Probe, ToolResult };
