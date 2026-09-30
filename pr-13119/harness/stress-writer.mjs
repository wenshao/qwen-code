// Real writer from the arm's compiled CLI: the same updateSettingsFilePreservingFormat
// -> writeWithBackupSync path saveSettings() uses, saving the full scope each time.
const [arm, id, iters, target] = process.argv.slice(2);
const { updateSettingsFilePreservingFormat } = await import(`/root/verify/pr13119/${arm}/packages/cli/dist/src/utils/jsonc-editor.js`);
const policy = { backend: 'auto', filesystem: 'workspace-write', network: 'closed' };
let ok = 0, refused = 0; const errors = {};
for (let i = 0; i < Number(iters); i++) {
  try {
    const written = updateSettingsFilePreservingFormat(target, {
      $version: 4, tools: { executionSandbox: policy }, ui: { theme: 'GitHub' }, general: { language: `${id}-${i}` },
    });
    written ? ok++ : refused++;
  } catch (e) {
    const key = String(e.message).replace(/'[^']*'/g, "'…'").slice(0, 90);
    errors[key] = (errors[key] || 0) + 1;
  }
}
console.log(JSON.stringify({ writer: id, ok, refused, errors }));
