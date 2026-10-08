// Prints curl -H arguments for a signed GET per README "Broker authentication".
import { createHmac, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const [method, path, tenant, actor, keyFile] = process.argv.slice(2);
const key = readFileSync(keyFile, 'utf8');
const ts = String(Math.floor(Date.now() / 1000));
const [p, q = ''] = path.split('?');
const canonical = `qwen-broker-auth-v1\n${method}\n${p}\n${q}\n${tenant}\n${actor}\n${ts}\n${createHash('sha256').update('').digest('hex')}\n`;
const sig = createHmac('sha256', Buffer.from(key, 'utf8')).update(canonical, 'utf8').digest('hex');
console.log(`-H X-Qwen-Tenant-Id:${tenant} -H X-Qwen-Actor-Id:${actor} -H X-Qwen-Signature-Timestamp:${ts} -H X-Qwen-Signature:v1=${sig}`);
