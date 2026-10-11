const base = '/Users/wenshao/git/pr13858-fix/packages/core/dist/src/agents/runtime/';
const { scanWorkflowScriptShape } = await import(base + 'workflow-script-shape.js');
const { compileWorkflowScript } = await import(base + 'workflow-sandbox.js');
const cases = {
  direct: "return await workflow('host-report');",
  alias: "const w = workflow; return await w('host-report');",
  comma: "return await (0, workflow)('host-report');",
  paren: "return await (workflow)('host-report');",
  globalThis: "return await globalThis.workflow('host-report');",
  call: "return await workflow.call(null, 'host-report');",
  apply: "return await Reflect.apply(workflow, null, ['host-report']);",
  array: "return await [workflow][0]('host-report');",
  bracket: "return await globalThis['work' + 'flow']('host-report');",
};
for (const [k, src] of Object.entries(cases)) {
  let compiles = 'ok';
  try { compileWorkflowScript(src); } catch (e) { compiles = 'ERR ' + String(e).slice(0, 60); }
  const s = scanWorkflowScriptShape(src);
  console.log(`${k.padEnd(11)} compile=${compiles.padEnd(4)} nestedWorkflowCalls=${JSON.stringify(s.nestedWorkflowCalls).padEnd(4)} determinism=${s.determinismViolations.length}  -> ${s.nestedWorkflowCalls.length || s.determinismViolations.length ? 'REFUSED at admission' : 'ADMITTED'}`);
}
