// Pulls one step's run: block out of a workflow, verbatim, by YAML parse.
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';

const [file, job, stepName, out] = process.argv.slice(2);
const wf = parse(readFileSync(file, 'utf8'));
const step = wf.jobs[job].steps.find((s) => s.name === stepName);
if (!step) {
  console.error(`step not found: ${job} / ${stepName}`);
  process.exit(1);
}
if (step.run.includes('${{')) {
  console.error('a GitHub expression is left in the run block');
  process.exit(1);
}
writeFileSync(out, `${step.run}\n`);
console.log(
  `--- ${file} ${job} / ${stepName} (if: ${step.if}; timeout-minutes: ${step['timeout-minutes']})\n${step.run}\n---`,
);
