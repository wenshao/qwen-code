// Independent mutation matrix for #13431. Run from the tree root inside the
// rig container: node /rig/mutants.mjs /rig/out/mutants
// Every mutant is an exact, single-occurrence replacement (or a new file);
// the tree is restored with `git checkout`/`git clean` and checked clean
// after each one.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2];
fs.mkdirSync(outDir, { recursive: true });
const H = 'integration-tests/helpers/';
const helper = H + 'hosted-relay-headers.ts';
const drop = (name) => ({
  file: helper,
  from: `  '${name}',\n`,
  to: '',
});
const reverts = [
  'hosted-latency-driver.ts',
  'hosted-process-crash-driver.ts',
  'hosted-shell-output-driver.ts',
  'hosted-store-failure-driver.ts',
  'hosted-workspace-tool-turn-driver.ts',
];

const mutants = [
  ...[
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'proxy-connection',
    'te',
    'transfer-encoding',
    'upgrade',
    'trailer',
    'content-length',
    'content-encoding',
  ].map((name) => ({ id: `F-drop-${name}`, edits: [drop(name)] })),
  {
    id: 'F-no-split',
    edits: [{ file: helper, from: ".split(',')", to: ".split('\\u0000')" }],
  },
  {
    id: 'F-no-trim',
    edits: [
      {
        file: helper,
        from: 'name.trim().toLowerCase()',
        to: 'name.toLowerCase()',
      },
    ],
  },
  {
    id: 'F-no-lowercase',
    edits: [
      { file: helper, from: 'name.trim().toLowerCase()', to: 'name.trim()' },
    ],
  },
  {
    id: 'F-no-filter-Boolean (equivalent?)',
    edits: [{ file: helper, from: '      .filter(Boolean),\n', to: '      ,\n' }],
  },
  {
    id: 'F-no-dynamic-branch',
    edits: [
      {
        file: helper,
        from: "    ...(headers.get('connection') ?? '')\n      .split(',')\n      .map((name) => name.trim().toLowerCase())\n      .filter(Boolean),\n",
        to: '',
      },
    ],
  },
  {
    id: 'F-dynamic-reads-keep-alive',
    edits: [
      {
        file: helper,
        from: "headers.get('connection')",
        to: "headers.get('keep-alive')",
      },
    ],
  },
  {
    id: 'F-invert-filter',
    edits: [
      { file: helper, from: '!dropped.has(name)', to: 'dropped.has(name)' },
    ],
  },
  {
    id: 'F-relay-everything',
    edits: [
      {
        file: helper,
        from: '[...headers].filter(([name]) => !dropped.has(name))',
        to: '[...headers]',
      },
    ],
  },
  {
    id: 'F-also-drop-cache-control',
    edits: [
      {
        file: helper,
        from: "  'content-encoding',\n",
        to: "  'content-encoding',\n  'cache-control',\n",
      },
    ],
  },
  {
    id: 'F-also-drop-x-qwen-resource-digest',
    edits: [
      {
        file: helper,
        from: "  'content-encoding',\n",
        to: "  'content-encoding',\n  'x-qwen-resource-digest',\n",
      },
    ],
  },
  ...reverts.map((name) => ({
    id: `D-revert-${name}`,
    revert: H + name,
  })),
  {
    id: 'D-spread-smuggles-keep-alive (store-failure)',
    edits: [
      {
        file: H + 'hosted-store-failure-driver.ts',
        from: 'res.writeHead(upstream.status, relayedHeaders(upstream.headers));',
        to: "res.writeHead(upstream.status, { ...relayedHeaders(upstream.headers), 'keep-alive': upstream.headers.get('keep-alive') ?? '' });",
      },
    ],
  },
  {
    id: 'D-object-assign-adds-keep-alive (shell-output)',
    edits: [
      {
        file: H + 'hosted-shell-output-driver.ts',
        from: 'res.writeHead(upstream.status, relayedHeaders(upstream.headers));',
        to: "res.writeHead(upstream.status, Object.assign(relayedHeaders(upstream.headers), { 'keep-alive': upstream.headers.get('keep-alive') ?? '' }));",
      },
    ],
  },
  {
    id: 'D-literal-names-keep-alive-beside-helper (process-crash)',
    edits: [
      {
        file: H + 'hosted-process-crash-driver.ts',
        from: '    res.writeHead(upstream.status, relayedHeaders(upstream.headers));\n',
        to: "    if (upstream.headers.has('keep-alive')) res.writeHead(upstream.status, { 'keep-alive': upstream.headers.get('keep-alive') ?? '', 'cache-control': upstream.headers.get('cache-control') ?? '' });\n    else res.writeHead(upstream.status, relayedHeaders(upstream.headers));\n",
      },
    ],
  },
  {
    id: 'D-let-shadows-safe-const-name (latency)',
    edits: [
      {
        file: H + 'hosted-latency-driver.ts',
        from: "import { relayedHeaders } from './hosted-relay-headers.js';\n",
        to: "import { relayedHeaders } from './hosted-relay-headers.js';\nconst relay = relayedHeaders(new Headers());\nvoid relay;\n",
      },
      {
        file: H + 'hosted-latency-driver.ts',
        from: '      res.writeHead(upstream.status, relayedHeaders(upstream.headers));',
        to: '      let relay = Object.fromEntries(upstream.headers);\n      res.writeHead(upstream.status, relay);',
      },
    ],
  },
  {
    id: 'D-bound-writeHead-alias (store-failure)',
    edits: [
      {
        file: H + 'hosted-store-failure-driver.ts',
        from: 'res.writeHead(upstream.status, relayedHeaders(upstream.headers));',
        to: 'const send = res.writeHead.bind(res);\n    send(upstream.status, Object.fromEntries(upstream.headers));\n    void relayedHeaders;',
      },
    ],
  },
  {
    id: 'N-new-driver-wholesale-relay',
    create: {
      file: H + 'hosted-newcomer-driver.ts',
      body: "import { createServer } from 'node:http';\ncreateServer(async (req, res) => {\n  const upstream = await fetch('http://127.0.0.1:1' + req.url);\n  res.writeHead(upstream.status, Object.fromEntries(upstream.headers));\n  res.end(Buffer.from(await upstream.arrayBuffer()));\n});\n",
    },
  },
  {
    id: 'N-new-driver-in-subdirectory',
    create: {
      file: H + 'store/hosted-nested-driver.ts',
      body: "import { createServer } from 'node:http';\ncreateServer(async (req, res) => {\n  const upstream = await fetch('http://127.0.0.1:1' + req.url);\n  for (const [k, v] of upstream.headers) res.setHeader(k, v);\n  res.writeHead(upstream.status);\n  res.end();\n});\n",
    },
  },
  {
    id: 'N-shared-proxy-module-not-named-driver',
    create: {
      file: H + 'hosted-store-proxy.ts',
      body: "import { createServer } from 'node:http';\nexport const storeProxy = (origin: string) => createServer(async (req, res) => {\n  const upstream = await fetch(origin + req.url);\n  res.writeHead(upstream.status, Object.fromEntries(upstream.headers));\n  res.end(Buffer.from(await upstream.arrayBuffer()));\n});\n",
    },
  },
];

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}
function clean() {
  execFileSync('git', ['checkout', '--', '.']);
  execFileSync('git', ['clean', '-fdq', '--', 'integration-tests/helpers']);
  const status = execFileSync('git', ['status', '--porcelain'], {
    encoding: 'utf8',
  });
  if (status.trim()) throw new Error(`tree not clean:\n${status}`);
}
function runTest(tag) {
  const json = path.join(outDir, `${tag.replace(/[^a-z0-9-]+/gi, '_')}.json`);
  const run = sh(
    'npx',
    [
      'vitest',
      'run',
      'helpers/hosted-relay-headers.test.ts',
      '--reporter=json',
      `--outputFile=${json}`,
    ],
    { cwd: 'integration-tests', timeout: 300_000 },
  );
  let failed = [];
  let total = 0;
  try {
    const report = JSON.parse(fs.readFileSync(json, 'utf8'));
    for (const file of report.testResults)
      for (const test of file.assertionResults) {
        total++;
        if (test.status !== 'passed') failed.push(test.title);
      }
  } catch (error) {
    failed = [`<no report: exit ${run.status}> ${String(error).slice(0, 200)}`];
  }
  return { exit: run.status, total, failed };
}

