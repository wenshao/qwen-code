// Drives a real `qwen serve --channel dingtalk` daemon (per arm, per scenario)
// against the fake DingTalk gateway + scripted model, and classifies every
// probe as ANSWERED / REJECTED(<reason>) / PAIRING / NO_REPLY / etc.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const H = path.dirname(new URL(import.meta.url).pathname);
const RUNS = process.env.RUNS || '/root/git/qwen-code-x3/tmp/pr12475-verify-20260923-071935/runs/dingtalk';
const SHARED_LOGS = process.env.DT_LOGS || path.join(RUNS, 'shared');
const CTRL = 'http://127.0.0.1:28081';
const ARMS = { base: '/root/git/qwen-code-x3/tmp/pr12475-base', head: '/root/git/qwen-code-x3/tmp/pr12475-head' };
const only = process.argv[2]?.split(',');
const onlyArms = process.argv[3]?.split(',') ?? ['base', 'head'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readLines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const BASE_CH = {
  type: 'dingtalk', clientId: 'harness-client', clientSecret: 'harness-secret',
  groupPolicy: 'open', dmPolicy: 'open', senderPolicy: 'allowlist', allowedUsers: ['alice'],
  approvalMode: 'yolo',
};

// kind: G = group @-mention, g = group without mention, D = direct message
const SCENARIOS = [
  { id: 'S0', title: 'keys absent (inherit)', cfg: {}, probes: [['G', 'alice'], ['G', 'bob'], ['D', 'alice'], ['D', 'bob']] },
  { id: 'S1', title: 'groupSenderPolicy: open', cfg: { groupSenderPolicy: 'open' }, probes: [['G', 'bob'], ['G', 'carol'], ['G', 'alice'], ['D', 'bob'], ['D', 'alice']] },
  { id: 'S2', title: 'groupSenderPolicy: allowlist, allowedGroupUsers: [carol]', cfg: { groupSenderPolicy: 'allowlist', allowedGroupUsers: ['carol'] }, probes: [['G', 'carol'], ['G', 'alice'], ['G', 'bob'], ['D', 'carol'], ['D', 'alice']] },
  { id: 'S3', title: 'groupSenderPolicy: inherit (explicit)', cfg: { groupSenderPolicy: 'inherit' }, probes: [['G', 'bob'], ['G', 'alice']] },
  { id: 'S4', title: 'groupSenderPolicy: pairing (invalid)', cfg: { groupSenderPolicy: 'pairing' }, probes: [['G', 'bob']] },
  { id: 'S5', title: 'senderPolicy: pairing + groupSenderPolicy: open', cfg: { senderPolicy: 'pairing', groupSenderPolicy: 'open' }, probes: [['G', 'dave'], ['D', 'dave'], ['G', 'dave']] },
  { id: 'S6a', title: 'groupHistoryLimit: 5, keys absent', cfg: { groupHistoryLimit: 5 }, probes: [['g', 'bob'], ['G', 'alice']] },
  { id: 'S6b', title: 'groupHistoryLimit: 5 + groupSenderPolicy: open', cfg: { groupHistoryLimit: 5, groupSenderPolicy: 'open' }, probes: [['g', 'bob'], ['G', 'alice']] },
  { id: 'S7', title: 'shared group session (sessionScope: thread) + open + approvalMode default', cfg: { groupSenderPolicy: 'open', sessionScope: 'thread', approvalMode: 'default' }, probes: [['G', 'bob', 'TOOL-TOUCH'], ['G', 'bob', '/approve'], ['G', 'alice', '/approve']], toolSettings: true },
  { id: 'S7u', title: 'per-user group session (sessionScope: user) + open + approvalMode default', cfg: { groupSenderPolicy: 'open', sessionScope: 'user', approvalMode: 'default' }, probes: [['G', 'bob', 'TOOL-TOUCH'], ['G', 'bob', '/approve']], toolSettings: true },
  { id: 'S8', title: 'R1-1: allowedUsers EMPTY + senderPolicy pairing + open axis, shared session', cfg: { senderPolicy: 'pairing', allowedUsers: undefined, groupSenderPolicy: 'open', sessionScope: 'thread', approvalMode: 'default' }, probes: [['G', 'bob', 'TOOL-TOUCH'], ['G', 'bob', '/approve']], toolSettings: true },
];

function frame(kind, sender, token, extra) {
  const isGroup = kind !== 'D';
  const cid = isGroup ? 'cid-grp-1' : `cid-dm-${sender}`;
  const mention = kind === 'G';
  const text = extra?.startsWith('/') ? `${extra}` : `${token} hello from ${sender}${extra ? ' ' + extra : ''}`;
  return {
    msgId: `m-${token}`, msgtype: 'text', conversationType: isGroup ? '2' : '1', conversationId: cid,
    ...(isGroup ? { conversationTitle: 'Team Group' } : {}),
    sessionWebhook: `https://oapi.dingtalk.com/robot/send?access_token=${cid}`, sessionWebhookExpiredTime: 9999999999999,
    chatbotUserId: 'bot-user', senderNick: sender[0].toUpperCase() + sender.slice(1), senderStaffId: sender, senderId: `$:LWCP_v1:$${sender}`,
    isInAtList: mention, atUsers: mention ? [{ dingtalkId: 'bot-user' }] : [],
    text: { content: text }, createAt: Date.now(),
  };
}

async function waitClients(n, ms, proc) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (proc.exitCode !== null) return 'exited';
    try { const r = await (await fetch(`${CTRL}/clients`)).json(); if (r.clients >= n) return 'connected'; } catch {}
    await sleep(300);
  }
  return 'timeout';
}

