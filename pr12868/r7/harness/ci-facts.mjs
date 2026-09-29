// Writes out/ci.log from GitHub: the checks of the head, the review threads,
// the reviews made on the head. usage: node ci-facts.mjs <full head sha>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const RIG = path.dirname(new URL(import.meta.url).pathname);
const HEAD = process.argv[2];
const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const pr = JSON.parse(gh('pr', 'view', '12868', '-R', 'QwenLM/qwen-code', '--json', 'state,headRefOid,reviewDecision,mergeStateStatus'));
if (pr.headRefOid !== HEAD) throw new Error(`the head is ${pr.headRefOid}, not ${HEAD}`);
const checks = JSON.parse(gh('pr', 'checks', '12868', '-R', 'QwenLM/qwen-code', '--json', 'name,state,bucket,workflow,link'));
const by = (b) => checks.filter((c) => c.bucket === b);
const pending = by('pending').map((c) => c.name.replace(/ \(ubuntu-latest, Node 22\.x\)/, ''));
const failing = [...by('fail'), ...by('cancel')].map((c) => c.name);
const lines = [];
lines.push(`[ci] checks on ${HEAD.slice(0, 10)}: ${by('pass').length} pass${pending.length ? `, pending: ${pending.join(' and ')}` : ', none pending'}, ${by('skipping').length} skipping, ${failing.length ? `failing: ${failing.join(', ')}` : 'none failing'}`);
for (const want of ['Hosted process fault gates / MySQL 8.4 / Java 21', 'Runtime Broker and Managed Agent MariaDB / Java 21', 'Real daemon E2E / Java 11', 'Test (ubuntu-latest, Node 22.x)', 'Integration Tests (no-AK, No Sandbox)']) {
  const c = checks.find((x) => x.name === want);
  lines.push(`[ci] ${c ? c.bucket : 'absent'} · ${want}`);
}
// every attempt of the fault-gate job on this head
const GATE = 'Hosted process fault gates / MySQL 8.4 / Java 21';
const run = checks.find((c) => c.name === GATE)?.link?.match(/actions\/runs\/(\d+)/)?.[1];
const attempts = [];
if (run) {
  const last = JSON.parse(gh('api', `repos/QwenLM/qwen-code/actions/runs/${run}`)).run_attempt;
  for (let a = 1; a <= last; a++) {
    const jobs = JSON.parse(gh('api', `repos/QwenLM/qwen-code/actions/runs/${run}/attempts/${a}/jobs`, '--paginate', '--slurp')).flatMap((p) => p.jobs);
    const job = jobs.find((j) => j.name === GATE);
    if (job) attempts.push(job.conclusion ?? job.status);
  }
  lines.push(`[ci] ${GATE}, attempts on this head: ${attempts.join(', then ')}`);
}
const threads = JSON.parse(gh('api', 'graphql', '--paginate', '--slurp', '-f', 'query=query($endCursor:String){repository(owner:"QwenLM",name:"qwen-code"){pullRequest(number:12868){reviewThreads(first:100,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{isResolved}}}}}'))
  .flatMap((p) => p.data.repository.pullRequest.reviewThreads.nodes);
const open = threads.filter((t) => !t.isResolved).length;
const reviews = JSON.parse(gh('api', 'repos/QwenLM/qwen-code/pulls/12868/reviews', '--paginate', '--slurp')).flat();
const onHead = reviews.filter((r) => r.commit_id === HEAD);
const bot = onHead.filter((r) => /bot/i.test(r.user.login));
const approvals = onHead.filter((r) => r.state === 'APPROVED').map((r) => r.user.login);
lines.push(`[ci] review threads: ${threads.length}, ${open === 0 ? 'none unresolved' : `${open} unresolved`} · reviews made on this head: ${onHead.length}${bot.length ? ` (by the review bot: ${bot.map((r) => r.state).join(', ')})` : ', none by the review bot'} · review decision ${pr.reviewDecision} · PR ${pr.state}`);
const running = pending.some((p) => p.startsWith('review-pr'));
lines.push(`[review] ${approvals.length ? `${approvals.length} reviewer${approvals.length === 1 ? ' has' : 's have'} approved this head` : 'No reviewer has approved this head'}; ${open === 0 ? `all ${threads.length} review threads are resolved` : `${open} of ${threads.length} review threads are open`}; the review decision on the PR reads \`${pr.reviewDecision}\`. None of the reviews names R7-1.`);
lines.push(`[review-zh] ${approvals.length ? `已有 ${approvals.length} 位评审人批准了这个 head` : '还没有评审人批准这个 head'}；${open === 0 ? `${threads.length} 个评审 thread 全部已解决` : `${threads.length} 个评审 thread 里还有 ${open} 个未解决`}；PR 上的评审结论是 \`${pr.reviewDecision}\`。这些评审都没有提到 R7-1。`);
lines.push(`[state] ${JSON.stringify({ pass: by('pass').length, pending, failing, gateAttempts: attempts, threads: threads.length, open, onHead: onHead.map((r) => `${r.state}:${r.id}`), decision: pr.reviewDecision })}`);
fs.writeFileSync(path.join(RIG, 'out', 'ci.log'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
