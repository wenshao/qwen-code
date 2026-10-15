// Differential: the workflow's prepare-step bash validator (extracted verbatim from the
// YAML) vs the packager's VERSION_PATTERN (via createReferenceDistribution) vs the
// official semver.org regex (prerelease required).
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
const root = process.argv[2];
const { createReferenceDistribution } = await import(path.join(root, 'scripts/package-managed-agent-reference.mjs'));
const yml = readFileSync(path.join(root, '.github/workflows/release-managed-agent-reference.yml'), 'utf8');
const start = yml.indexOf("        run: |-\n", yml.indexOf("id: 'version'"));
const lines = yml.slice(start + "        run: |-\n".length).split('\n');
const body = [];
for (const l of lines) { if (l.startsWith('          ') || l === '') body.push(l.slice(10)); else break; }
const script = body.join('\n');
const tmp = mkdtemp();
function mkdtemp() { return mkdtempSync(path.join(os.tmpdir(), 'vdiff-')); }
const scriptFile = path.join(tmp, 'prepare.sh'); writeFileSync(scriptFile, script);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const nums = ['0', '1', '10', '01', '00'];
const ids = ['alpha', '0', '1', '01', '00', '0a', 'a-b', '-', '--', '0-', 'x1', '', 'é', 'Ａ', '٣', 'a_b', 'a b'];
const cands = new Set();
for (const a of nums) for (const b of ['0', '01']) for (const c of ['0', '1', '01'])
  for (const p of ids) for (const q of [null, ...ids]) {
    cands.add(`${a}.${b}.${c}-${p}${q === null ? '' : '.' + q}`);
  }
for (const s of ['1.0.0', '1.0.0+b', '1.0.0-a+b', 'v0.1.0-alpha.1', '0.1.0-alpha.1', '0.1.0-alpha..1', '0.1.0-alpha.1\n', ' 0.1.0-a', '0.1.0-a ', '0.1.0-a\n0.1.0-b', '1.0.0-01', '1.0.0-0.0.0', '0.0.0-pr.14176'])
  cands.add(s);
let disagree = [], invalidAccepted = [], n = 0, acceptedBoth = 0;
const locale = process.env.LC_ALL ?? '';
for (const v of cands) {
  n++;
  const out = path.join(tmp, 'out'); writeFileSync(out, '');
  const r = spawnSync('bash', [scriptFile], { env: { ...process.env, GITHUB_EVENT_NAME: 'workflow_dispatch', INPUT_VERSION: v, DRY_RUN: 'true', GITHUB_OUTPUT: out, GITHUB_REF: 'refs/heads/x' }, encoding: 'utf8' });
  const bashOk = r.status === 0;
  const bashVersion = bashOk ? (readFileSync(out, 'utf8').match(/^version=(.*)$/m) ?? [])[1] : undefined;
  let jsOk;
  try { await createReferenceDistribution({ repoRoot: path.join(tmp, 'no-repo'), outputDirectory: path.join(tmp, 'js-out'), version: bashVersion ?? v.replace(/^v/, ''), sourceRevision: 'a'.repeat(40) }); jsOk = true; }
  catch (e) { jsOk = !/experimental SemVer/.test(e.message); }
  const semverOk = SEMVER.test(v.replace(/^v/, '')) && v.replace(/^v/, '').includes('-');
  if (bashOk !== jsOk) disagree.push({ v, bashOk, jsOk, semverOk });
  if ((bashOk && jsOk) && !semverOk) invalidAccepted.push(v);
  if (bashOk && jsOk) acceptedBoth++;
}
console.log(JSON.stringify({ locale, bash: spawnSync('bash', ['--version'], { encoding: 'utf8' }).stdout.split('\n')[0], candidates: n, acceptedBoth, disagreements: disagree.length, invalidAcceptedByBoth: invalidAccepted.length }, null, 1));
for (const d of disagree.slice(0, 15)) console.log('DISAGREE', JSON.stringify(d));
for (const v of invalidAccepted.slice(0, 15)) console.log('INVALID_ACCEPTED', JSON.stringify(v));
