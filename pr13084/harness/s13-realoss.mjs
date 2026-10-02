// s13: real Aliyun OSS (temporary private bucket). Publish, read, pause the JVM mid-read, read again, retire.
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
const ARM = process.env.ARM;
L.openLog(`s13-${ARM}`);
const RO = `${L.S}/realoss`;
const bucket = (await import('node:fs')).readFileSync(`${RO}/bucket.txt`, 'utf8').trim();
const ossInfo = () => execFileSync(`${process.env.HOME}/Install/jdk21/bin/java`, ['-Dhttps.proxyHost=', '-Dhttp.proxyHost=', '-DsocksProxyHost=', '-cp', `${RO}/out:${RO}/lib/*`, 'RealOss', 'info', bucket], { encoding: 'utf8' }).split('\n').filter((l) => /objects=/.test(l))[0]?.replace(bucket, '<bucket>') ?? 'n/a';
const SIZE = 16 * 1024 * 1024 + 3;
const t0 = Date.now();
const m = await L.makeOutput('real-oss', `ws-real-${ARM}-${Date.now().toString(36)}`, process.env.ST ?? 'st-s57', L.genCmd(`real${ARM}`, SIZE, 0, 0), { turnMs: 600_000 });
const a = m.arts.find((x) => x.stream_role === 'stdout');
let attempts = 'n/a'; try { attempts = L.putAttempts(L.sql(`SELECT publication_id FROM qwen_tool_publication WHERE session_id='${m.session}'`)[0][0]); } catch {}
L.say('publish', { turn: m.turn.status, results: m.results, ms: Date.now() - t0, bytes: a?.byte_length, shaOk: a?.sha256 === L.genSha(`real${ARM}`, 'stdout', SIZE), attempts, oss: ossInfo() });
const d1 = await L.streamDownload(m.session, a);
const r1 = await L.content(m.session, a.id, { revision: a.revision, range: 'bytes=5000000-5999999' });
L.say('read', `full ${d1.status} ${d1.bytes} B in ${d1.closeMs} ms sha=${d1.sha256 === a.sha256}; range ${r1.status} ${r1.body.length}`);
const progress = { bytes: 0 };
const dl = L.streamDownload(m.session, a, { progress });
await L.sleep(800);
const pid = L.springPid();
process.kill(pid, 'SIGSTOP'); const at = progress.bytes;
await L.sleep(125_000);
process.kill(pid, 'SIGCONT');
const d2 = await dl;
const after = [];
for (let i = 0; i < 3; i++) { const r = await L.content(m.session, a.id, { revision: a.revision, range: 'bytes=0-1048575' }); after.push(`${r.status}${r.code ? '/' + r.code : ''}`); }
L.say('pause', `bytes at SIGSTOP ${at}; stream ${d2.status} ${d2.bytes}/${d2.declared} ended=${d2.ended}; three Range reads afterwards: ${after.join(', ')}`);
L.say('retire', L.opSeam(m.session, 'DELETE').split('\n').at(-1).replace(/^op \S+ /, ''));
L.say('after-retire', `content ${(await L.content(m.session, a.id, { revision: a.revision })).status}; oss ${ossInfo()}`);