clean();
const rows = [];
const baseline = runTest('baseline');
rows.push({ id: 'baseline (unmutated)', ...baseline });
console.log(JSON.stringify(rows.at(-1)));
for (const mutant of mutants) {
  clean();
  if (mutant.revert) {
    const patch = execFileSync(
      'git',
      ['apply', `--include=${mutant.revert}`, '/rig/head-to-base.patch'],
      { encoding: 'utf8' },
    );
    void patch;
  }
  for (const edit of mutant.edits ?? []) {
    const source = fs.readFileSync(edit.file, 'utf8');
    const count = source.split(edit.from).length - 1;
    if (count !== 1) throw new Error(`${mutant.id}: anchor x${count} in ${edit.file}`);
    fs.writeFileSync(edit.file, source.replace(edit.from, () => edit.to));
  }
  if (mutant.create) {
    fs.mkdirSync(path.dirname(mutant.create.file), { recursive: true });
    fs.writeFileSync(mutant.create.file, mutant.create.body);
  }
  const diff = execFileSync('git', ['diff', '--stat'], { encoding: 'utf8' });
  const result = runTest(mutant.id);
  rows.push({
    id: mutant.id,
    ...result,
    killed: result.failed.length > 0,
    diff: diff.trim().split('\n').at(-1) ?? '',
  });
  console.log(JSON.stringify(rows.at(-1)));
}
clean();
const after = runTest('baseline-after');
rows.push({ id: 'baseline (after restore)', ...after });
console.log(JSON.stringify(rows.at(-1)));
fs.writeFileSync(path.join(outDir, 'matrix.json'), JSON.stringify(rows, null, 2));
