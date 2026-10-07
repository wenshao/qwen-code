'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const H = __dirname;
const ARMS = {
  base: '/Users/cici/git/qwen-code-x6/tmp/pr13250-base',
  head: '/Users/cici/git/qwen-code-x6/tmp/pr13250-head',
};
const CTL = 'http://127.0.0.1:18443';
const MODEL_PORT = 18500;

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m',
  magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function req(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const r = http.request(
      { method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {} },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const s = Buffer.concat(chunks).toString('utf8');
          try {
            resolve(JSON.parse(s));
          } catch {
            resolve(s);
          }
        });
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

class Run {
  constructor(scenario, arm, opts = {}) {
    this.scenario = scenario;
    this.arm = arm;
    this.dir = path.join(H, 'runs', `${scenario}-${arm}${opts.suffix ? '-' + opts.suffix : ''}`);
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    this.home = path.join(this.dir, 'qwen-home');
    this.ws = path.join(this.dir, 'workspace');
    fs.mkdirSync(this.home, { recursive: true });
    fs.mkdirSync(this.ws, { recursive: true });
    this.procs = [];
    this.asserts = [];
    this.transcript = [];
    this.t0 = Date.now();
  }

  log(line, atMs) {
    const t = (((atMs ?? Date.now()) - this.t0) / 1000).toFixed(2).padStart(6);
    this.transcript.push(`${C.gray}${t}s${C.reset} ${line}`);
    process.stdout.write(`[${this.scenario}/${this.arm}] ${line.replace(/\x1b\[[0-9;]*m/g, '')}\n`);
  }

  writeSettings(channelCfg, extra = {}) {
    const settings = {
      security: { auth: { selectedType: 'openai' } },
      model: { name: 'fake-model' },
      ...extra,
      channels: { qq: { type: 'qq', appID: 'app-1001', appSecret: 'secret-1001', cwd: this.ws, ...channelCfg } },
    };
    fs.writeFileSync(path.join(this.home, 'settings.json'), JSON.stringify(settings, null, 2));
    this.settings = settings;
  }

  spawnLogged(name, cmd, args, env, cwd) {
    const out = fs.openSync(path.join(this.dir, `${name}.log`), 'a');
    const p = spawn(cmd, args, { env, cwd: cwd || this.dir, stdio: ['ignore', out, out], detached: true });
    p.name = name;
    this.procs.push(p);
    return p;
  }

  async startFakes() {
    const env = { ...process.env, QQ_LEDGER: path.join(this.dir, 'qq-ledger.jsonl'), MODEL_LEDGER: path.join(this.dir, 'model-ledger.jsonl'), MODEL_PORT: String(MODEL_PORT) };
    this.spawnLogged('fakeqq', process.execPath, [path.join(H, 'fakeqq.cjs')], env);
    this.spawnLogged('fakemodel', process.execPath, [path.join(H, 'fakemodel.cjs')], env);
    await this.waitLog('fakeqq', /FAKEQQ_READY/, 10000);
    await this.waitLog('fakemodel', /FAKEMODEL_READY/, 10000);
  }

