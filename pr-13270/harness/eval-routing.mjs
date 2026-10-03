// Evaluate the PR's verbatim `runs-on` / `if:` expressions with GitHub's own
// expression engine (@actions/expressions), independent of the PR's regex model.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Lexer, Parser, Evaluator, data } from '@actions/expressions';
import { truthy } from './node_modules/@actions/expressions/dist/result.js';

const WT = process.argv[2] || '/root/git/qwen-code-pr13270';
const require = createRequire(`${WT}/package.json`);
const { parse } = require('yaml');

const wf = (f) => parse(readFileSync(`${WT}/.github/workflows/${f}`, 'utf8'));
const strip = (s) => {
  const m = /^\s*\$\{\{([\s\S]*)\}\}\s*$/.exec(s);
  if (!m) throw new Error(`not a full-string expression: ${s}`);
  return m[1];
};
const toData = (obj) => JSON.parse(JSON.stringify(obj), data.reviver);
const always = { name: 'always', minArgs: 0, maxArgs: 0, call: () => new data.BooleanData(true) };

function evaluate(expr, ctx) {
  const tokens = new Lexer(expr).lex().tokens;
  const ast = new Parser(tokens, Object.keys(ctx), [always]).parse();
  const out = new Evaluator(ast, toData(ctx), new Map([['always', always]])).evaluate();
  return out;
}
const asLabels = (d) => {
  if (d.kind === undefined && typeof d.values === 'function') return d.values().map((v) => v.value);
  const js = JSON.parse(JSON.stringify(d, (k, v) => v));
  return js;
};
const labelsOf = (d) => {
  // Array data → list of string values
  if (typeof d.values === 'function') return d.values().map((v) => v.coerceString?.() ?? v.value);
  return d.coerceString?.() ?? String(d);
};

const lanes = [
  ['tui-parity.yml', 'parity'],
  ['tui-parity.yml', 'noflicker'],
  ['sdk-java.yml', 'flyway-migrations'],
  ['assign-pr-owner.yml', 'assign'],
];
const PR_EVENTS = ['pull_request', 'pull_request_target'];
const EVENTS = [...PR_EVENTS, 'push', 'workflow_dispatch', 'schedule', 'merge_group'];
const ASSOCS = ['OWNER', 'MEMBER', 'COLLABORATOR', 'CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER', 'NONE', 'MANNEQUIN'];
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const KILL = [undefined, 'true', 'TRUE', 'false', ''];
const REPOS = ['QwenLM/qwen-code', 'wenshao/qwen-code'];

const ECS = 'self-hosted,linux,x64,ecs-qwen';
const HOSTED = 'ubuntu-latest';
let total = 0;
let mismatches = 0;
const summary = [];
for (const [file, job] of lanes) {
  const runsOn = wf(file).jobs[job]['runs-on'];
  const expr = strip(runsOn);
  // The lane's own PR trigger: the event whose untrusted-fork case must stay hosted.
  const laneEvent = file === 'assign-pr-owner.yml' ? 'pull_request_target' : 'pull_request';
  const counts = { ECS: 0, HOSTED: 0 };
  for (const repo of REPOS)
    for (const kill of KILL)
      for (const ev of EVENTS) {
        const isPr = PR_EVENTS.includes(ev);
        const variants = isPr
          ? [true, false].flatMap((same) => ASSOCS.map((a) => ({ same, a })))
          : [{ same: null, a: null }];
        for (const { same, a } of variants) {
          const ctx = {
            github: {
              repository: repo,
              event_name: ev,
              event: isPr
                ? {
                    pull_request: {
                      head: { repo: { full_name: same ? repo : 'someone/qwen-code' } },
                      author_association: a,
                    },
                  }
                : {},
            },
            vars: kill === undefined ? {} : { MAINTAINER_ECS_RUNNER_DISABLED: kill },
          };
          const got = labelsOf(evaluate(expr, ctx)).join(',');
          // Policy from the PR description: pool only for this repo, kill-switch
          // off (case-insensitive like GitHub's ==), and either not this lane's PR
          // trigger, or an in-repo head, or a write-access author.
          const killOn = typeof kill === 'string' && kill.toLowerCase() === 'true';
          const trustedTrigger = ev !== laneEvent || same === true || TRUSTED.has(a);
          const want = repo === 'QwenLM/qwen-code' && !killOn && trustedTrigger ? ECS : HOSTED;
          total++;
          counts[got === ECS ? 'ECS' : 'HOSTED']++;
          if (got !== want) {
            mismatches++;
            console.log(`MISMATCH ${file}:${job} repo=${repo} kill=${kill} ev=${ev} same=${same} assoc=${a} got=${got} want=${want}`);
          }
        }
      }
  summary.push({ lane: `${file}:${job}`, laneEvent, ...counts });
}
console.table(summary);
console.log(`runs-on: ${total} contexts evaluated, ${mismatches} mismatches against the stated policy`);

