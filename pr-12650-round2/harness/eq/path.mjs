process.argv = ['node', 'scripts/lint.js', '--test-import'];
const out = {};
for (const arm of ['prev', 'pr']) {
  const m = await import(`./${arm}/lint.mjs`);
  out[arm] = ['linux', 'darwin', 'win32'].map((platform) => m.getLinterPath({ platform }));
  out[arm].push(m.getLinterPath());
}
console.log(JSON.stringify(out.prev) === JSON.stringify(out.pr) ? 'getLinterPath identical prev vs pr (linux/darwin/win32/no-arg)' : 'DIFF', '\n' + out.pr[3]);
