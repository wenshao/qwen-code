#!/usr/bin/env node
// wirefig.mjs — ANSI A/B summary built from the headless run outputs and server-side logs.
import fs from 'node:fs';
const O = '/root/git/pr11443-e2e/out';
const G = '\x1b[32m', RD = '\x1b[31m', Y = '\x1b[33m', B = '\x1b[1m', D = '\x1b[2m', N = '\x1b[0m';
const out = [];
const row = (s = '') => out.push(s);
const col = (t) => (t === 'pr' ? `${G}PR  ${N}` : `${RD}base${N}`);
const pad = (s, n) => { const v = s.replace(/\x1b\[[0-9;]*m/g, ''); return s + ' '.repeat(Math.max(0, n - v.length)); };

function steps(file) {
  const res = JSON.parse(fs.readFileSync(`${O}/${file}`, 'utf8')).find((m) => m.type === 'result').result;
  const map = {};
  const parts = res.split(/^\[(\d+)\] (\S+): /m);
  for (let i = 1; i < parts.length; i += 3) {
    const body = parts[i + 2]
      .replace(/```typescript|```/g, '')
      .replace(/\s*(Incoming calls|Outgoing calls|Call hierarchy items) \(JSON\):[\s\S]*$/, '')
      .replace(/(Hover|Definitions) for src\/[\w.]+:[\d:]+:/g, '')
      .replace(/\[\/root\/git\/pr11443-e2e\/rig\/[\w.-]+\]/g, '')
      .replace(/No hover information found for src\/[\w.]+:[\d:]+\./, 'No hover information found')
      .replace(/, open '.*'/, '')
      .replace(/No (definitions|diagnostics) found for src\/[\w.]+(:[\d:]+)?\./, 'No $1 found')
      .replace('No diagnostics found in the workspace.', 'No diagnostics found (clean)')
      .replace(/Workspace diagnostics \((\d+ issues in \d+ files)\):/, '$1')
      .replace(/Incoming calls for \w+ at src\/[\w.]+:[\d:]+ ?:/, '')
      .replace(/Call hierarchy items for src\/[\w.]+:[\d:]+:/, '')
      .replace(/ \(Function\) - src\/calls\.ts:/g, ' ')
      .replace(/LSP incoming calls failed: Call hierarchy item is stale or has unknown provenance;.*/s, 'REJECTED: stale item, prepare again')
      .replace(/No incoming calls found for (\w+) at src\/[\w.]+:([\d:]+) ?\./, 'No incoming calls for $1 $2')
      .replace(/\s+/g, ' ')
      .trim();
    map[parts[i]] = body;
  }
  return map;
}
const jsonl = (f) => fs.readFileSync(`${O}/${f}`, 'utf8').trim().split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));

row(`${B}S1 · real CLI + real typescript-language-server 6.0.0 (textDocumentSync: 2) · one session · separate-process disk edits${N}`);
const s1 = { base: steps('s1-base.json'), pr: steps('s1-pr.json') };
const S1 = [
  ['1', 'hover, initial file'],
  ['3', 'hover after same-size, same-ms mtime rewrite number→string'],
  ['4', 'hover again, no edit'],
  ['6', 'goToDefinition after moving the declaration to line 3'],
  ['9', 'hover after CRLF rewrite to boolean'],
  ['11', 'diagnostics on the deleted opened file'],
  ['12', 'hover on the deleted file'],
  ['14', 'hover after the file is recreated (number)'],
];
for (const [k, label] of S1) {
  const ok = s1.base[k] === s1.pr[k];
  row(`  ${pad(`[${k}] ${label}`, 58)} ${RD}base${N} ${pad(s1.base[k].slice(0, 30), 31)} ${ok ? D : G}PR${N} ${s1.pr[k].slice(0, 44)}`);
}
row();
row(`${B}S1 · what the language server received (client→server, via stdio tee)${N}`);
const wire = (t) =>
  jsonl(`s1-${t}.wire.jsonl`)
    .filter((r) => r.dir === 'c2s' && /didOpen|didChange|didClose|hover|definition|diagnostic/.test(r.method ?? ''))
    .map((r) => {
      const m = r.method.replace('textDocument/', '');
      if (m === 'didOpen') return `${Y}open v${r.version}${N}`;
      if (m === 'didChange') { const g = r.changes[0].range; return `${Y}change v${r.version}[${g.start.line}:${g.start.character}-${g.end.line}:${g.end.character}]${N}`; }
      if (m === 'didClose') return `${Y}close${N}`;
      return m;
    })
    .join(' ');
for (const t of ['base', 'pr']) row(`  ${col(t)} ${wire(t)}`);
row();
row(`${B}S2 · fake server that answers hover from ITS OWN copy of the document · hover after edit1, again, after edit2, again${N}`);
for (const c of ['incr', 'full', 'openclose-nochange', 'absent']) {
  for (const t of ['base', 'pr']) {
    const s = steps(`s2-${t}-${c}.json`);
    const v = ['3', '4', '6', '7'].map((k) => s[k].replace('server-copy ', '').replace('v-: (never opened; disk says) alpha', 'not opened; server read disk:').replace('No hover information found', `${RD}NO HOVER${N}`));
    row(`  ${pad(t === 'base' ? `sync=${c}` : '', 22)} ${col(t)} ${v.join(' │ ')}`);
  }
}
row();
row(`${B}S3/S5 · LSP server crashes and is restarted · workspaceDiagnostics against the NEW process${N}`);
for (const s of ['s3', 's5']) {
  for (const t of ['base', 'pr']) {
    const known = jsonl(`${s}-${t}.fake.jsonl`).filter((r) => r.m === 'workspaceDiagnostic').map((r) => `[${r.knownDocs.join(',') || 'no docs'}]`);
    const st = steps(`${s}-${t}.json`);
    const res = Object.entries(st).filter(([, v]) => /issues in \d+ files|No diagnostics found \(clean\)|workspace diagnostics failed/.test(v)).map(([, v]) => v.replace(/illegal operation on a directory, read/, '').replace(/src\/.*$/, '').trim());
    row(`  ${pad(t === 'base' ? (s === 's3' ? 'S3 crash' : 'S5 crash+EISDIR') : '', 16)} ${col(t)} server holds ${pad(known.join(' then '), 30)} → ${res.join('  then  ')}`);
  }
}
row();
row(`${B}S6 · .lsp.json reload while b.txt is pending-only (crash, then hover a) · what the RELOADED process received${N}`);
for (const t of ['base', 'pr']) {
  const recs = jsonl(`s6-${t}.fake.jsonl`);
  const last = recs.filter((r) => r.m === 'workspaceDiagnostic').pop().pid;
  const opens = recs.filter((r) => r.pid === last && r.m === 'didOpen').map((r) => `${r.uri.split('/').pop()}="${r.text.trim()}"`);
  row(`  ${col(t)} didOpen ${pad(opens.join(' '), 44)} → ${steps(`s6-${t}.json`)['6'].replace(/ src\/.*$/, '')}`);
}
row();
row(`${B}S7 · call hierarchy, real tsserver · after prepending 2 lines: reuse old item │ prepare at line 3 │ incomingCalls on it${N}`);
for (const t of ['base', 'pr']) {
  const st = steps(`s7-${t}.json`);
  row(`  ${col(t)} ${['4', '5', '6'].map((k) => st[k].replace(/^1\. /, '')).join(' │ ')}`);
}
process.stdout.write(out.join('\n') + '\n');
