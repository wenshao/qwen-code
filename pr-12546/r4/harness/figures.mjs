// node figures.mjs <armDir>  -> JSON of every figure the PR's docs assert, measured on this arm's built core
import { pathToFileURL } from 'node:url'; import path from 'node:path';
import { getEncoding } from '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/cdedebfd-d7b0-43c5-90a2-e78dac0bc8ab/scratchpad/tok/node_modules/js-tiktoken/dist/index.js';
const enc = getEncoding('o200k_base'); const T = (s) => enc.encode(s).length;
delete process.env.SANDBOX; delete process.env.QWEN_SYSTEM_MD;
const arm = process.argv[2];
const p = await import(pathToFileURL(path.join(arm, 'packages/core/dist/src/core/prompts.js')).href);
const G = (o = {}) => p.getCoreSystemPrompt(undefined, o.model ?? 'qwen3.8-max', undefined, o.mode ?? 'interactive', o.style, o.todo ?? false, o.cm ?? false, o.surface);
const slice = (s, h) => { const i = s.indexOf(h); if (i < 0) return null; const j = s.indexOf('\n#', i + h.length); return s.slice(i, j < 0 ? undefined : j + 1); };
const out = {};
const noGit = G(); // non-git cwd? (git section depends on cwd) — record both via isGitRepository on process.cwd
out.cwdIsGit = noGit.includes('# Git Repository');
out.variants = {
  'general (interactive)': T(G()), 'general (headless)': T(G({ mode: 'headless' })), 'general + todo': T(G({ todo: true })),
  'qwen-coder + todo': T(G({ model: 'qwen3-coder-plus', todo: true })), 'CodeModeOnly + todo': T(G({ todo: true, cm: true })),
};
out.chars = G().length; out.bytes = Buffer.byteLength(G());
const base = G();
out.seSlice = slice(base, '## Software Engineering Tasks')?.length;
out.usingToolsSlice = slice(base, '## Using Your Tools')?.length;
const noCode = G({ style: { name: 'x', source: 'builtin', description: 'x', keepCodingInstructions: false, prompt: '' } });
out.keepCodingFalseDeletes = base.length - noCode.length;
out.keepCodingFalseDeletesTokens = T(base) - T(noCode);
out.reportOutcomesInNoCode = noCode.includes('Report outcomes faithfully');
const FILE7 = ['read_file','write_file','edit','glob','grep_search','run_shell_command','skill'];
const EX = ['ask_user_question','tool_search','tool_call','exit_plan_mode','enter_plan_mode'];
const all = new Set([...FILE7, ...EX, 'agent','monitor','todo_write','web_fetch','list_directory','save_memory','lsp','cron_create']);
const file7 = new Set([...FILE7, ...EX]);
for (const todo of [false, true]) {
  const nosnap = G({ todo }), f7 = G({ todo, surface: { declaredTools: file7 } });
  const noMon = new Set([...all].filter((t) => t !== 'monitor')); if (todo) noMon.add('todo_write');
  const a = G({ todo, surface: { declaredTools: noMon } });
  out[`gate.todo${+todo}`] = { nosnapMinusFile7: [nosnap.length - f7.length, Buffer.byteLength(nosnap) - Buffer.byteLength(f7)], noMonitorMinusFile7: [a.length - f7.length, Buffer.byteLength(a) - Buffer.byteLength(f7)] };
}
console.log(JSON.stringify(out, null, 1));
