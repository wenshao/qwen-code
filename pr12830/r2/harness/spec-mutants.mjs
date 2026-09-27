// Writes one mutated spec per mutant: node spec-mutants.mjs <spec> <outdir>
import { readFileSync, writeFileSync } from 'node:fs';
const [src, dir] = process.argv.slice(2);
const load = () => JSON.parse(readFileSync(src, 'utf8'));
const sc = (s, n) => s.components.schemas[n];
const cond = (s, n, pred) => { const a = sc(s, n).allOf; const i = a.findIndex(pred); if (i < 0) throw new Error(n); return a; };
const typeIs = (t) => (c) => JSON.stringify(c.if?.properties?.type ?? {}).includes(`"${t}"`);
const M = {
  // author's claims (one surface)
  'A1 public: drop all PublicTask/Event/List conditionals + task_cancel rule + text minLength': (s) => {
    delete sc(s, 'PublicTask').allOf; delete sc(s, 'PublicTaskEvent').allOf; delete sc(s, 'PublicTaskList').allOf;
    sc(s, 'PublicCommandOperation').allOf = sc(s, 'PublicCommandOperation').allOf.filter((c) => !JSON.stringify(c.if).includes('task_cancel') || JSON.stringify(c.if).includes('create_session'));
    delete sc(s, 'PublicTaskEvent').properties.text.minLength; },
  'A2 webshell: same on the mirror': (s) => {
    delete sc(s, 'WebShellTask').allOf; delete sc(s, 'WebShellTaskEvent').allOf; delete sc(s, 'WebShellTaskPage').allOf;
    sc(s, 'WebShellCommandOperation').allOf = sc(s, 'WebShellCommandOperation').allOf.filter((c) => !JSON.stringify(c.if).includes('task_cancel') || JSON.stringify(c.if).includes('create_session'));
    delete sc(s, 'WebShellTaskEvent').properties.text.minLength; },
  'A3 state_changed no longer requires state': (s) => { const c = cond(s, 'PublicTaskEvent', typeIs('state_changed')).find(typeIs('state_changed')); delete c.then.required; },
  'A4 start-time rule drops waiting': (s) => { const c = sc(s, 'PublicTask').allOf.find((c) => JSON.stringify(c.if).includes('degraded')); c.if.properties.state.enum = c.if.properties.state.enum.filter((x) => x !== 'waiting'); },
  // design-stated invariants the test may not pin
  'S1 artifact_refs: drop maxItems 100': (s) => { delete sc(s, 'PublicTask').properties.artifact_refs.maxItems; delete sc(s, 'WebShellTask').properties.artifactRefs.maxItems; },
  'S2 artifact_refs: drop uniqueItems': (s) => { delete sc(s, 'PublicTask').properties.artifact_refs.uniqueItems; delete sc(s, 'WebShellTask').properties.artifactRefs.uniqueItems; },
  'S3 PublicTask.object: const agent.task -> any string': (s) => { sc(s, 'PublicTask').properties.object = { type: 'string' }; },
  'S4 TaskState gains paused': (s) => { sc(s, 'TaskState').enum.push('paused'); },
  'S5 TaskKind gains team': (s) => { sc(s, 'TaskKind').enum.push('team'); },
  'S6 TaskActionCapability gains pause': (s) => { sc(s, 'TaskActionCapability').enum.push('pause'); },
  'S7 event text: drop maxLength 16384': (s) => { delete sc(s, 'PublicTaskEvent').properties.text.maxLength; delete sc(s, 'WebShellTaskEvent').properties.text.maxLength; },
  'S8 event list: next_cursor no longer required': (s) => { for (const n of ['PublicTaskEventList', 'WebShellTaskEventPage']) sc(s, n).required = sc(s, n).required.filter((r) => !/next_?[cC]ursor/.test(r)); },
  'S9 artifact event may carry runtime_state': (s) => { for (const n of ['PublicTaskEvent', 'WebShellTaskEvent']) { const c = sc(s, n).allOf.find(typeIs('artifact')); c.then.not.anyOf = c.then.not.anyOf.filter((x) => !/runtime_?[sS]tate/.test(x.required[0])); } },
  'S10 output event may carry artifact_id': (s) => { for (const n of ['PublicTaskEvent', 'WebShellTaskEvent']) { const c = sc(s, n).allOf.find(typeIs('output')); c.then.not.anyOf = c.then.not.anyOf.filter((x) => !/artifact_?[iI]d/.test(x.required[0])); } },
  'S11 state_changed may carry artifact_id': (s) => { for (const n of ['PublicTaskEvent', 'WebShellTaskEvent']) { const c = sc(s, n).allOf.find(typeIs('state_changed')); c.then.not.anyOf = c.then.not.anyOf.filter((x) => !/artifact_?[iI]d/.test(x.required[0])); } },
  'S12 PublicTaskList.object: const list -> any string': (s) => { sc(s, 'PublicTaskList').properties.object = { type: 'string' }; },
  'S13 output_cursor: drop maxLength 512': (s) => { delete sc(s, 'PublicTask').properties.output_cursor.maxLength; delete sc(s, 'WebShellTask').properties.outputCursor.maxLength; },
  'S14 WebShellTaskQueryRequest: drop limit maximum': (s) => { delete sc(s, 'WebShellTaskQueryRequest').properties.limit.maximum; },
  'S15 TaskEventType: drop minLength (empty type ok)': (s) => { delete sc(s, 'TaskEventType').minLength; },
  'S16 task list: drop maxItems 100': (s) => { delete sc(s, 'PublicTaskList').properties.data.maxItems; delete sc(s, 'WebShellTaskPage').properties.data.maxItems; },
  'S17 PublicTask: allow extra properties': (s) => { delete sc(s, 'PublicTask').additionalProperties; },
  'S18 definition_revision: drop minimum 1': (s) => { delete sc(s, 'PublicTask').properties.definition_revision.minimum; delete sc(s, 'WebShellTask').properties.definitionRevision.minimum; },
};
const names = [];
Object.entries(M).forEach(([name, f], i) => { const s = load(); f(s); const file = `${dir}/mut-${String(i).padStart(2, '0')}.json`; writeFileSync(file, JSON.stringify(s)); names.push(`${file}\t${name}`); });
writeFileSync(`${dir}/index.tsv`, names.join('\n') + '\n');
console.log(names.length, 'mutants');
