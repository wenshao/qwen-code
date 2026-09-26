// Reproduces docs/verification/resident-tool-prompt-assembly/README.md §1/§2 numbers on each arm.
import { pathToFileURL } from 'node:url';
const seven = ['read_file','write_file','edit','glob','grep_search','run_shell_command','skill','ask_user_question'];
const allButMonitor = [...seven, 'agent', 'todo_write', 'list_directory', 'web_fetch', 'tool_search'];
for (const arm of ['base', 'head']) {
  delete process.env.SANDBOX;
  const p = await import(pathToFileURL(`/Users/wenshao/git/v12784/${arm}/packages/core/dist/src/core/prompts.js`).href + `?${arm}`);
  const R = (todo, s) => p.getCoreSystemPrompt(undefined, 'qwen3.8-max', undefined, 'interactive', undefined, todo, false, s ? { declaredTools: new Set(s) } : undefined);
  const d = (a, b) => `${a.length - b.length} chars / ${Buffer.byteLength(a) - Buffer.byteLength(b)} bytes`;
  const tm = R(true).split('\n').find((l) => l.startsWith('- **Task Management:**'));
  console.log(arm, '| Task Management line:', tm.length, 'chars',
    '| todo off: no-snapshot→seven', d(R(false), R(false, seven)), '; no-monitor→seven', d(R(false, allButMonitor.filter(t=>t!=='todo_write')), R(false, seven)),
    '| todo on: no-snapshot→seven', d(R(true), R(true, seven)), '; no-monitor→seven', d(R(true, allButMonitor), R(true, seven)));
}