function outboundSince(off) {
  return readLines(path.join(SHARED_LOGS, 'api.jsonl')).slice(off).filter((e) => /\/robot\/send|\/v1\.0\/robot\/(groupMessages|oToMessages)|\/v1\.0\/card\//.test(e.path));
}

async function runScenario(arm, sc) {
  const dir = path.join(RUNS, arm, sc.id);
  fs.rmSync(dir, { recursive: true, force: true });
  const home = path.join(dir, 'home'); const ws = path.join(dir, 'workspace');
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(ws, { recursive: true });
  const settings = {
    general: { language: 'en' },
    security: { auth: { selectedType: 'openai' }, folderTrust: { enabled: false } },
    privacy: { usageStatisticsEnabled: false },
    ...(sc.toolSettings ? { tools: { approvalMode: 'default' } } : {}),
    channels: { dingtalk: { ...BASE_CH, cwd: ws, ...sc.cfg } },
    $version: 4,
  };
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify(settings, null, 2));
  const logFile = path.join(dir, 'daemon.log');
  const out = fs.openSync(logFile, 'w');
  const proc = spawn(process.execPath, [path.join(ARMS[arm], 'dist/cli.js'), 'serve', '--hostname', '127.0.0.1', '--port', '28099', '--no-web', '--channel', 'dingtalk'], {
    cwd: ws, stdio: ['ignore', out, out], detached: true,
    env: { ...process.env, QWEN_HOME: home, NODE_EXTRA_CA_CERTS: path.join(H, 'certs/ca.crt'), OPENAI_BASE_URL: 'http://127.0.0.1:28090/v1', OPENAI_API_KEY: 'harness-key', OPENAI_MODEL: 'harness-model', NO_PROXY: '*', no_proxy: '*', HTTPS_PROXY: '', HTTP_PROXY: '', https_proxy: '', http_proxy: '' },
  });
  const state = await waitClients(1, 60000, proc);
  const result = { arm, id: sc.id, title: sc.title, cfg: sc.cfg, startup: state, probes: [] };
  if (state !== 'connected') {
    await sleep(1500);
    result.startupLog = fs.readFileSync(logFile, 'utf8').split('\n').filter((l) => /groupSenderPolicy|allowedGroupUsers|Error|error|fail/i.test(l)).slice(0, 8);
  } else {
    await sleep(800);
    let i = 0;
    for (const [kind, sender, extra] of sc.probes) {
      i++;
      const token = `T-${sc.id}-${i}-${kind}-${sender}`;
      const apiOff = readLines(path.join(SHARED_LOGS, 'api.jsonl')).length;
      const modelOff = readLines(path.join(SHARED_LOGS, 'openai.jsonl')).length;
      const logOff = fs.readFileSync(logFile, 'utf8').length;
      await fetch(`${CTRL}/push`, { method: 'POST', body: JSON.stringify(frame(kind, sender, token, extra)) });
      const wantText = extra?.startsWith('/') ? null : `ANSWER ${token}`;
      let verdict = null; let detail = '';
      const deadline = Date.now() + (kind === 'g' ? 3000 : 20000);
      let rejectedAt = 0;
      while (Date.now() < deadline) {
        await sleep(250);
        const outs = outboundSince(apiOff);
        const blob = JSON.stringify(outs);
        const newLog = fs.readFileSync(logFile, 'utf8').slice(logOff);
        if (wantText && blob.includes(wantText)) { verdict = 'ANSWERED'; break; }
        if (/pairing code|Pairing code|配对码|approve/i.test(blob) && /[A-Z0-9]{6,8}/.test(blob) && !extra?.startsWith('/') && /pair/i.test(blob)) { verdict = 'PAIRING_CODE'; detail = blob.slice(0, 400); break; }
        if (extra?.startsWith('/') && outs.length > 0) {
          const texts = outs.map((o) => o.body?.text?.content ?? o.body?.markdown?.text ?? JSON.stringify(o.body)).join(' | ');
          if (/Only authorized members/.test(texts)) { verdict = 'COMMAND_DENIED'; detail = texts.slice(0, 300); break; }
          if (texts.includes('ANSWER ')) { verdict = 'APPROVED_AND_ANSWERED'; detail = texts.slice(0, 300); break; }
        }
        if (extra === 'TOOL-TOUCH' && /\/approve/.test(blob)) { verdict = 'PERMISSION_PROMPTED'; detail = ''; break; }
        const m = newLog.match(/preflight rejected reason=(\S+)/);
        if (m && !rejectedAt) { rejectedAt = Date.now(); detail = m[1]; }
        if (rejectedAt && Date.now() - rejectedAt > 2500) { verdict = `REJECTED(${detail})`; break; }
      }
      if (!verdict) verdict = kind === 'g' ? 'NO_REPLY(unmentioned)' : 'NO_REPLY';
      if (extra?.startsWith('/') && verdict === 'COMMAND_DENIED' === false && verdict.startsWith('NO_REPLY')) {
        // approval may have produced a follow-up answer through the model
        const blob = JSON.stringify(outboundSince(apiOff));
        if (blob.includes('ANSWER ')) verdict = 'APPROVED_AND_ANSWERED';
      }
      const modelReqs = readLines(path.join(SHARED_LOGS, 'openai.jsonl')).slice(modelOff);
      result.probes.push({ kind, sender, extra: extra ?? null, token, verdict, detail, modelRequests: modelReqs.length, modelSawHistory: modelReqs.some((r) => r.hasHistory), historyText: modelReqs.find((r) => r.hasHistory)?.lastUser?.slice(0, 600) ?? null });
      if (extra === 'TOOL-TOUCH' || extra?.startsWith('/')) await sleep(1500);
    }
    // what the pairing store holds, if any
    const pairFiles = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/pairing|allowlist/i.test(e.name)) pairFiles.push({ file: path.relative(home, p), content: fs.readFileSync(p, 'utf8').slice(0, 800) }); } };
    walk(home);
    result.pairingFiles = pairFiles;
    result.markerFiles = fs.readdirSync(ws).filter((f) => f.endsWith('.txt'));
  }
  try { process.kill(-proc.pid, 'SIGTERM'); } catch {}
  const end = Date.now() + 10000;
  while (proc.exitCode === null && Date.now() < end) await sleep(200);
  if (proc.exitCode === null) { try { process.kill(-proc.pid, 'SIGKILL'); } catch {} }
  for (let k = 0; k < 40; k++) { try { const r = await (await fetch(`${CTRL}/clients`)).json(); if (r.clients === 0) break; } catch {} await sleep(250); }
  return result;
}

const results = [];
for (const sc of SCENARIOS) {
  if (only && !only.includes(sc.id)) continue;
  for (const arm of onlyArms) {
    const r = await runScenario(arm, sc);
    results.push(r);
    console.log(`${arm.padEnd(4)} ${sc.id.padEnd(4)} startup=${r.startup} ` + r.probes.map((p) => `${p.kind}:${p.sender}${p.extra ? '(' + p.extra + ')' : ''}=${p.verdict}${p.modelSawHistory ? '[hist]' : ''}`).join('  '));
    if (r.startupLog) console.log('     ', r.startupLog.join('\n      '));
  }
}
fs.writeFileSync(path.join(RUNS, `results-${Date.now()}.json`), JSON.stringify(results, null, 2));
