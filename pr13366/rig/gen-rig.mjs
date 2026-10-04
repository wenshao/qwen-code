// Derive the instrumented rig runner from the frozen issue runner (x5, uncommitted
// --second-workspace-session mode). Every edit is an exact-anchor replacement that
// must match the stated number of times, otherwise generation fails.
// usage: node gen-rig.mjs <arm...>   → writes src-<arm>/scripts/rig-sws.ts
import { readFileSync, writeFileSync } from 'node:fs';

const RIG = '/Users/wenshao/pr13366-rig';
let text = readFileSync(`${RIG}/runner-x5.frozen.ts`, 'utf8');

function replace(anchor, replacement, count = 1) {
  const found = text.split(anchor).length - 1;
  if (found !== count)
    throw new Error(`anchor found ${found}×, expected ${count}: ${anchor.slice(0, 80)}`);
  text = text.split(anchor).join(replacement);
}
function replaceBetween(startAnchor, endAnchor, replacement) {
  const s = text.indexOf(startAnchor);
  const e = text.indexOf(endAnchor, s + 1);
  if (s < 0 || e < 0 || text.indexOf(startAnchor, s + 1) >= 0)
    throw new Error(`range anchors not unique: ${startAnchor.slice(0, 60)}`);
  text = text.slice(0, s) + replacement + text.slice(e);
}

// R0 imports
replace(
  "import { spawn, spawnSync, type ChildProcess } from 'node:child_process';\n",
  "import { spawn, spawnSync, type ChildProcess } from 'node:child_process';\n" +
    "import { appendFileSync as rigAppendFileSync } from 'node:fs';\n" +
    "import { request as rigHttpRequest } from 'node:http';\n",
);

// R1 tee every child's output to RIG_LOG_DIR/<name>.log
replace(
  '  const append = (chunk: Buffer) => {\n    output += chunk.toString();\n',
  "  const rigLogFile = process.env['RIG_LOG_DIR']\n" +
    "    ? path.join(process.env['RIG_LOG_DIR'], `${name.replace(/[^A-Za-z0-9]+/g, '-')}.log`)\n" +
    '    : undefined;\n' +
    '  const append = (chunk: Buffer) => {\n' +
    '    if (rigLogFile) rigAppendFileSync(rigLogFile, chunk);\n' +
    '    output += chunk.toString();\n',
);

// R2 helpers: streaming Harness→Broker tap, async mysql, model log
replace(
  'async function waitUntil(\n',
  `function rigLog(file: string, entry: Record<string, unknown>): void {
  const dir = process.env['RIG_LOG_DIR'];
  if (dir) rigAppendFileSync(path.join(dir, file), JSON.stringify(entry) + '\\n');
}

async function rigStartTap(target: string): Promise<string> {
  const upstream = new URL(target);
  const server = createServer((req, res) => {
    const started = Date.now();
    const up = rigHttpRequest(
      {
        host: upstream.hostname,
        port: upstream.port,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: upstream.host },
      },
      (ur) => {
        const status = ur.statusCode ?? 0;
        let head = '';
        res.writeHead(status, ur.headers);
        ur.on('data', (chunk: Buffer) => {
          if (head.length < 2048) head += chunk.toString('utf8');
        });
        ur.pipe(res);
        const done = () => {
          const code = status >= 400 ? /"code"\\s*:\\s*"([^"]+)"/.exec(head)?.[1] : undefined;
          rigLog('broker-tap.jsonl', { t: started, ms: Date.now() - started, m: req.method, p: req.url, s: status, ...(code ? { code } : {}) });
        };
        ur.on('end', done);
        ur.on('aborted', () => res.destroy());
        ur.on('error', () => res.destroy());
      },
    );
    up.on('error', (cause) => {
      rigLog('broker-tap.jsonl', { t: started, m: req.method, p: req.url, error: String(cause) });
      res.destroy();
    });
    req.pipe(up);
    res.on('close', () => {
      if (!res.writableFinished) up.destroy();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('tap did not bind');
  return \`http://127.0.0.1:\${address.port}\`;
}

function rigMysql(port: number, sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(mysql, ['--protocol=tcp', '--host=127.0.0.1', \`--port=\${port}\`, '--user=root', '--batch', '--skip-column-names', '--execute', sql]);
    let out = '';
    let err = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString()));
    child.stderr.on('data', (c: Buffer) => (err += c.toString()));
    child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err))));
  });
}

async function waitUntil(
`,
);

