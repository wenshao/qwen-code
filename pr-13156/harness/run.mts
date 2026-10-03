// PR #13156 real-CLI E2E: a scripted model writes one memory note through the
// real write_file tool, the host rebuilds MEMORY.md and refreshes the system
// prompt, then the model "follows" every index link it was shown by issuing a
// read_file on <memoryDir>/<decoded target>. Identical script for both arms.
import { TerminalCapture } from './tc.mts';
import {
  startFakeOpenAIServer,
  fakeToolCall,
} from '/root/verify/pr13156/head/integration-tests/fake-openai-server.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const arm = process.argv[2];
if (arm !== 'base' && arm !== 'head' && arm !== 'merged') throw new Error('arm = base|head|merged');
const MODE = process.argv[3] === 'budget' ? 'budget' : 'links';
const ROOT = '/root/verify/pr13156';
const wt = `${ROOT}/${arm}`;
const run = `${ROOT}/e2e/run-${MODE}-${arm}`;
const out = `${ROOT}/e2e/out-${MODE}-${arm}`;
fs.rmSync(run, { recursive: true, force: true });
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const home = `${run}/home`;
const project = `${run}/project`;
const membase = `${run}/membase`;
const memDir = `${membase}/memories`;
for (const d of [home, project, memDir]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(`${project}/README.md`, '# demo project\n');
execFileSync('git', ['init', '-q'], { cwd: project });
fs.mkdirSync(`${home}/.qwen`, { recursive: true });
fs.writeFileSync(
  `${home}/.qwen/settings.json`,
  JSON.stringify(
    {
      memory: { enableManagedAutoDream: false },
      ui: { hideTips: true },
      general: { disableUpdateNag: true, disableAutoUpdate: true },
    },
    null,
    2,
  ),
);

// ── Seed notes (mtimes pinned so both arms scan a byte-identical store) ──
type Seed = { rel: string; name: string; description: string; type: string };
const longP = 'p'.repeat(140);
const linkSeeds: Seed[] = [
  {
    rel: `reference/${longP}.md`,
    name: 'Long path note',
    description: 'A legacy long-filename reference note that must still resolve',
    type: 'reference',
  },
  {
    rel: 'project/mobile-release-freeze-window.md',
    name: 'Mobile release freeze window',
    description:
      'No merges to the release branch between the cut and the store submission',
    type: 'project',
  },
  {
    rel: 'reference/markdownlint-fix-rewrites-wrapped-prose.md',
    name: "A full-config markdownlint '--fix' rewrites prose that wrapped onto a marker and ubuntu-console's shim now refuses it",
    description: 'Run markdownlint with the narrow config before committing docs',
    type: 'reference',
  },
  {
    rel: 'feedback/solve-operational-issues-in-code-not-memory.md',
    name: 'Solve operational issues in code, not in memory',
    description:
      'Every runbook step that can be encoded in a script belongs in the script, not in a note',
    type: 'feedback',
  },
  {
    rel: 'feedback/提交前必须运行完整预检.md',
    name: '提交前必须先运行 npm run preflight，确认 lint、类型检查和全部单元测试通过后再推送',
    description: '跳过预检曾导致主干 CI 连续失败两天，这是团队的硬性约定',
    type: 'feedback',
  },
  {
    rel: 'project/release (2026-10) checklist.md',
    name: 'Release checklist',
    description: 'Steps for the October release cut',
    type: 'project',
  },
];
// Budget mode: 199 notes, every 5th one with a title+path whose link alone
// exceeds 150 chars, interleaved by mtime so a prefix cut hits both kinds.
const topics = ['release', 'testing', 'ci', 'review', 'docs', 'deps', 'perf', 'security', 'oncall', 'api'];
const budgetSeeds: Seed[] = Array.from({ length: 199 }, (_, i) => {
  const n = String(i).padStart(3, '0');
  const topic = topics[i % topics.length];
  if (i % 5 === 4) {
    return {
      rel: `reference/${topic}-long-${n}-${'subsystem-ownership-and-escalation-path-'.repeat(2)}notes.md`,
      name: `Long ${topic} note ${n}: who owns the ${topic} subsystem, how to escalate, and which dashboards to check first`,
      description: `Escalation path and dashboards for ${topic}`,
      type: 'reference',
    };
  }
  return {
    rel: `feedback/${topic}-note-${n}.md`,
    name: `Ordinary ${topic} note ${n}`,
    description: `Keep the ${topic} checklist short and link the runbook instead of copying steps into the note ${n}`,
    type: 'feedback',
  };
});
const seeds = MODE === 'budget' ? budgetSeeds : linkSeeds;
const t0 = Date.parse('2026-10-01T00:00:00Z') / 1000;
seeds.forEach((s, i) => {
  const p = path.join(memDir, s.rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    `---\nname: ${JSON.stringify(s.name)}\ndescription: ${JSON.stringify(s.description)}\ntype: ${s.type}\n---\n\n${s.description}.\n`,
  );
  fs.utimesSync(p, t0 - i * 60, t0 - i * 60);
});
// A stale hand-written index: proves the in-session rebuild happened.
fs.writeFileSync(
  path.join(memDir, 'MEMORY.md'),
  '- [Stale entry](stale.md) — written before this session\n',
);

const NEW_REL =
  'feedback/verify-memory-index-changes-with-a-real-cli-run.md';
const NEW_NOTE = `---\nname: "Verify memory index changes with a real CLI run and a link-resolution check, not with unit tests alone"\ndescription: "Unit tests stayed green while every MEMORY.md link in two real stores was broken"\ntype: feedback\n---\n\nRebuild a real store and resolve every link target before calling an index change done.\n`;

// ── Fake model ──
const MARK = 'PR13156-E2E';
type Msg = { role: string; content?: unknown; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>; tool_call_id?: string };
const textOf = (c: unknown): string =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c.map((p) => (typeof p === 'string' ? p : (p as { text?: string }).text ?? '')).join('')
      : '';
const log: Array<Record<string, unknown>> = [];
const indexBlocks: string[] = [];
const indexWarnings: string[] = [];

function extractIndex(sys: string): string[] {
  const head = `## ${memDir}/MEMORY.md`;
  const at = sys.indexOf(head);
  if (at < 0) return [];
  const rest = sys.slice(at + head.length).split('\n');
  const lines: string[] = [];
  for (const l of rest.slice(1)) {
    if (l.startsWith('## ') || l.startsWith('# ')) break;
    if (l.startsWith('- [')) lines.push(l);
  }
  return lines;
}
function linkTarget(line: string): { target: string; closed: boolean } {
  const open = line.indexOf('](');
  if (open < 0) return { target: '', closed: false };
  const close = line.indexOf(')', open + 2);
  return close < 0
    ? { target: line.slice(open + 2), closed: false }
    : { target: line.slice(open + 2, close), closed: true };
}
function decodeSafe(t: string): string {
  try {
    return decodeURIComponent(t);
  } catch {
    return t;
  }
}

const followed: Array<{ line: string; target: string; closed: boolean; file: string; exists: boolean }> = [];

const server = await startFakeOpenAIServer(({ body, requestIndex }) => {
  const msgs = (body['messages'] as Msg[]) ?? [];
  const sys = textOf(msgs[0]?.content);
  const last = msgs[msgs.length - 1];
  const all = msgs.map((m) => textOf(m.content)).join('\n');
  const isMain =
    msgs.some((m) => m.role === 'user' && textOf(m.content).includes(MARK)) &&
    !all.includes('SUGGESTION MODE') &&
    sys.includes(`## ${memDir}/MEMORY.md`);
  const entry: Record<string, unknown> = {
    requestIndex,
    lastRole: last?.role,
    isMain,
    sysHead: sys.slice(0, 120),
  };
  log.push(entry);
  if (!isMain) {
    if (sys.includes('You are selecting memories')) {
      entry['reply'] = 'recall selector: none';
      return { content: JSON.stringify({ selected_memories: [] }) };
    }
    if (all.includes('SUGGESTION MODE')) {
      entry['reply'] = 'suggestion: empty';
      return { content: '' };
    }
    entry['reply'] = 'side-query: plain text';
    return { content: 'OK' };
  }
  const idx = extractIndex(sys);
  indexBlocks.push(idx.join('\n'));
  const head = `## ${memDir}/MEMORY.md`;
  const block = sys.slice(sys.indexOf(head)).split('\n## ')[0];
  indexWarnings.push((block.match(/> WARNING:[^\n]*/g) ?? []).join(' | '));
  entry['indexLines'] = idx.length;
  const toolCallsSoFar = msgs.flatMap((m) => m.tool_calls ?? []);
  const reads = toolCallsSoFar.filter((c) => c.function.name === 'read_file');
  const writes = toolCallsSoFar.filter((c) => c.function.name === 'write_file');
  entry['lastText'] = textOf(last?.content).slice(0, 160);
  if (writes.length === 0) {
    entry['reply'] = 'write_file';
    return {
      toolCalls: [
        fakeToolCall('write_file', {
          file_path: path.join(memDir, NEW_REL),
          content: NEW_NOTE,
        }),
      ],
      finishReason: 'tool_calls',
    };
  }
  if (MODE === 'budget') {
    const rows = idx.map((line) => {
      const { target, closed } = linkTarget(line);
      const file = path.join(memDir, decodeSafe(target));
      return { line, target, closed, file, exists: fs.existsSync(file), long: decodeSafe(target).includes('-long-') || decodeSafe(target) === NEW_REL };
    });
    followed.length = 0;
    followed.push(...rows);
    const live = rows.filter((r) => r.exists);
    const ord = live.filter((r) => !r.long).length;
    const lng = live.filter((r) => r.long).length;
    const warn = /> WARNING: MEMORY\.md/.test(sys);
    entry['reply'] = 'budget summary';
    return {
      content:
        `BUDGET CHECK (${arm}): ${rows.length} index entries in my system prompt · ${live.length} open a real note · ${rows.length - live.length} dead\n\n` +
        `- ordinary notes kept: ${ord}/160\n- long-link notes kept: ${lng}/40 (incl. the one just written)\n- size warning shown: ${warn ? 'yes' : 'no'}`,
      finishReason: 'stop',
    };
  }
  if (reads.length === 0) {
    // Follow every link exactly as the index wrote it.
    followed.length = 0;
    const calls = idx.map((line) => {
      const { target, closed } = linkTarget(line);
      const file = path.join(memDir, decodeSafe(target));
      followed.push({ line, target, closed, file, exists: fs.existsSync(file) });
      return fakeToolCall('read_file', { file_path: file });
    });
    entry['reply'] = `read_file x${calls.length}`;
    return { toolCalls: calls, finishReason: 'tool_calls' };
  }
  {
    const byId = new Map(reads.map((c) => [c.id, JSON.parse(c.function.arguments).file_path as string]));
    let ok = 0;
    const failed: string[] = [];
    for (const m of msgs) {
      if (m.role !== 'tool' || !m.tool_call_id || !byId.has(m.tool_call_id)) continue;
      const t = textOf(m.content);
      if (/File not found|Error/i.test(t.slice(0, 200))) {
        failed.push(path.relative(memDir, byId.get(m.tool_call_id)!));
      } else ok++;
    }
    entry['reply'] = `summary ok=${ok} failed=${failed.length}`;
    const short = (s: string) => (s.length > 60 ? `${s.slice(0, 28)}…${s.slice(-28)}` : s);
    return {
      content:
        `LINK CHECK (${arm}): ${reads.length} index links followed · ${ok} opened · ${failed.length} failed` +
        (failed.length ? `\n\nUnresolvable targets:\n${failed.map((f) => `- ${short(f)}`).join('\n')}` : '\n\nEvery link in MEMORY.md opened its note.'),
      finishReason: 'stop',
    };
  }
  return { content: 'OK' };
});

// ── Drive the real TUI ──
const env: NodeJS.ProcessEnv = { ...process.env };
for (const k of ['NO_COLOR', 'QWEN_CODE_SIMPLE', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NO_PROXY', 'no_proxy', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'QWEN_HOME', 'QWEN_RUNTIME_DIR']) delete env[k];
Object.assign(env, {
  HOME: home,
  USERPROFILE: home,
  QWEN_CODE_MEMORY_BASE_DIR: membase,
  QWEN_SANDBOX: 'false',
  QWEN_CODE_NO_RELAUNCH: '1',
  TERM: 'xterm-256color',
  FORCE_COLOR: '1',
  NODE_NO_WARNINGS: '1',
});

const term = await TerminalCapture.create({
  cols: 130,
  rows: 46,
  cwd: project,
  env,
  theme: 'github-dark',
  chrome: true,
  title: `qwen ${arm} @ ${arm === 'head' ? '5078d2af (PR head)' : arm === 'merged' ? '9467fb77 (PR head merged into main 1a4de748)' : '47463b79 (merge-base)'} — PR #13156 E2E (${MODE})`,
  fontSize: 13,
  outputDir: out,
});
await term.spawn('node', [
  `${wt}/dist/cli.js`,
  '--approval-mode',
  'yolo',
  '--auth-type',
  'openai',
  '--openai-api-key',
  'dummy',
  '--openai-base-url',
  server.baseUrl,
  '--model',
  'dummy',
]);
let screen = '';
try {
  await term.waitFor('Type your message', { timeout: 60000 });
  await term.idle(800, 10000);
  await term.type(
    MODE === 'budget'
      ? `${MARK}: remember that index changes need a real-CLI link check, then audit the MEMORY.md index you were given`
      : `${MARK}: remember that index changes need a real-CLI link check, then open every note your MEMORY.md index links to`,
  );
  await term.idle(400, 4000);
  await term.type('\n');
  await term.waitFor(MODE === 'budget' ? 'BUDGET CHECK' : 'LINK CHECK', { timeout: 120000 });
  await term.idle(1500, 15000);
  await term.capture(`tui-${arm}.png`);
  await term.captureFull(`tui-${arm}-full.png`);
  screen = await term.getScreenText();
} finally {
  fs.writeFileSync(`${out}/screen.txt`, screen);
  await term.close();
  await server.close();
}

const diskIndex = fs.readFileSync(path.join(memDir, 'MEMORY.md'), 'utf8');
const result = {
  arm,
  mode: MODE,
  cli: `${wt}/dist/cli.js`,
  memDir,
  requests: log,
  indexInFirstMainRequest: indexBlocks[0],
  indexAfterWrite: indexBlocks[indexBlocks.length - 1],
  diskIndex,
  diskEntriesMatchPrompt:
    diskIndex.split('\n').filter((l) => l.startsWith('- [')).join('\n') ===
    (indexBlocks[indexBlocks.length - 1] ?? ''),
  promptHasWarning: indexWarnings,
  followed,
  summary: {
    links: followed.length,
    resolvable: followed.filter((f) => f.exists).length,
    unclosed: followed.filter((f) => !f.closed).length,
    maxLineLen: Math.max(...followed.map((f) => f.line.length)),
  },
};
fs.writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.summary), 'diskEntriesMatchPrompt=', result.diskEntriesMatchPrompt);
process.exit(0);
