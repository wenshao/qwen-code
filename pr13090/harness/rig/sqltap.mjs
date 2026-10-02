// PR #13087 rig: MySQL TCP relay that records COM_QUERY text matching a pattern and the
// affected-row count of the server's OK reply (Connector/J sends client-side prepared
// statements as plain COM_QUERY when useSSL=false).
// usage: node sqltap.mjs <listenPort> <logFile> [regex]   (upstream 127.0.0.1:33091)
import net from 'node:net';
import fs from 'node:fs';
const [port, logFile, pattern] = process.argv.slice(2);
const re = new RegExp(pattern ?? 'qwen_tool_publication|qwen_managed_session_journal_head|qwen_output|COMMIT|ROLLBACK', 'i');
const log = fs.createWriteStream(logFile, { flags: 'a' });
let conn = 0;
// Stall rule (armed by SIGUSR2): hold the next COM_QUERY matching STALL_RE, and everything
// after it on that connection, for STALL_MS before forwarding (no lock is taken meanwhile).
const STALL_RE = new RegExp(process.env.STALL_RE ?? '^INSERT INTO qwen_tool_publication_tenant');
const STALL_MS = Number(process.env.STALL_MS ?? 70000);
let armed = false;
process.on('SIGUSR2', () => { armed = true; log.write(JSON.stringify({ t: Date.now(), conn: 0, result: 'ARMED', sql: String(STALL_RE) }) + '\n'); });
function lenenc(buf, off) {
  const b = buf[off];
  if (b < 0xfb) return [b, 1];
  if (b === 0xfc) return [buf.readUInt16LE(off + 1), 3];
  if (b === 0xfd) return [buf.readUIntLE(off + 1, 3), 4];
  return [Number(buf.readBigUInt64LE(off + 1)), 9];
}
net.createServer((client) => {
  const id = ++conn;
  const up = net.connect(33091, '127.0.0.1');
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
      if (armed && cseq === 0 && p[0] === 0x03 && STALL_RE.test(p.subarray(1).toString('utf8').replace(/^[\x00-\x20]+/, ''))) {
        armed = false; holdUntil = Date.now() + STALL_MS;
        log.write(JSON.stringify({ t: Date.now(), conn: id, result: 'STALLED ' + STALL_MS + 'ms', sql: p.subarray(1).toString('utf8').slice(0, 200) }) + '\n');
        setTimeout(() => { log.write(JSON.stringify({ t: Date.now(), conn: id, result: 'FORWARDED', sql: 'stalled statement released' }) + '\n'); flush(); }, STALL_MS + 5);
      }
      queue.push(whole); flush();
      if (cseq !== 0) continue; // only command starts expect a response
      if (p[0] === 0x03) {
        const sql = p.subarray(1).toString('utf8');
        pending.push(re.test(sql) ? { t: Date.now(), sql: sql.replace(/\s+/g, ' ') } : null);
      } else pending.push(null);
    }
  });
  up.on('data', (d) => {
    client.write(d);
    sbuf = Buffer.concat([sbuf, d]);
    // Only the first packet of each response matters (OK/ERR/resultset header).
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
      else if (p[0] === 0xff) result = `ERR ${p.readUInt16LE(1)} ${p.subarray(9).toString('utf8').slice(0, 80)}`;
      log.write(JSON.stringify({ t: q.t, conn: id, result, sql: q.sql.slice(0, 400) }) + '\n');
    }
  });
  const end = () => { client.destroy(); up.destroy(); };
  client.on('error', end); up.on('error', end); client.on('close', end); up.on('close', end);
}).listen(Number(port), '127.0.0.1', () => console.log('sqltap on', port));
