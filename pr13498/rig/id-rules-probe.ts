// Same id triples through the PR's envelope parser; writes a TSV the Java
// probe reads, then joins both verdicts.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseManagedEventEnvelope } from '../src/managed-runtime/managed-event-envelope.js';
const base = { v: 1, sessionId: 'session-1', tenantId: 'tenant-1', workspaceId: 'workspace-1', sequence: 1, eventId: 'evt-1', kind: 'turn.settled', occurredAt: 1760000000000, payloadRef: { digest: 'a'.repeat(64) } };
const cases: Array<[string, Partial<typeof base>]> = [
  ['baseline', {}],
  ['workspace-absolute-posix-path', { workspaceId: '/Users/alice/project' }],
  ['workspace-absolute-windows-path', { workspaceId: 'C:\\Users\\alice\\project' }],
  ['workspace-dot', { workspaceId: '.' }],
  ['workspace-dotdot', { workspaceId: '..' }],
  ['session-dotdot', { sessionId: '..' }],
  ['session-with-slash', { sessionId: 'a/b' }],
  ['tenant-128-bytes', { tenantId: 't'.repeat(128) }],
  ['tenant-129-bytes', { tenantId: 't'.repeat(129) }],
  ['tenant-512-bytes', { tenantId: 't'.repeat(512) }],
  ['session-c1-control', { sessionId: 'a\u0085b' }],
  ['workspace-not-nfc', { workspaceId: 'cafe\u0301' }],
];
const esc = (s: string) => [...s].map((c) => { const n = c.codePointAt(0)!; return n < 0x20 || (n >= 0x7f && n <= 0x9f) || c === '\\' || n > 0x7e ? (n > 0xffff ? c : `\\u${n.toString(16).padStart(4, '0')}`) : c; }).join('');
const tsv = cases.map(([id, o]) => { const e = { ...base, ...o }; return [id, esc(e.tenantId), esc(e.workspaceId), esc(e.sessionId)].join('\t'); }).join('\n');
const out = process.argv[2];
fs.writeFileSync(`${out}/id-cases.tsv`, tsv + '\n');
const java = spawnSync('/Users/wenshao/Install/jdk21/bin/java', ['-cp', `${out}/../jar/BOOT-INF/classes:${out}/../jar/BOOT-INF/lib/*:${out}/..`, 'IdRules', `${out}/id-cases.tsv`], { encoding: 'utf8' });
if (java.status !== 0) throw new Error(java.stderr);
const jv = new Map(java.stdout.trim().split('\n').map((l) => l.split('\t') as [string, string]));
const rows = cases.map(([id, o]) => { let env: string; try { parseManagedEventEnvelope({ ...base, ...o }); env = 'accept'; } catch (e) { env = `refuse: ${(e as Error).message}`; } return { id, envelope: env, javaSessionStore: jv.get(id) }; });
console.log(JSON.stringify(rows, null, 1));
