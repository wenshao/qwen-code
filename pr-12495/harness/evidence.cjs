const { chromium } = require('playwright-core');
const fs = require('fs');
const R = JSON.parse(fs.readFileSync('fuzz-report.json','utf8'));
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
const g = s => `<span style="color:#3fb950">${esc(s)}</span>`, r = s => `<span style="color:#f85149">${esc(s)}</span>`, d = s => `<span style="color:#8b949e">${esc(s)}</span>`, b = s => `<b style="color:#e6edf3">${esc(s)}</b>`;
const lines = [
 b('1. PR tests, head 113636f'), '  shellReadOnlyChecker + shellAstParser   ' + g('787 passed (787)'),
 b('2. Negative control: PR tests against base shell-safety-rules.ts'), '  ' + r('5 failed') + ' | 782 passed  ' + d('(--quiet/--silent read-only ×3, --quiet/--silent "w out" = write ×2)'),
 '', b('3. Two-arm differential + real GNU sed 4.9 ground truth'),
 `  ${R.vectors} unique argv vectors · real sed executed in a fresh dir for ${R.ranRealSed} of them`,
 ...Object.entries(R.transitions).map(([k,v]) => '  ' + k.padEnd(24) + String(v).padStart(6) + (k.split('->')[0]!==k.split('->')[1] ? '   ' + g('← changed') : '')),
 `  every changed vector contains a literal --quiet or --silent token: ${g('yes')}`,
 `  "read-only" verdict but real sed created/modified a file:  base ${g(R.violations.base)} · head ${g(R.violations.head)}`,
 `  --quiet / --silent output byte-identical to -n (${R.aliasChecked} scripts): ${g(R.aliasIdenticalToN)}`,
 '', b('4. Mutants of shell-safety-rules.ts vs the PR tests'),
 ...fs.readFileSync('mutants.txt','utf8').trim().split('\n').map(l => { const [n,t]=l.split(' | '); return '  ' + n.padEnd(28) + (/failed/.test(t) ? g('killed ') : r('survived')) + '  ' + d(t.trim()); }),
 '  ' + d('M3/M7 are killed by the 2 extra write-table rows suggested in the report (789 tests, 2 failed each).'),
 '', b('5. Gates on head'), '  eslint --max-warnings 0 (3 files) ' + g('0') + ' · prettier --check ' + g('clean') + ' · core tsc --noEmit ' + g('0'),
 '  full packages/core: 29898 passed · 3 failed ' + d('(same 3 on base; root-uid artefacts)'),
];
(async()=>{const br=await chromium.launch({executablePath:process.env.HOME+'/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'});
const p=await br.newPage({viewport:{width:1400,height:1400},deviceScaleFactor:2});
await p.setContent(`<body style="margin:0;background:#0d1117"><div class="w" style="display:inline-block;padding:18px 22px;font:13.5px/1.55 ui-monospace,DejaVu Sans Mono,monospace;color:#c9d1d9;white-space:pre"><div style="font:600 16px sans-serif;color:#e6edf3;margin-bottom:10px">PR #12495 — verification evidence summary</div>${lines.join('\n')}</div></body>`);
const el=await p.$('.w');await el.screenshot({path:'img/fig4-evidence.png'});await br.close();console.log('ok')})();
