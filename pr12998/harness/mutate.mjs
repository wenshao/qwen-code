// Writes one mutated contract per mutant into pr12998/mut/<id>.json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/12fa9b24-1d30-4fad-b831-ba32169a2e71/scratchpad';
const SPEC = `${SP}/wt-pr/packages/sdk-java/managed-agent-server/src/main/resources/openapi/managed-agent-public-api.openapi.json`;
const OUT = `${SP}/pr12998/mut`;
await mkdir(OUT, { recursive: true });
const head = JSON.parse(await readFile(SPEC, 'utf8'));
const S = (spec) => spec.components.schemas;
const condIndex = (schema) => schema.allOf.findIndex((e) => e.if?.properties?.type?.const === 'task_cancel' && e.then?.properties?.status);
const cond = (spec, name) => S(spec)[name].allOf[condIndex(S(spec)[name])];
const BOTH_OPS = ['PublicCommandOperation', 'WebShellCommandOperation'];
const EVENTS = ['PublicTaskEvent', 'WebShellTaskEvent'];
const typeCond = (spec, name, type) => S(spec)[name].allOf.find((e) => e.if?.properties?.type?.const === type);

const mutants = {
  C1_drop_public_conditional: (s) => { S(s).PublicCommandOperation.allOf.splice(condIndex(S(s).PublicCommandOperation), 1); },
  C2_drop_webshell_conditional: (s) => { S(s).WebShellCommandOperation.allOf.splice(condIndex(S(s).WebShellCommandOperation), 1); },
  C3_allow_cancelled: (s) => { for (const n of BOTH_OPS) delete cond(s, n).then.properties; },
  C4_failed_needs_no_code: (s) => { for (const n of BOTH_OPS) delete cond(s, n).then.allOf; },
  C5_swap_code_casing: (s) => {
    cond(s, 'PublicCommandOperation').then.allOf[0].then.required = ['failureCode'];
    cond(s, 'WebShellCommandOperation').then.allOf[0].then.required = ['failure_code'];
  },
  C6_rule_for_every_type: (s) => { for (const n of BOTH_OPS) { const c = cond(s, n); delete c.if; Object.assign(c, c.then); delete c.then; } },
  C7_unplan_conditional: (s) => { for (const n of BOTH_OPS) delete cond(s, n)['x-qwen-implementation-status']; },
  B1_refs_max_50: (s) => { S(s).PublicTask.properties.artifact_refs.maxItems = 50; S(s).WebShellTask.properties.artifactRefs.maxItems = 50; },
  B1c_refs_max_101: (s) => { S(s).PublicTask.properties.artifact_refs.maxItems = 101; S(s).WebShellTask.properties.artifactRefs.maxItems = 101; },
  B2_forbid_runtime_state_on_state_changed: (s) => {
    typeCond(s, 'PublicTaskEvent', 'state_changed').then.not.anyOf.push({ required: ['runtime_state'] });
    typeCond(s, 'WebShellTaskEvent', 'state_changed').then.not.anyOf.push({ required: ['runtimeState'] });
  },
  B3_output_artifact_id_conjunction: (s) => {
    for (const [n, f, g] of [['PublicTaskEvent', 'artifact_id', 'state'], ['WebShellTaskEvent', 'artifactId', 'state']]) {
      const any = typeCond(s, n, 'output').then.not.anyOf;
      any.splice(any.findIndex((e) => e.required.length === 1 && e.required[0] === f), 1, { required: [f, g] });
    }
  },
  B3c_output_artifact_id_removed: (s) => {
    for (const [n, f] of [['PublicTaskEvent', 'artifact_id'], ['WebShellTaskEvent', 'artifactId']]) {
      const any = typeCond(s, n, 'output').then.not.anyOf;
      any.splice(any.findIndex((e) => e.required.length === 1 && e.required[0] === f), 1);
    }
  },
  E1_null_next_cursor: (s) => { S(s).PublicTaskEventList.properties.next_cursor.type = ['string', 'null']; S(s).WebShellTaskEventPage.properties.nextCursor.type = ['string', 'null']; },
  E2_optional_next_cursor: (s) => {
    S(s).PublicTaskEventList.required = S(s).PublicTaskEventList.required.filter((f) => f !== 'next_cursor');
    S(s).WebShellTaskEventPage.required = S(s).WebShellTaskEventPage.required.filter((f) => f !== 'nextCursor');
  },
  E3_open_event_object: (s) => { for (const n of EVENTS) S(s)[n].additionalProperties = true; },
};

const index = {};
for (const [id, apply] of Object.entries(mutants)) {
  const spec = structuredClone(head);
  apply(spec);
  const text = JSON.stringify(spec, null, 2) + '\n';
  if (text === JSON.stringify(head, null, 2) + '\n') throw new Error(`${id} is a no-op`);
  await writeFile(`${OUT}/${id}.json`, text);
  index[id] = true;
}
console.log(Object.keys(index).join('\n'));