// Spot rows for the report
const spot = (file, job, ev, same, a, kill) => {
  const expr = strip(wf(file).jobs[job]['runs-on']);
  const isPr = PR_EVENTS.includes(ev);
  const ctx = {
    github: {
      repository: 'QwenLM/qwen-code',
      event_name: ev,
      event: isPr ? { pull_request: { head: { repo: { full_name: same ? 'QwenLM/qwen-code' : 'someone/qwen-code' } }, author_association: a } } : {},
    },
    vars: kill ? { MAINTAINER_ECS_RUNNER_DISABLED: kill } : {},
  };
  return labelsOf(evaluate(expr, ctx));
};
console.log('\nspot checks (official evaluator):');
for (const [file, job, ev, same, a, kill] of [
  ['tui-parity.yml', 'parity', 'pull_request', true, 'NONE'],
  ['tui-parity.yml', 'parity', 'pull_request', false, 'FIRST_TIME_CONTRIBUTOR'],
  ['tui-parity.yml', 'noflicker', 'pull_request', false, 'COLLABORATOR'],
  ['tui-parity.yml', 'noflicker', 'workflow_dispatch'],
  ['sdk-java.yml', 'flyway-migrations', 'push'],
  ['sdk-java.yml', 'flyway-migrations', 'pull_request', false, 'CONTRIBUTOR'],
  ['assign-pr-owner.yml', 'assign', 'pull_request_target', false, 'NONE'],
  ['assign-pr-owner.yml', 'assign', 'pull_request_target', false, 'MEMBER'],
  ['assign-pr-owner.yml', 'assign', 'pull_request_target', true, 'OWNER', 'true'],
]) {
  console.log(`  ${file}:${job} ev=${ev}${same === undefined ? '' : ` sameRepo=${same} assoc=${a}`}${kill ? ` kill=${kill}` : ''} -> ${JSON.stringify(spot(file, job, ev, same, a, kill))}`);
}

// report_failure gate
const gate = strip(wf('codeql.yml').jobs.report_failure.if);
console.log('\nreport_failure if:', gate.trim());
let gTotal = 0;
let gMis = 0;
const rows = [];
for (const repo of REPOS)
  for (const ev of ['schedule', 'workflow_dispatch', 'push'])
    for (const result of ['success', 'failure', 'cancelled', 'skipped']) {
      const ctx = { github: { repository: repo, event_name: ev }, needs: { codeql: { result } } };
      const got = truthy(evaluate(gate, ctx));
      const want = repo === 'QwenLM/qwen-code' && ev === 'schedule' && result !== 'success';
      gTotal++;
      if (got !== want) {
        gMis++;
        console.log(`GATE MISMATCH repo=${repo} ev=${ev} result=${result} got=${got}`);
      }
      if (repo === 'QwenLM/qwen-code') rows.push({ event: ev, 'needs.codeql.result': result, runs: got });
    }
console.table(rows);
console.log(`report_failure: ${gTotal} contexts evaluated, ${gMis} mismatches`);
process.exit(mismatches + gMis ? 1 : 0);
