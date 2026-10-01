process.argv = ['node', 'scripts/lint.js', '--test-import'];
const which = process.argv0 && process.env.ARM;
const { getLinters } = await import(`./${which}/lint.mjs`);
const l = getLinters();
for (const k of ['shellcheck', 'yamllint']) {
  process.stdout.write(`### ${k}.run\n${l[k].run}\n### ${k}.check\n${l[k].check}\n### ${k}.installer\n${l[k].installer}\n`);
}
process.stdout.write(`### actionlint.run\n${l.actionlint.run}\n`);
