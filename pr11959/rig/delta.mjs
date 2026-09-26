// Prints tokenLimit / hasExplicitOutputLimit / defaultModalities for every
// bundled catalog id under the current QWEN_CODE_MODELS_DEV setting.
const core = '/Users/wenshao/git/qwen-11959/packages/core/dist/src';
const { tokenLimit, hasExplicitOutputLimit } = await import(core + '/core/tokenLimits.js');
const { defaultModalities } = await import(core + '/core/modalityDefaults.js');
const fs = await import('node:fs');
const ids = Object.keys(JSON.parse(fs.readFileSync('/Users/wenshao/git/qwen-11959/packages/core/src/models/generated/model-registry.json', 'utf8')).models);
const out = {};
for (const id of ids) out[id] = { ctx: tokenLimit(id, 'input'), out: tokenLimit(id, 'output'), explicit: hasExplicitOutputLimit(id), mod: defaultModalities(id) };
console.log(JSON.stringify(out));
