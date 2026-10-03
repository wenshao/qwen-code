import fs from 'node:fs';
const S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/4bc58a7c-2b06-4022-98dd-e3f296888d77/scratchpad';
const strip = (t) => t.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').split(`${S}/`).join('$SCRATCH/');
const wrap = (l, w = 116) => { const out = []; let s = l; while (s.length > w) { let i = s.lastIndexOf(' ', w); if (i < 40) i = w; out.push(s.slice(0, i)); s = '    ' + s.slice(i).trimStart(); } out.push(s); return out; };
const joined = (n, w = 116) => strip(fs.readFileSync(`${S}/shots/wide/${n}.joined.txt`, 'utf8')).split('\n').map((l) => l.trimEnd()).filter(Boolean).flatMap((l) => wrap(l, w));
function frame(n, from, to, boxWidth, cut = 118, dir = 'wide') {
  const ls = strip(fs.readFileSync(`${S}/shots/${dir}/${n}.ansi`, 'utf8')).split('\n').slice(from, to + 1).map((l) => l.trimEnd());
  if (!boxWidth) return ls.map((l) => l.slice(0, cut));
  return ls.map((l) => {
    const m = l.match(/^(\s*)([╭│╰])(.*)$/);
    if (!m) return l;
    if (m[2] === '╭') return `${m[1]}╭${'─'.repeat(boxWidth)}╮`;
    if (m[2] === '╰') return `${m[1]}╰${'─'.repeat(boxWidth)}╯`;
    return `${m[1]}│${m[3].replace(/│\s*$/, '').trimEnd().padEnd(boxWidth)}│`;
  });
}
const tag = (prefix, ls) => ls.map((l) => prefix + l);


const probe = fs.readFileSync(`${S}/r4/winout/probe-out.txt`, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
  .filter((l) => l.startsWith('PROBE_JSON ')).map((l) => JSON.parse(l.slice(11)));
const desc = (r) => {
  if (r.linkedRefusal) return 'exit 52 · "Linked Workspace settings cannot be recovered"';
  if (r.settingsError) return `exit ${r.exit} · settings refusal`;
  if (r.started) return `started (exit ${r.exit} = unreachable fake model)`;
  return `exit ${r.exit}`;
};
const state = (r) => {
  if (r.outside) return `outside ${r.outside.sha === 'c1aece36' ? 'intact' : 'TRUNCATED to {}'}; ws copy ${r.copy.sha === 'absent' ? 'none' : 'holds outside bytes'}`;
  if (r.user) return `User file ${r.user.sha === 'b03ad12b' ? 'unchanged' : 'CHANGED'}`;
  if (r.copy && r.settings) return `settings ${r.settings.sha === 'c1aece36' ? 'kept' : 'reset'}${r.settings.readOnly ? ' (ro)' : ''}; copy ${r.copy.sha === 'c1aece36' ? '= original' : r.copy.sha}`;
  if (r.settings) return `settings loaded`;
  return '';
};
const row = (arm, r) => `${arm === 'head' ? (r.case.startsWith('W2') || r.case.startsWith('W3') || r.case.startsWith('W5') ? '++ ' : '.. ') : (r.case.startsWith('W2') || r.case.startsWith('W3') ? '-- ' : '.. ')}${(r.case.split(' ').slice(0, 1)[0] + ' ' + (r.variant ?? (r.launch ? 'launch ' + r.launch : r.case.split(' ').slice(1).join(' ')))).padEnd(30)}${desc(r).padEnd(58)}${state(r)}`;
const rows = (arm) => probe.filter((r) => r.arm === arm).map((r) => row(arm, r));

export const cards = [
{
  name: 'r4-01-windows-native',
  title: 'Round 4: Workspace recovery on native Windows (bot R3-1 "fix-induced" claim)',
  sub: 'GitHub-hosted windows-2022 (Server 2022 10.0.20348), Node 22.23.3 · npm-installed base a4bf0026 vs head (468cb466 package = 6c02a8f3 product) · run 37090898236 on the wenshao fork',
  cols: '1fr',
  panels: [
    { tone: 'bad', badge: 'BASE', title: 'base a4bf0026', lines: [
      '.. case                          result                                                    files',
      ...rows('base') ] },
    { tone: 'good', badge: 'HEAD', title: 'head (production code of 6c02a8f3)', lines: [
      '.. case                          result                                                    files',
      ...rows('head'),
      '',
      '++ W1: the canonical-path guard matches on real Windows for all five spellings (long path, C:\\Users\\RUNNER~1 8.3, lowercase',
      '++     drive letter, junction cwd, subst drive) — recovery copies the original bytes and resets the file, as on macOS/Linux.',
      '== The claim that the guard "never matches on Windows" came from drive-relative mock paths (/mock/workspace); 6c02a8f3 fixes those fixtures.' ] },
  ],
},
];
