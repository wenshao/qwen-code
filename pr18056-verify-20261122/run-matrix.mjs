#!/usr/bin/env node
// Sequential cell runner: each cell = one test-file variant x one production
// mutant (or none). Records the junit testcase status and wall time, and
// restores the production files after every cell.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARM = process.env.ARM ?? '/root/git/qwen-code-verify/tmp/pr18056-head';
const PKG = path.join(ARM, 'packages/cli');
const TEST = 'an admitted mutation resets the idle timer';
const only = process.argv[2];

const cells = JSON.parse(readFileSync(path.join(HERE, 'cells.json'), 'utf8'));
const results = [];
for (const cell of cells) {
  if (only && cell.id !== only) continue;
  const mutant = cell.mutant ?? null;
  const mut = spawnSync(
    process.execPath,
    [path.join(HERE, 'mutants.mjs'), mutant ? 'apply' : 'restore'].concat(
      mutant ? [mutant] : [],
    ),
    { encoding: 'utf8' },
  );
  if (mut.status !== 0) throw new Error(mut.stderr || mut.stdout);

  const junit = path.join(PKG, 'junit.xml');
  rmSync(junit, { force: true });
  const started = Date.now();
  const testName = cell.test ?? TEST;
  const run = spawnSync(
    'npx',
    [
      'vitest',
      'run',
      'src/serve/' + cell.file,
      '-t',
      testName,
    ],
    {
      cwd: PKG,
      encoding: 'utf8',
      env: { ...process.env, CI: '1' },
      timeout: cell.timeoutMs ?? 240000,
    },
  );
  const elapsedMs = Date.now() - started;
  let status = 'unknown';
  let durationMs = null;
  let failure = '';
  if (existsSync(junit)) {
    const xml = readFileSync(junit, 'utf8')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
    const blocks = xml.split('<testcase').slice(1);
    const fullName = `name="idle suspension > ${testName}"`;
    for (const block of blocks) {
      if (!block.includes(fullName)) continue;
      durationMs = Number(/time="([\d.]+)"/.exec(block)?.[1] ?? NaN) * 1000;
      if (/<failure/.test(block)) {
        status = 'fail';
        failure = (/<failure[^>]*>([\s\S]*?)<\/failure>/.exec(block)?.[1] ?? '')
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .split('\n')
          .slice(0, 6)
          .join('\n');
      } else if (/<skipped/.test(block)) {
        status = 'skipped';
      } else {
        status = 'pass';
      }
      break;
    }
  }
  const logName = `${cell.id}.log`;
  writeFileSync(
    path.join(HERE, 'logs', logName),
    `exit=${run.status}\nsignal=${run.signal}\n\n--- stdout ---\n${run.stdout ?? ''}\n--- stderr ---\n${run.stderr ?? ''}`,
  );
  const row = {
    id: cell.id,
    file: cell.file,
    mutant,
    expect: cell.expect,
    status,
    durationMs: durationMs ?? null,
    elapsedMs,
    exit: run.status,
    failure: failure.slice(0, 400),
    log: `logs/${logName}`,
  };
  results.push(row);
  const verdict =
    row.status === row.expect ? 'OK' : `UNEXPECTED (wanted ${row.expect})`;
  console.log(
    `${cell.id.padEnd(28)} ${String(status).padEnd(8)} ${String(durationMs ? Math.round(durationMs) : '-').padStart(6)}ms  ${verdict}`,
  );
  if (row.status !== row.expect) {
    console.log(`  failure: ${failure.replace(/\n/g, ' | ').slice(0, 200)}`);
  }
}
const mut = spawnSync(process.execPath, [path.join(HERE, 'mutants.mjs'), 'restore'], {
  encoding: 'utf8',
});
if (mut.status !== 0) throw new Error(`restore failed: ${mut.stderr}`);
writeFileSync(
  path.join(HERE, `results-${only ?? 'all'}.json`),
  JSON.stringify(results, null, 2),
);
console.log('restored production files; results saved');
