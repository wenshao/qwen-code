// Scripted gate + docs assertions for PR12475 round 2, all executed at head 4d3e7255a5.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const H = '/root/git/qwen-code-x3/tmp/pr12475-head';
const A = '/root/git/qwen-code-x3/tmp/pr12475-verify-20260923-071935';
let pass = 0, fail = 0;
const rep = (ok, line) => { console.log((ok ? 'PASS ' : 'FAIL ') + line); ok ? pass++ : fail++; };
const doc = (f) => fs.readFileSync(`${H}/docs/users/features/channels/${f}`, 'utf8');

const overview = doc('overview.md');
rep(overview.includes('saving the channel from the editor keeps them'), 'docs N1/R1-7: overview.md carries the maintainer-endorsed Web Shell editor wording');
rep(/open.*any member of an admitted group[\s\S]*equivalent to `senderPolicy: "open"`/.test(overview), 'docs R1-9a: overview.md open bullet carries the github/gitlab equivalence caveat');
rep(overview.includes('`pairing` is deliberately absent from this axis'), 'docs: pairing absence on the group axis is explained');
rep(overview.includes('this axis is not consulted'), 'docs R1-8: axis not consulted under groupPolicy pairing');
rep(overview.includes('still follow `allowedUsers`'), 'docs R1-4: shared-session commands follow allowedUsers');
rep(overview.includes('re-authorizes already-stored group loops'), 'docs R1-5: stored group loops re-authorized against allowedGroupUsers');
rep(doc('github.md').includes('`groupSenderPolicy` replaces `senderPolicy`'), 'docs N3/R1-9b: github.md Security note names the axis replacement');
rep(doc('gitlab.md').includes('`groupSenderPolicy` replaces `senderPolicy`'), 'docs N3/R1-9c: gitlab.md Security note names the axis replacement');
rep(doc('dws.md').includes('or `groupSenderPolicy` once you decouple it'), 'docs: dws.md precedence wording');

const readme = fs.readFileSync(`${H}/packages/channels/base/README.md`, 'utf8');
rep(readme.includes('senderGateFor(envelope.isGroup)'), 'docs R1-12: base README tells adapters to use senderGateFor');

// gates re-executed here so the numbers are from this script
const files = fs.readFileSync(`${A}/changed-files.txt`, 'utf8').trim().split('\n');
const prettier = execSync(`cd ${H} && COREPACK_HOME=/tmp/corepack-cache corepack pnpm exec prettier --check ${files.join(' ')} 2>&1; echo EXIT=$?`, { encoding: 'utf8' });
rep(/EXIT=0/.test(prettier), `B1 re-measure: prettier --check clean on all ${files.length} changed files at head`);

const eslint = execSync(`cd ${H} && COREPACK_HOME=/tmp/corepack-cache corepack pnpm exec eslint --max-warnings 0 ${files.filter((f) => f.endsWith('.ts')).join(' ')} 2>&1; echo EXIT=$?`, { encoding: 'utf8' });
rep(/EXIT=0/.test(eslint), 'eslint --max-warnings 0 clean on the 13 changed .ts files');

// bundle sanity pair
const headHas = execSync(`grep -rl groupSenderGate ${H}/dist/chunks/ | head -1`, { encoding: 'utf8' }).trim();
rep(headHas.length > 0, 'head bundle contains groupSenderGate');
const baseGrep = execSync(`grep -rl groupSenderGate /root/git/qwen-code-x3/tmp/pr12475-base/dist/chunks/ > /dev/null 2>&1; echo EXIT=$?`, { encoding: 'utf8' });
rep(/EXIT=1/.test(baseGrep), 'base bundle lacks groupSenderGate (control differs only by the PR)');
const realpath = execSync('readlink -f /root/git/qwen-code-x3/tmp/pr12475-base/node_modules/@qwen-code/qwen-code-core', { encoding: 'utf8' }).trim();
rep(realpath.startsWith('/root/git/qwen-code-x3/tmp/pr12475-base/'), `base control realpath stays inside base tree (${realpath})`);

console.log(`\nTOTAL pass=${pass} fail=${fail}`);
fs.writeFileSync(`${A}/logs/gate-assertions.json`, JSON.stringify({ pass, fail }, null, 1));
process.exit(fail ? 1 : 0);
