// Mail user agent for the PR 13572 rig.
//   node mua.mjs send <from-login> <subject> <text> [--reply-to-id <msgid>] [--refs a,b] [--attach name:bytes[:mime]] [--message-id <id>]
//   node mua.mjs list <login> [--full]        INBOX headers (+ body with --full) as JSON
//   node mua.mjs append-raw <login> <file>    APPEND a raw RFC 822 file into INBOX (redelivery under a new UID)
//   node mua.mjs status <login>               uidValidity/uidNext/messages
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
const NM = '/Users/wenshao/git/pr13572-head/packages/channels/email/node_modules';
const { default: nodemailer } = await import(`${NM}/nodemailer/dist/cjs/nodemailer.js`);
const { ImapFlow } = (await import('/Users/wenshao/git/pr13572-head/node_modules/imapflow/lib/imap-flow.js')).default ?? (await import('/Users/wenshao/git/pr13572-head/node_modules/imapflow/lib/imap-flow.js'));
const { simpleParser } = (await import('/Users/wenshao/git/pr13572-head/node_modules/mailparser/index.js')).default;

const CA = readFileSync('/Users/wenshao/git/pr13572-rig/mail/tls/ca.pem');
const PASS = (login) => `${login}pw`;
const [, , cmd, ...rest] = process.argv;
const flag = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const flags = (name) => rest.flatMap((v, i) => (rest[i - 1] === name ? [v] : []));

async function imap(login, fn) {
  const client = new ImapFlow({
    host: '127.0.0.1', port: 35727, secure: true, tls: { ca: CA },
    auth: { user: login, pass: PASS(login) }, logger: false,
  });
  await client.connect();
  try { return await fn(client); } finally { await client.logout().catch(() => {}); }
}

if (cmd === 'send') {
  const [from, subject, text] = rest;
  const transport = nodemailer.createTransport({ host: '127.0.0.1', port: 35725, secure: false, ignoreTLS: true });
  const messageId = flag('--message-id') ?? `<${randomUUID()}@rig.test>`;
  const attachments = flags('--attach').map((spec) => {
    const [name, bytes, mime] = spec.split(':');
    const content = randomBytes(Number(bytes));
    return { filename: name, content, contentType: mime ?? 'application/octet-stream' };
  });
  const info = await transport.sendMail({
    from: `${from}@rig.test`, to: 'agent@rig.test', subject, text, messageId,
    ...(flag('--reply-to-id') ? { inReplyTo: flag('--reply-to-id'), references: (flag('--refs') ?? flag('--reply-to-id')).split(',') } : {}),
    attachments,
  });
  console.log(JSON.stringify({ messageId, accepted: info.accepted, response: info.response }));
} else if (cmd === 'list') {
  const [login] = rest;
  const full = rest.includes('--full');
  const out = await imap(login, async (c) => {
    const lock = await c.getMailboxLock('INBOX');
    try {
      const list = [];
      if (!c.mailbox.exists) return list;
      for await (const m of c.fetch('1:*', { uid: true, source: true })) {
        const p = await simpleParser(m.source);
        list.push({
          uid: m.uid,
          date: p.date?.toISOString(),
          from: p.from?.text, to: p.to?.text, subject: p.subject,
          messageId: p.messageId, inReplyTo: p.inReplyTo, references: p.references,
          autoSubmitted: p.headers.get('auto-submitted'),
          bytes: m.source.length,
          textLength: p.text?.length ?? 0,
          ...(full ? { text: p.text } : { head: p.text?.slice(0, 160), tail: p.text?.slice(-120) }),
          attachments: p.attachments.map((a) => ({ name: a.filename, size: a.size })),
        });
      }
      return list;
    } finally { lock.release(); }
  });
  console.log(JSON.stringify(out, null, 1));
} else if (cmd === 'append-raw') {
  const [login, file] = rest;
  const res = await imap(login, (c) => c.append('INBOX', readFileSync(file)));
  console.log(JSON.stringify(res, (k, v) => (typeof v === 'bigint' ? String(v) : v)));
} else if (cmd === 'fetch-raw') {
  const [login, uid, file] = rest;
  await imap(login, async (c) => {
    const lock = await c.getMailboxLock('INBOX');
    try {
      const m = await c.fetchOne(uid, { source: true }, { uid: true });
      writeFileSync(file, m.source);
      console.log(JSON.stringify({ uid, bytes: m.source.length }));
    } finally { lock.release(); }
  });
} else if (cmd === 'status') {
  const [login] = rest;
  const s = await imap(login, (c) => c.status('INBOX', { uidNext: true, uidValidity: true, messages: true }));
  console.log(JSON.stringify({ ...s, uidValidity: String(s.uidValidity) }));
} else {
  console.error('bad command');
  process.exit(2);
}
