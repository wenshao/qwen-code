#!/usr/bin/env node
// Before/after table for the key task_cancel discriminating instances.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/root/git/qwen-code-pr12998/package.json');
const Ajv2020 = require('ajv/dist/2020').default;

const BASE = JSON.parse(readFileSync('/tmp/spec-main.json', 'utf8'));
const UPDATED = JSON.parse(readFileSync(
  '/root/git/qwen-code-pr12998/packages/sdk-java/managed-agent-server/src/main/resources/openapi/managed-agent-public-api.openapi.json', 'utf8'));

const SESSION = '6f1c7d7e-3a4b-4c2d-9e8f-0123456789ab';
const cancel = (status, extra = {}) => ({
  id: 'operation-1', session_id: SESSION, type: 'task_cancel', task_id: 'task-1',
  status, admission_stage: 'java_durable', delivery_state: 'pending', replayed: false, ...extra,
});
const compile = (spec, name) => {
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  ajv.addSchema(spec, 'spec.json');
  return ajv.compile({ $ref: `spec.json#/components/schemas/${name}` });
};

const rows = [
  ['task_cancel status=cancelled', cancel('cancelled')],
  ['task_cancel failed, no failure_code', cancel('failed', { delivery_state: 'blocked' })],
  ['task_cancel recovery_blocked, delivery still pending', cancel('recovery_blocked')],
  ['task_cancel completed without harness_confirmed admission', cancel('completed', { delivery_state: 'confirmed', receipt_id: 'receipt-1' })],
  ['task_cancel completed, confirmed, with receipt', cancel('completed', { admission_stage: 'harness_confirmed', delivery_state: 'confirmed', receipt_id: 'receipt-1' })],
  ['task_cancel failed + failure_code + blocked', cancel('failed', { delivery_state: 'blocked', failure_code: 'task_action_unavailable' })],
  ['task_cancel pending (in flight)', cancel('pending')],
];
const mark = (b) => (b ? 'ACCEPT' : 'REJECT');
for (const schema of ['PublicCommandOperation', 'PublicOperation']) {
  const vb = compile(BASE, schema);
  const vu = compile(UPDATED, schema);
  console.log(`# ${schema}   (contract ${BASE.info.version} -> ${UPDATED.info.version})`);
  for (const [label, inst] of rows) {
    const b = vb(structuredClone(inst));
    const u = vu(structuredClone(inst));
    const tag = b === u ? '      ' : (u ? 'RELAX ' : 'TIGHTEN');
    console.log(`${tag}  ${mark(b)} -> ${mark(u)}   ${label}`);
  }
  console.log('');
}
