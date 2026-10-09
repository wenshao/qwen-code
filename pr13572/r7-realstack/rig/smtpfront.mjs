// Programmable SMTPS front for the PR 13572 rig. The adapter's real
// nodemailer transport talks implicit TLS to this server (rig CA); each
// accepted DATA is relayed into GreenMail's plain SMTP so the recipient's
// real mailbox receives it, then the front answers per the next queued mode:
//   pass               relay, answer 250
//   reject             do not relay, answer 550 (definitive refusal)
//   hold:<ms>          relay, answer 250 after <ms>
//   deliver-hang       relay, never answer (client socket timeout)
//   deliver-drop       relay, destroy the socket (no answer)
// Control (loopback HTTP 35731): POST /mode/<m>[?n=k] queues k copies,
// POST /release releases every held answer, GET /log returns the ledger.
import { readFileSync, appendFileSync } from 'node:fs';
import { createServer as createHttp } from 'node:http';
import { SMTPServer } from 'smtp-server';
import nodemailer from '/Users/wenshao/git/pr13572-head/packages/channels/email/node_modules/nodemailer/dist/cjs/nodemailer.js';

const R = '/Users/wenshao/git/pr13572-rig/mail';
const LOG = `${R}/smtpfront.jsonl`;
const relay = nodemailer.createTransport({ host: '127.0.0.1', port: 35725, secure: false, ignoreTLS: true });
const queue = [];
const held = new Set();
const ledger = [];
const record = (entry) => {
  const line = { t: new Date().toISOString(), ...entry };
  ledger.push(line);
  appendFileSync(LOG, JSON.stringify(line) + '\n');
};

const server = new SMTPServer({
  secure: true,
  key: readFileSync(`${R}/tls/server.key`),
  cert: readFileSync(`${R}/tls/server.pem`),
  authMethods: ['PLAIN', 'LOGIN'],
  onAuth(auth, _session, cb) {
    if (auth.username === 'agent' && auth.password === 'agentpw') return cb(null, { user: 'agent' });
    cb(Object.assign(new Error('Invalid credentials'), { responseCode: 535 }));
  },
  onData(stream, session, cb) {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', async () => {
      const raw = Buffer.concat(chunks);
      const mode = queue.shift() ?? 'pass';
      const header = raw.toString('utf8', 0, Math.min(raw.length, 8192));
      const messageId = /^Message-ID:\s*(.+)$/im.exec(header)?.[1]?.trim();
      const subject = /^Subject:\s*(.+)$/im.exec(header)?.[1]?.trim();
      const inReplyTo = /^In-Reply-To:\s*(.+)$/im.exec(header)?.[1]?.trim();
      const to = session.envelope.rcptTo.map((r) => r.address);
      const base = { mode, messageId, subject, inReplyTo, to, bytes: raw.length };
      if (mode === 'reject') {
        record({ ...base, relayed: false, answer: 550 });
        return cb(Object.assign(new Error('Mailbox unavailable (rig reject)'), { responseCode: 550 }));
      }
      try {
        await relay.sendMail({ envelope: { from: session.envelope.mailFrom.address, to }, raw });
      } catch (error) {
        record({ ...base, relayed: false, relayError: String(error) });
        return cb(Object.assign(new Error('relay failed'), { responseCode: 451 }));
      }
      if (mode === 'pass') {
        record({ ...base, relayed: true, answer: 250 });
        return cb(null, 'Queued');
      }
      if (mode.startsWith('hold:')) {
        const ms = Number(mode.slice(5));
        record({ ...base, relayed: true, answer: `250 after ${ms}ms` });
        const release = () => { held.delete(release); cb(null, 'Queued (held)'); };
        held.add(release);
        setTimeout(() => held.has(release) && release(), ms);
        return;
      }
      if (mode === 'deliver-hang') {
        record({ ...base, relayed: true, answer: 'none (hang)' });
        return; // never answer
      }
      if (mode === 'deliver-drop') {
        record({ ...base, relayed: true, answer: 'none (socket destroyed)' });
        // smtp-server keeps its SMTPConnection objects (and their sockets)
        // in server.connections; the rig sends one message at a time.
        for (const c of server.connections ?? []) c._socket?.destroy();
        return;
      }
      record({ ...base, relayed: true, answer: 250, note: 'unknown mode treated as pass' });
      cb(null, 'Queued');
    });
  },
});
server.on('error', (e) => console.error('smtp error', e.message));
server.listen(35728, '127.0.0.1', () => console.log('SMTPS front 35728'));

createHttp((req, res) => {
  const url = new URL(req.url, 'http://x');
  const m = /^\/mode\/(.+)$/.exec(url.pathname);
  if (req.method === 'POST' && m) {
    const n = Number(url.searchParams.get('n') ?? '1');
    for (let i = 0; i < n; i++) queue.push(decodeURIComponent(m[1]));
    return res.end(JSON.stringify({ queue }) + '\n');
  }
  if (req.method === 'POST' && url.pathname === '/release') {
    const n = held.size;
    for (const r of [...held]) r();
    return res.end(JSON.stringify({ released: n }) + '\n');
  }
  if (req.method === 'POST' && url.pathname === '/reset') {
    queue.length = 0;
    return res.end('{}\n');
  }
  if (url.pathname === '/log') return res.end(JSON.stringify({ queue, held: held.size, ledger }, null, 1) + '\n');
  res.statusCode = 404;
  res.end();
}).listen(35731, '127.0.0.1', () => console.log('control 35731'));