  sutEnv() {
    const env = { ...process.env };
    for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'NO_COLOR']) delete env[k];
    // This machine exports QWEN_RUNTIME_DIR globally, which silently defeats
    // HOME isolation; scrub every QWEN_* and re-add only what the harness sets.
    for (const k of Object.keys(env)) if (k.startsWith('QWEN')) delete env[k];
    Object.assign(env, {
      QWEN_HOME: this.home,
      HOME: this.dir,
      NODE_EXTRA_CA_CERTS: path.join(H, 'certs', 'ca.pem'),
      NODE_OPTIONS: `--require ${path.join(H, 'preload.cjs')}`,
      OPENAI_API_KEY: 'sk-fake',
      OPENAI_BASE_URL: `http://127.0.0.1:${MODEL_PORT}/v1`,
      OPENAI_MODEL: 'fake-model',
      QWEN_SANDBOX: 'false',
      QWEN_CODE_NO_RELAUNCH: '1',
      LANG: 'en_US.UTF-8',
    });
    return env;
  }

  async startChannel(mode = 'start') {
    const cli = path.join(ARMS[this.arm], 'packages/cli/dist/index.js');
    this.channelLogName = mode === 'serve' ? 'serve' : 'channel';
    if (mode === 'serve') {
      this.spawnLogged('serve', process.execPath, [cli, 'serve', '--port', '18610', '--token', 'tok-serve', '--workspace', this.ws, '--channel', 'qq'], this.sutEnv(), this.ws);
    } else {
      this.spawnLogged('channel', process.execPath, [cli, 'channel', 'start', 'qq'], this.sutEnv(), this.ws);
    }
    await this.waitLog(this.channelLogName, /\[QQ:qq\] Ready \(/, 90000);
    this.log(`${C.dim}channel ready (${mode}, ${this.arm})${C.reset}`);
  }

  readLog(name) {
    try {
      return fs.readFileSync(path.join(this.dir, `${name}.log`), 'utf8');
    } catch {
      return '';
    }
  }

  async waitLog(name, re, timeout) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (re.test(this.readLog(name))) return true;
      await sleep(100);
    }
    throw new Error(`timeout waiting for ${re} in ${name}.log\n` + this.readLog(name).slice(-3000));
  }

  qqLedger() {
    try {
      return fs.readFileSync(path.join(this.dir, 'qq-ledger.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }
  modelLedger() {
    try {
      return fs.readFileSync(path.join(this.dir, 'model-ledger.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }
  sends() {
    return this.qqLedger().filter((e) => e.kind === 'send').map((e) => ({ ...e, text: (e.body && (e.body.content ?? (e.body.markdown && e.body.markdown.content))) || '' }));
  }

  async waitSend(pred, timeout = 20000, label = 'reply') {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const hit = this.sends().find(pred);
      if (hit) return hit;
      await sleep(100);
    }
    return null;
  }

  async dispatch(t, d) {
    const r = await req('POST', `${CTL}/dispatch`, { t, d });
    if (!r || r.sent !== 1) throw new Error(`dispatch not delivered: ${JSON.stringify(r)}`);
  }

  // ---- event builders ----
  async groupAll(gid, uid, id, content, extra = {}) {
    this.log(`${C.cyan}→ ${gid}/${uid}${C.reset} [${id}] ${content || '(media only)'}${extra.attachments ? C.magenta + ' +image' + C.reset : ''}`);
    await this.dispatch('GROUP_MESSAGE_CREATE', { id, content, timestamp: new Date().toISOString(), group_openid: gid, author: { member_openid: uid, username: uid }, mentions: [], ...extra });
  }
  async groupAt(gid, uid, id, content, extra = {}) {
    this.log(`${C.cyan}→ ${gid}/${uid} @bot${C.reset} [${id}] ${content || '(media only)'}${extra.attachments ? C.magenta + ' +image' + C.reset : ''}`);
    await this.dispatch('GROUP_AT_MESSAGE_CREATE', { id, content, timestamp: new Date().toISOString(), group_openid: gid, author: { member_openid: uid, username: uid }, ...extra });
  }
  async c2c(uid, id, content, extra = {}) {
    this.log(`${C.cyan}→ DM ${uid}${C.reset} [${id}] ${content || '(media only)'}${extra.attachments ? C.magenta + ' +image' + C.reset : ''}`);
    await this.dispatch('C2C_MESSAGE_CREATE', { id, content, timestamp: new Date().toISOString(), author: { user_openid: uid, id: uid, username: uid } });
  }

  logSend(s) {
    const anchor = s.body.msg_id ? `msg_id=${s.body.msg_id} seq=${s.body.msg_seq}` : 'active (no msg_id)';
    this.log(`${C.yellow}← ${s.chatType} ${s.chatId}${C.reset} ${C.dim}[${anchor}]${C.reset} ${JSON.stringify(s.text.length > 90 ? s.text.slice(0, 90) + '…' : s.text)}`, s.ts);
  }

  check(name, actual, expected, opts = {}) {
    const pass = typeof expected === 'function' ? expected(actual) : actual === expected;
    const expectedFail = Boolean(opts.expectFail);
    const rec = { name, actual, expected: typeof expected === 'function' ? opts.describe || 'predicate' : expected, pass, expectedFail };
    this.asserts.push(rec);
    const tag = pass ? `${C.green}PASS${C.reset}` : expectedFail ? `${C.yellow}XFAIL${C.reset}` : `${C.red}FAIL${C.reset}`;
    this.log(`  ${tag} ${name}: ${C.bold}${JSON.stringify(actual)}${C.reset}${pass ? '' : ` (expected ${JSON.stringify(rec.expected)})`}`);
    return pass;
  }

  sessionsJson() {
    const daemonDir = path.join(this.home, 'channels', 'daemon');
    try {
      for (const d of fs.readdirSync(daemonDir)) {
        try {
          return JSON.parse(fs.readFileSync(path.join(daemonDir, d, 'routes.json'), 'utf8'));
        } catch {}
      }
    } catch {}
    for (const f of ['sessions.json', 'qq-sessions-backup.json']) {
      try {
        return JSON.parse(fs.readFileSync(path.join(this.home, 'channels', f), 'utf8'));
      } catch {}
    }
    return null;
  }
  sessionKeys() {
    const j = this.sessionsJson();
    if (!j) return [];
    const entries = Array.isArray(j) ? j : j.sessions || j.entries || j;
    if (Array.isArray(entries)) return entries.map((e) => e.key || e.routingKey || e[0]).filter(Boolean).sort();
    return Object.keys(entries).sort();
  }

  async stop() {
    for (const p of this.procs.slice().reverse()) {
      try {
        process.kill(-p.pid, 'SIGTERM');
      } catch {}
    }
    await sleep(1500);
    for (const p of this.procs) {
      try {
        process.kill(-p.pid, 'SIGKILL');
      } catch {}
    }
  }

  finish() {
    const unexpected = this.asserts.filter((a) => !a.pass && !a.expectedFail).length;
    const passed = this.asserts.filter((a) => a.pass).length;
    const xfail = this.asserts.filter((a) => !a.pass && a.expectedFail).length;
    this.log(`${C.bold}${this.scenario}/${this.arm}: ${passed} pass, ${xfail} expected-fail, ${unexpected} unexpected${C.reset}`);
    fs.writeFileSync(path.join(this.dir, 'result.json'), JSON.stringify({ scenario: this.scenario, arm: this.arm, passed, xfail, unexpected, asserts: this.asserts }, null, 2));
    fs.writeFileSync(path.join(this.dir, 'transcript.ansi'), this.transcript.join('\n') + '\n');
    return unexpected;
  }
}

module.exports = { Run, sleep, C, ARMS, req, CTL };
