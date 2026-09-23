import { pathToFileURL } from 'node:url';
for (const arm of ['base','head']) {
  process.chdir(`/root/verify/pr12546-${arm}`);
  const p = await import(pathToFileURL(`/root/verify/pr12546-${arm}/packages/core/dist/src/core/prompts.js`).href);
  const s = new Set(['read_file','write_file','edit','glob','grep_search','run_shell_command','skill','ask_user_question','tool_search']);
  const f = (d) => p.getCoreSystemPrompt(undefined,'gpt-4',undefined,'interactive',undefined,false,false,d?{declaredTools:d}:undefined);
  console.log(arm, 'saved chars =', f().length - f(s).length);
}
