import { pathToFileURL } from 'node:url'; import path from 'node:path';
import { getEncoding } from '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/cdedebfd-d7b0-43c5-90a2-e78dac0bc8ab/scratchpad/tok/node_modules/js-tiktoken/dist/index.js';
const T = (s) => getEncoding('o200k_base').encode(s).length;
delete process.env.SANDBOX;
const res = {};
for (const a of ['main', 'merged']) {
  const p = await import(pathToFileURL(`/Users/wenshao/git/v12546/${a}/packages/core/dist/src/core/prompts.js`).href);
  const G = (model, mode, style, todo) => p.getCoreSystemPrompt(undefined, model, undefined, mode, style, todo, false);
  const sl = (s, h) => { const i = s.indexOf(h); const j = s.indexOf('\n#', i + h.length); return s.slice(i, j); };
  for (const model of ['qwen3.8-max', 'qwen3-coder-plus']) for (const mode of ['interactive', 'headless']) for (const todo of [false, true]) {
    const s = G(model, mode, undefined, todo); const k = `${model}/${mode}/todo${+todo}`;
    res[k] ??= {}; res[k][a] = ['## Using Your Tools', '## Software Engineering Tasks', '# Tone and Style', '## Communicating With the User', '## Tone and Style'].map((h) => s.includes(h) ? sl(s, h).length : '-').join(' ');
  }
  const st = (keep) => ({ name: 'x', source: 'builtin', description: 'x', keepCodingInstructions: keep, prompt: 'x' });
  const on = G('qwen3.8-max', 'interactive', st(true), false), off = G('qwen3.8-max', 'interactive', st(false), false);
  res[`keepCoding=false deletes (${a})`] = `${on.length - off.length} chars, ${T(on) - T(off)} o200k tokens`;
}
console.log(JSON.stringify(res, null, 1));