// R3 the fake model handler becomes async (per-label delays)
replace(
  'fake = await startFakeOpenAIServer(({ body }) => {',
  'fake = await startFakeOpenAIServer(async ({ body }) => {',
);

// R4 N-session fake model: tool call on a fresh user message, final text after a
// tool result; RIG_FIRST_<L>_MS delays the tool-call reply, RIG_HOLD_<L>_MS the
// post-tool reply (the mount stays held until the Turn finishes).
replaceBetween(
  '      if (secondWorkspaceSession) {\n        if (serialized.includes(secondSessionMarkerA)) {',
  '      if (listPagination && serialized.includes(listPageMarker)) {',
  `      if (secondWorkspaceSession) {
        const rigLabels = [...serialized.matchAll(/MANAGED_SECOND_SESSION_([A-Z][0-9]?)\\b/g)];
        const rigLabel = rigLabels.at(-1)?.[1];
        const rigLast = messages.at(-1) as { role?: string } | undefined;
        const rigTools = Array.isArray(body['tools']) && (body['tools'] as unknown[]).length > 0;
        if (!rigLabel) {
          rigLog('model.jsonl', { t: Date.now(), label: null, last: rigLast?.role, tools: rigTools });
          return { content: 'UNEXPECTED_SECOND_SESSION_PROMPT' };
        }
        const rigPhase = !rigTools ? 'aux' : rigLast?.role === 'tool' ? 'final' : 'tool';
        const rigDelay = Number(process.env[\`RIG_\${rigPhase === 'tool' ? 'FIRST' : 'HOLD'}_\${rigLabel}_MS\`] ?? '0');
        rigLog('model.jsonl', { t: Date.now(), label: rigLabel, phase: rigPhase, delay: rigPhase === 'aux' ? 0 : rigDelay });
        if (rigPhase === 'aux') return { content: 'AUX' };
        if (rigDelay > 0) await new Promise((resolve) => setTimeout(resolve, rigDelay));
        if (rigPhase === 'final' && process.env[\`RIG_FINAL_ERROR_\${rigLabel}\`] === '1')
          return { errorContent: 'RIG_PROVIDER_ERROR' };
        if (rigPhase === 'tool') {
          return {
            toolCalls: [
              fakeToolCall(
                'write_file',
                { file_path: \`managed-second-\${rigLabel.toLowerCase()}.txt\`, content: \`SECOND_\${rigLabel}\\n\` },
                \`call_managed_second_\${rigLabel.toLowerCase()}_\${Date.now()}\`,
              ),
            ],
          };
        }
        return { content: \`SECOND_SESSION_\${rigLabel}_DONE\` };
      }
`,
);

// R5 extra Spring env (e.g. the turn deadline) from RIG_SPRING_ENV_JSON
replace(
  '    { env: springEnv },',
  "    { env: { ...springEnv, ...(JSON.parse(process.env['RIG_SPRING_ENV_JSON'] ?? '{}') as NodeJS.ProcessEnv) } },",
);

// R6 route the Harness→Broker traffic through the tap when RIG_TAP=1
replace(
  '  // The wrong-harness-token mode boots the Harness with a Broker token the\n',
  "  const rigTapUrl =\n    process.env['RIG_TAP'] === '1'\n      ? await rigStartTap(`http://127.0.0.1:${brokerPort}`)\n      : undefined;\n" +
    '  // The wrong-harness-token mode boots the Harness with a Broker token the\n',
);
replace(
  'heldStartProxy?.baseUrl ?? `http://127.0.0.1:${brokerPort}`',
  'rigTapUrl ?? heldStartProxy?.baseUrl ?? `http://127.0.0.1:${brokerPort}`',
  2,
);

// R7 the scenario driver replaces the issue mode's assertion block
replaceBetween(
  '  } else if (secondWorkspaceSession) {\n',
  '  } else if (listPagination) {\n',
  readFileSync(`${RIG}/driver-block.ts`, 'utf8'),
);

const arms = process.argv.slice(2);
if (arms.length === 0) throw new Error('usage: gen-rig.mjs <arm...>');
for (const arm of arms) {
  writeFileSync(`${RIG}/src-${arm}/scripts/rig-sws.ts`, text);
  console.log(`wrote src-${arm}/scripts/rig-sws.ts (${text.length} bytes)`);
}
writeFileSync(`${RIG}/rig-sws.generated.ts`, text);
