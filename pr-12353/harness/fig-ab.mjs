// Figure 1 transcript: the same daemon command line on base vs head, and what
// the spawned ACP child actually received (from /proc + the child's own V8).
import fs from 'node:fs';
const R = '/root/verify/pr12353-work/runs';
const j = (p) => JSON.parse(fs.readFileSync(`${R}/${p}/report.json`, 'utf8'));
const B = '\x1b[1m', D = '\x1b[2m', X = '\x1b[0m', G = '\x1b[32m', RED = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', M = '\x1b[35m';
const line = (s = '') => process.stdout.write(s + '\n');

line(`${D}# daemon launched identically in every arm (Linux, Node v22.22.2, --memory-budget-mb 1024 → 1 slot):${X}`);
line(`${C}$ node --max-old-space-size=4096 --trace-warnings --require probe.cjs dist/cli.js serve \\${X}`);
line(`${C}    --memory-budget-mb 1024 --child-heap-mode <mode> --workspace P --workspace S${X}  ${D}(+ NODE_OPTIONS=--max-old-space-size=3072)${X}`);
line();
const base = fs.readFileSync('/root/verify/pr12353-work/base-rejects-enforce.txt', 'utf8').trim().split('\n').pop().trim();
line(`${B}base 46f6aeb  --child-heap-mode enforce${X}`);
line(`  ${RED}✗ exit 1${X}  ${base}`);
line();
for (const [arm, mode, label] of [['base', 'observe', 'base 46f6aeb'], ['base', 'admit', 'base 46f6aeb']]) {
  const r = j(`legacy-${arm}-${mode}`);
  line(`${B}${label}  --child-heap-mode ${mode}${X}   ${D}status: enforced=${r.enforced}, modeled ${r.childHeap.maxConcurrentChildren} × ${r.childHeap.perChildCeilingMb} MiB${X}`);
  line(`  ACP child argv heap flags : ${Y}${r.child.heapFlags.join(' ')}${X}`);
  line(`  ACP child V8 heap limit   : ${RED}${B}${r.child.v8HeapSizeLimitMb} MiB${X}   ${D}(${(r.child.v8HeapSizeLimitMb / 816).toFixed(1)}× the 816 MiB a 768 MiB ceiling gives)${X}`);
  line();
}
for (const mode of ['observe', 'admit']) {
  const h = j(`legacy-head-${mode}`), b = j(`legacy-base-${mode}`);
  const same = JSON.stringify(h.child.heapFlags) === JSON.stringify(b.child.heapFlags) && h.child.v8HeapSizeLimitMb === b.child.v8HeapSizeLimitMb && h.enforced === b.enforced;
  line(`${B}head adc5c44  --child-heap-mode ${mode}${X}   ${same ? G + '= base' : RED + '≠ base'}${X}: ${h.child.heapFlags.join(' ')} → ${h.child.v8HeapSizeLimitMb} MiB, enforced=${h.enforced}`);
}
line();
const e = j('lifecycle-head-enforce');
const mem = e.steps.find((s) => s.label === 'status at boot').memory;
line(`${B}head adc5c44  --child-heap-mode enforce${X}   ${D}status: enforced=${mem.enforced}, modeled ${mem.childHeap.maxConcurrentChildren} × ${mem.childHeap.perChildCeilingMb} MiB${X}`);
for (const kind of ['primary', 'secondary', 'dynamic']) {
  const v = e.views[kind];
  line(`  ${kind.padEnd(9)} child pid ${String(v.pid).padEnd(8)} argv heap flags: ${G}${v.cmdlineHeapFlags.join(' ')}${X}   V8 heap limit: ${G}${B}${v.v8HeapSizeLimitMb} MiB${X}   gc exposed: ${v.gcExposed}`);
}
line(`  ${D}reference: node --max-old-space-size=768 -e "v8.getHeapStatistics().heap_size_limit" → 816.00 MiB${X}`);
line(`  ${D}kept: ${e.views.primary.cmdlineOther.join(' ')} · child NODE_OPTIONS: ${e.views.primary.env.NODE_OPTIONS ?? 'unset (production launch scrubs it)'}${X}`);
