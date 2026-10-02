// VERIFICATION RIG ONLY (PR #13084; from the #13087 rig): MySQL TCP relay 127.0.0.1:<listen> -> 127.0.0.1:23084.
// Records COM_QUERY text matching a pattern with the first reply packet (OK affected / ERR / resultset).
// Stall rule armed at runtime by SIGUSR2 from <run>/sqltap-arm.json {"re": "...", "skip": n, "ms": n}:
// the (skip+1)-th COM_QUERY matching re, and everything after it on that connection, is held for ms
// before being forwarded (the relay holds no lock; MySQL simply has not seen the statement yet).
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
const [port, logFile, pattern] = process.argv.slice(2);
const UP = Number(process.env.UPSTREAM ?? 23084);
const re = new RegExp(pattern ?? 'qwen_output|qwen_tool_publication_tenant|managed_agent_operation|qwen_managed_session_journal_head|COMMIT|ROLLBACK', 'i');
const log = fs.createWriteStream(logFile, { flags: 'a' });
const armFile = path.join(path.dirname(logFile), 'sqltap-arm.json');
let conn = 0, rule = null;
process.on('SIGUSR2', () => {
  const a = JSON.parse(fs.readFileSync(armFile, 'utf8'));
  rule = { re: new RegExp(a.re), skip: a.skip ?? 0, ms: a.ms ?? 10000 };
  log.write(JSON.stringify({ t: Date.now(), conn: 0, result: 'ARMED', sql: a.re, skip: rule.skip, ms: rule.ms }) + '\n');
});
const strip = (s) => s.replace(/^[\x00-\x20]+/, '');
function lenenc(buf, off) {
  const b = buf[off];
  if (b < 0xfb) return [b, 1];
  if (b === 0xfc) return [buf.readUInt16LE(off + 1), 3];
  if (b === 0xfd) return [buf.readUIntLE(off + 1, 3), 4];
  return [Number(buf.readBigUInt64LE(off + 1)), 9];
}
net.createServer((client) => {
  const id = ++conn;
  const up = net.connect(UP, '127.0.0.1');
  client.setNoDelay(true); up.setNoDelay(true);
  let cbuf = Buffer.alloc(0), sbuf = Buffer.alloc(0);
  const pending = [];
  let holdUntil = 0; const queue = [];
  const flush = () => { while (queue.length && Date.now() >= holdUntil) up.write(queue.shift()); };
  client.on('data', (d) => {
    cbuf = Buffer.concat([cbuf, d]);
    while (cbuf.length >= 4) {
      const len = cbuf.readUIntLE(0, 3);
      if (cbuf.length < 4 + len) break;
      const p = cbuf.subarray(4, 4 + len);
      const cseq = cbuf[3];
      const whole = Buffer.from(cbuf.subarray(0, 4 + len));
      cbuf = cbuf.subarray(4 + len);
      if (rule && cseq === 0 && p[0] === 0x03 && rule.re.test(strip(p.subarray(1).toString('utf8')))) {
        if (rule.skip > 0) { rule.skip--; log.write(JSON.stringify({ t: Date.now(), conn: id, result: 'SKIPPED-MATCH', sql: strip(p.subarray(1).toString('utf8')).slice(0, 200) }) + '\n'); }
        else {
          const ms = rule.ms; rule = null; holdUntil = Date.now() + ms;
          log.write(JSON.stringify({ t: Date.now(), conn: id, result: 'STALLED ' + ms + 'ms', sql: strip(p.subarray(1).toString('utf8')).slice(0, 300) }) + '\n');
          setTimeout(() => { log.write(JSON.stringify({ t: Date.now(), conn: id, result: 'RELEASED', sql: '' }) + '\n'); flush(); }, ms + 5);
        }
      }
      queue.push(whole); flush();
      if (cseq !== 0) continue;
      if (p[0] === 0x03) {
        const sql = strip(p.subarray(1).toString('utf8'));
        pending.push(re.test(sql) ? { t: Date.now(), sql: sql.replace(/\s+/g, ' ') } : null);
      } else pending.push(null);
    }
  });
  up.on('data', (d) => {
    client.write(d);
    sbuf = Buffer.concat([sbuf, d]);
    while (sbuf.length >= 4) {
      const len = sbuf.readUIntLE(0, 3);
      if (sbuf.length < 4 + len) break;
      const p = sbuf.subarray(4, 4 + len);
      const seq = sbuf[3];
      sbuf = sbuf.subarray(4 + len);
      if (seq !== 1 || !pending.length) continue;
      const q = pending.shift();
      if (!q) continue;
      let result = 'resultset';
      if (p[0] === 0x00) result = `OK affected=${lenenc(p, 1)[0]}`;
      else if (p[0] === 0xff) result = `ERR ${p.readUInt16LE(1)} ${p.subarray(9).toString('utf8').slice(0, 120)}`;
      log.write(JSON.stringify({ t: q.t, conn: id, result, sql: q.sql.slice(0, 400) }) + '\n');
    }
  });
  const end = () => { client.destroy(); up.destroy(); };
  client.on('error', end); up.on('error', end); client.on('close', end); up.on('close', end);
}).listen(Number(port), '127.0.0.1', () => console.log('sqltap on', port, '->', UP));
