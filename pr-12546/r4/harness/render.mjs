// usage: node render.mjs <armDir> <outDir>
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
const [arm, out] = process.argv.slice(2);
delete process.env.SANDBOX; delete process.env.QWEN_SYSTEM_MD;
const p = await import(pathToFileURL(path.join(arm, 'packages/core/dist/src/core/prompts.js')).href);
fs.mkdirSync(out, { recursive: true });
const models = { general: 'qwen3.8-max', coder: 'qwen3-coder-plus', vl: 'qwen3-vl-plus', gemma4: 'gemma-4-27b' };
const surfaces = {
  full: undefined,
  headlessDefault: new Set(['read_file','grep_search','glob','list_directory','web_fetch','todo_write','agent','skill','tool_search','tool_call']),
  noShell: new Set(['read_file','edit','write_file','grep_search','glob','agent','todo_write']),
  shellOnly: new Set(['run_shell_command']),
};
for (const [mk, m] of Object.entries(models))
  for (const mode of ['interactive','headless','acp'])
    for (const todo of [false, true])
      for (const cm of [false, true])
        for (const [sk, s] of Object.entries(surfaces)) {
          const txt = p.getCoreSystemPrompt(undefined, m, undefined, mode, undefined, todo, cm, s ? { declaredTools: s } : undefined);
          fs.writeFileSync(path.join(out, `${mk}.${mode}.todo${+todo}.cm${+cm}.${sk}.md`), txt);
        }
console.log('rendered', fs.readdirSync(out).length);
