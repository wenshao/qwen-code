#!/usr/bin/env node
// Build a variant of the PR's test file by adding a fixed overshoot to the
// waits inside ONE named test. Scoping is required because `sleep(600)` also
// appears in a neighbouring test of the base file.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , src, dst, mode, stallArg] = process.argv;
const stall = Number(stallArg ?? 0);
const TEST_NAME =
  process.env.TEST_NAME ?? "it('an admitted mutation resets the idle timer'";
const NEXT_TEST =
  process.env.NEXT_TEST ?? "it('a resident-reuse load resets the idle clock'";

let text = readFileSync(src, 'utf8');
const start = text.indexOf(TEST_NAME);
if (start < 0) throw new Error('target test not found');
const end = text.indexOf(NEXT_TEST, start);
if (end < 0) throw new Error('next test not found');

const body = text.slice(start, end);
const sleeps = [...body.matchAll(/await sleep\((\d+)\);/g)];
if (sleeps.length !== 2) {
  throw new Error(`expected 2 waits in the target test, found ${sleeps.length}`);
}

let rewritten = body;
const pick = mode === 'first' ? [0] : mode === 'second' ? [1] : [0, 1];
// Replace from the end so earlier offsets stay valid.
for (const index of [...pick].reverse()) {
  const match = sleeps[index];
  const original = match[0];
  const replacement = `await sleep(${Number(match[1])} + ${stall});`;
  const at = match.index;
  rewritten =
    rewritten.slice(0, at) + replacement + rewritten.slice(at + original.length);
}

writeFileSync(dst, text.slice(0, start) + rewritten + text.slice(end));
console.log(
  `wrote ${dst} mode=${mode} stall=${stall} waits=${sleeps.map((m) => m[1]).join(',')}`,
);
