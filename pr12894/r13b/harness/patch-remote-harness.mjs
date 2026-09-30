// Adds a remote mode to lib.mjs Harness: REMOTE_HARNESS_HOST=root@host runs the
// Harnesses whose name matches REMOTE_HARNESS_NAMES (regex) on that host over ssh.
// Local services are reached through ssh -R tunnels on shifted remote ports, and
// the Harness API through ssh -L. Idempotent.
import fs from 'node:fs';
const f = new URL('./lib.mjs', import.meta.url);
let t = fs.readFileSync(f, 'utf8');
if (t.includes('REMOTE_HARNESS_HOST')) { console.log('already patched'); process.exit(0); }

t = t.replace(
  `    Object.assign(this, { name, modelUrl, brokerUrl, realModel });`,
  `    Object.assign(this, { name, modelUrl, brokerUrl, realModel });
    const rh = process.env.REMOTE_HARNESS_HOST;
    this.remote = rh && new RegExp(process.env.REMOTE_HARNESS_NAMES ?? '.*').test(name) ? rh : undefined;`,
);

const startMarker = `    this.logPath = path.join(RIG, 'run', \`harness-\${this.name}.log\`);
    const log = fs.openSync(this.logPath, 'w');
    this.child = spawn(NODE22, args, {`;
if (!t.includes(startMarker)) throw new Error('start marker not found');
t = t.replace(startMarker, `    this.logPath = path.join(RIG, 'run', \`harness-\${this.name}.log\`);
    const log = fs.openSync(this.logPath, 'w');
    if (this.remote) return this.startRemote(args, env, qwenHome, log);
    this.child = spawn(NODE22, args, {`);

const logMarker = `  log() {
    return fs.readFileSync(this.logPath, 'utf8');
  }`;
t = t.replace(logMarker, `  mapUrl(u) {
    if (!this.remote || !u) return u;
    const x = new URL(u);
    if (x.hostname !== '127.0.0.1') return u;
    x.port = String(remotePort(Number(x.port)));
    return x.toString().replace(/\\/$/, u.endsWith('/') ? '/' : '');
  }
  async startRemote(args, env, qwenHome, log) {
    const rroot = \`/root/rig-pr12894/harness-\${this.name}\`;
    const rwt = process.env.REMOTE_HARNESS_WT ?? '/root/git/qwen-code-pr12894-rv';
    const rport = 45000 + Math.floor(Math.random() * 5000);
    const lport = await freeLocalPort();
    const settings = fs.readFileSync(path.join(qwenHome, 'settings.json'), 'utf8').split(this.modelUrl ?? '\\u0000').join(this.mapUrl(this.modelUrl) ?? '');
    const localCli = path.join(process.env.HARNESS_WT ?? WT, 'dist', 'cli.js');
    const rargs = args.map((a, i) => (a === localCli ? \`\${rwt}/dist/cli.js\` : a === this.root ? rroot : a === this.brokerUrl ? this.mapUrl(a) : args[i - 1] === '--port' ? String(rport) : a));
    const renv = {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: rroot, QWEN_HOME: \`\${rroot}/.qwen\`,
      QWEN_CODE_SYSTEM_SETTINGS_PATH: \`\${rroot}/system-settings.json\`,
      QWEN_CODE_SYSTEM_DEFAULTS_PATH: \`\${rroot}/system-defaults.json\`,
      QWEN_RUNTIME_DIR: \`\${rroot}/runtime\`, QWEN_SANDBOX: 'false', NO_COLOR: '1',
      ...(env.OPENAI_API_KEY ? { OPENAI_API_KEY: env.OPENAI_API_KEY, OPENAI_BASE_URL: this.mapUrl(env.OPENAI_BASE_URL), OPENAI_MODEL: env.OPENAI_MODEL, QWEN_MODEL: env.QWEN_MODEL } : {}),
    };
    if (this.realModel) throw new Error('remote Harness is only used with the fake model');
    const q = (s) => \`'\${String(s).replace(/'/g, \`'\\\\''\`)}'\`;
    const script = [
      'set -e', \`rm -rf \${rroot}\`, \`mkdir -p \${rroot}/.qwen \${rroot}/runtime\`,
      \`printf %s \${q(settings)} > \${rroot}/.qwen/settings.json\`, \`cd \${rroot}\`, \`echo $$ > \${rroot}/pid\`,
      \`exec env -i \${Object.entries(renv).map(([k, v]) => \`\${k}=\${q(v)}\`).join(' ')} node \${rargs.map(q).join(' ')}\`,
    ].join('; ');
    const ports = [...new Set([18894, 18895, portOf(this.brokerUrl), portOf(this.modelUrl)].filter(Boolean))];
    const fwd = ports.flatMap((p) => ['-R', \`\${remotePort(p)}:127.0.0.1:\${p}\`]);
    this.remoteRoot = rroot;
    this.child = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-L', \`\${lport}:127.0.0.1:\${rport}\`, ...fwd, this.remote, script], { stdio: ['ignore', log, log] });
    const sshKill = this.child.kill.bind(this.child);
    this.child.kill = (sig) => {
      try { execFileSync('ssh', ['-o', 'BatchMode=yes', this.remote, \`kill -\${sig === 'SIGKILL' ? 'KILL' : 'TERM'} $(cat \${rroot}/pid) 2>/dev/null; true\`], { timeout: 15000 }); } catch {}
      return sshKill(sig);
    };
    fs.writeFileSync(path.join(RIG, 'run', \`harness-\${this.name}.pid\`), \`remote \${this.remote} \${rroot}/pid\`);
    const end = Date.now() + 90_000;
    while (Date.now() < end) {
      this.output = fs.readFileSync(this.logPath, 'utf8');
      if (/qwen serve listening on http:\\/\\/127\\.0\\.0\\.1:\\d+/.test(this.output)) this.baseUrl = \`http://127.0.0.1:\${lport}\`;
      if (this.child.exitCode !== null) throw new Error(\`remote harness exited: \${this.output}\`);
      if (this.baseUrl) {
        const r = await fetch(this.baseUrl + '/capabilities', { headers: this.headers() }).catch(() => null);
        if (r && r.ok) {
          this.bootId = (await r.json()).hostedHarness.bootId;
          return this;
        }
      }
      await sleep(250);
    }
    throw new Error('remote harness did not start: ' + this.output);
  }
${logMarker}`);

t = t.replace(`export function storeConnection(h, workspaceId, storePort) {`, `export function remotePort(p) {
  return p === 18894 ? 38894 : p === 18895 ? 38895 : 40000 + (p % 5000);
}
function portOf(u) {
  return u ? Number(new URL(u).port) || undefined : undefined;
}
async function freeLocalPort() {
  const { createServer: cs } = await import('node:net');
  return new Promise((resolve) => { const s = cs(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}
export function storeConnection(h, workspaceId, storePort) {`);

// HSession: translate the Store URL for a remote Harness.
t = t.replace(/managedSessionStore: this\.connection,/g, `managedSessionStore: this.h.mapUrl ? { ...this.connection, baseUrl: this.h.mapUrl(this.connection.baseUrl) } : this.connection,`);
fs.writeFileSync(f, t);
console.log('patched; managedSessionStore replacements:', (t.match(/this\.h\.mapUrl\(this\.connection\.baseUrl\)/g) ?? []).length);
