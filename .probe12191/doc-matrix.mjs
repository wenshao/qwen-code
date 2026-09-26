// Negative-control matrix for the /export html document build (PR #12191).
// Portable (Windows/macOS/Linux): mutations are exact String.replace calls that
// throw when the target text is missing, so a silent no-op mutation is impossible.
// Usage: node doc-matrix.mjs <repoRoot> <outDir>
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const out = resolve(process.argv[3] ?? 'probe-out');
mkdirSync(out, { recursive: true });
const wt = join(root, 'packages/web-templates');
const B = join(wt, 'src/export-html/build.mjs');
const ws = join(root, 'packages/web-shell');
const T = join(ws, 'dist/transcript.js');
const PKG = join(ws, 'package.json');
const CAND_WARN = process.env.CAND_WARN ?? '1_880_000';
const CAND_MAX = process.env.CAND_MAX ?? '1_930_000';

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const pristine = {
  build: readFileSync(B, 'utf8'),
  transcript: readFileSync(T),
  pkg: readFileSync(PKG, 'utf8'),
};
const pristineSha = { build: sha(B), transcript: sha(T), pkg: sha(PKG) };

const MUTATIONS = {
  'no-engagement': [
    ['if (!hasDocumentMcpAppBridgeStubInput(', 'if (false && !hasDocumentMcpAppBridgeStubInput('],
  ],
  'no-stub': [
    ['{ filter: /^@modelcontextprotocol\\/ext-apps\\/app-bridge$/ }', '{ filter: /^__never__$/ }'],
  ],
  'no-forbidden-mcp': [
    [
      'pattern: /(^|\\/)node_modules\\/@modelcontextprotocol\\/(ext-apps|sdk)\\//,',
      'pattern: /__never__/,',
    ],
  ],
  'tight-caps': [
    ['const DOCUMENT_RUNTIME_WARNING_BYTES = 1_970_000;', `const DOCUMENT_RUNTIME_WARNING_BYTES = ${CAND_WARN};`],
    ['const MAX_DOCUMENT_RUNTIME_BYTES = 2_030_000;', `const MAX_DOCUMENT_RUNTIME_BYTES = ${CAND_MAX};`],
  ],
};

function applyMutations(src, names) {
  for (const name of names) {
    for (const [from, to] of MUTATIONS[name]) {
      const count = src.split(from).length - 1;
      if (count !== 1) throw new Error(`mutation ${name}: expected 1 match, got ${count} for ${from}`);
      src = src.replace(from, to);
    }
  }
  return src;
}

// 1. A transcript entry with the MCP bridge pre-bundled: drop ext-apps from the
//    manifest (externals derive from it) and rebuild only the transcript mode.
const req = createRequire(PKG);
const viteBin = join(dirname(req.resolve('vite/package.json')), 'bin/vite.js');
const preDir = join(out, 'prebundled-transcript');
rmSync(preDir, { recursive: true, force: true });
const pkg = JSON.parse(pristine.pkg);
delete pkg.dependencies['@modelcontextprotocol/ext-apps'];
writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
const vb = spawnSync(
  process.execPath,
  [viteBin, 'build', '--config', 'vite.lib.config.ts', '--mode', 'transcript', '--outDir', preDir, '--emptyOutDir'],
  { cwd: ws, encoding: 'utf8' },
);
writeFileSync(PKG, pristine.pkg);
writeFileSync(join(out, 'prebundle-vite.log'), `${vb.stdout}\n${vb.stderr}`);
const preT = join(preDir, 'transcript.js');
if (vb.status !== 0 || !existsSync(preT)) throw new Error(`prebundle build failed: ${vb.status}`);
const preText = readFileSync(preT, 'utf8');
const healthyText = pristine.transcript.toString('utf8');
const bridgeImport = /from\s*["']@modelcontextprotocol\/ext-apps\/app-bridge["']/;
const prebundleInfo = {
  healthyImportsBridge: bridgeImport.test(healthyText),
  prebundledImportsBridge: bridgeImport.test(preText),
  healthyBytes: Buffer.byteLength(healthyText),
  prebundledBytes: Buffer.byteLength(preText),
};
console.log('PROBE_JSON ' + JSON.stringify({ kind: 'prebundle', ...prebundleInfo }));
if (prebundleInfo.prebundledImportsBridge || !prebundleInfo.healthyImportsBridge) {
  throw new Error('prebundle control is not a pre-inlined bridge');
}

// 2. The matrix.
const CASES = [
  ['C0-intact', 'healthy', []],
  ['C0t-intact-candidate-caps', 'healthy', ['tight-caps']],
  ['C1-prebundled', 'prebundled', []],
  ['C2-prebundled-no-engagement', 'prebundled', ['no-engagement']],
  ['C2t-prebundled-no-engagement-candidate-caps', 'prebundled', ['no-engagement', 'tight-caps']],
  ['C3-no-stub', 'healthy', ['no-stub']],
  ['C4-no-stub-no-engagement', 'healthy', ['no-stub', 'no-engagement']],
  ['C5-no-stub-no-engagement-no-forbidden', 'healthy', ['no-stub', 'no-engagement', 'no-forbidden-mcp']],
];
for (const [name, transcript, muts] of CASES) {
  writeFileSync(B, applyMutations(pristine.build, muts));
  if (transcript === 'healthy') writeFileSync(T, pristine.transcript);
  else copyFileSync(preT, T);
  const metafile = join(out, `${name}.metafile.json`);
  const r = spawnSync(process.execPath, ['src/export-html/build.mjs'], {
    cwd: wt,
    encoding: 'utf8',
    env: { ...process.env, EXPORT_HTML_METAFILE: metafile },
  });
  const log = `${r.stdout}\n${r.stderr}`;
  writeFileSync(join(out, `${name}.log`), log);
  const bytes = log.match(/renderer JS is (\d+) bytes/)?.[1] ?? null;
  const err = log.match(/Error: ([^\n]{0,160})/)?.[1] ?? null;
  const forbidden = log.match(/reached (\d+) forbidden input/)?.[1] ?? null;
  const warned = /exceeds the \d+-byte warning threshold/.test(log);
  let meta = null;
  if (existsSync(metafile)) {
    const keys = Object.keys(JSON.parse(readFileSync(metafile, 'utf8')).inputs);
    meta = {
      inputs: keys.length,
      backslashKeys: keys.filter((k) => k.includes('\\')).length,
      stubKey: keys.find((k) => k.includes('document-mcp-app-bridge-stub')) ?? null,
      mcpKeys: keys.filter((k) => k.includes('@modelcontextprotocol')).length,
      sampleNodeModulesKey: keys.find((k) => k.includes('node_modules')) ?? null,
    };
    rmSync(metafile);
  }
  console.log(
    'PROBE_JSON ' +
      JSON.stringify({ kind: 'case', name, transcript, muts, rc: r.status, bytes, warned, forbidden, err, meta }),
  );
}

// 3. Restore and rebuild the healthy document; prove the tree is byte-exact.
writeFileSync(B, pristine.build);
writeFileSync(T, pristine.transcript);
const rebuild = spawnSync(process.execPath, ['src/export-html/build.mjs'], { cwd: wt, encoding: 'utf8' });
const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const restored = {
  kind: 'restore',
  rebuildRc: rebuild.status,
  build: sha(B) === pristineSha.build,
  transcript: sha(T) === pristineSha.transcript,
  pkg: sha(PKG) === pristineSha.pkg,
  gitStatus: status,
};
console.log('PROBE_JSON ' + JSON.stringify(restored));
if (!restored.build || !restored.transcript || !restored.pkg || rebuild.status !== 0) process.exit(1);
