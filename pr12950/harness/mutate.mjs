// PR #12950 mutation run: apply one mutant at a time to the PR's
// hosted-workspace-tool-turn.ts, run the PR's unit test file, restore.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WT = process.argv[2];
const OUT = process.argv[3];
const FILE = path.join(WT, 'packages/cli/src/serve/hosted-workspace-tool-turn.ts');
const TEST = 'src/serve/hosted-workspace-tool-turn.test.ts';
const ORIGINAL = fs.readFileSync(FILE, 'utf8');
const NODE_BIN = '~/.local/share/fnm/node-versions/v22.23.2/installation/bin';

const MUTANTS = [
  ['M0-baseline', null, null],
  ['M1 non-string file_path throws again', "        if (typeof file !== 'string') {\n          validationError = filePathError;", "        if (typeof file !== 'string') {\n          throw new Error('Hosted file tools require a relative file_path.');"],
  ['M2 validator error rethrown (pre-PR behaviour)', '            if (!(cause instanceof InvalidWorkspaceRelativePathError))\n              throw cause;\n            validationError = filePathError;', '            throw cause;'],
  ['M3 refusal echoes the model path', '              throw cause;\n            validationError = filePathError;', '              throw cause;\n            validationError = `${filePathError} (${file})`;'],
  ['M4 sibling text still says Shell', 'another call in the batch has invalid arguments', 'another call in the batch has invalid Shell arguments'],
  ['M5 refusal tool_result not committed', "        await this.commit('assistant', parts, model);\n        await this.commit('tool_result', responses, model);\n        this.uncertain = false;", "        await this.commit('assistant', parts, model);\n        this.uncertain = false;"],
  ['M6 instanceof guard removed (convert any error)', '            if (!(cause instanceof InvalidWorkspaceRelativePathError))\n              throw cause;\n', ''],
  ['M7 normalized path not used', "            input['file_path'] = normalizeWorkspaceRelativePath(file.trim());", '            normalizeWorkspaceRelativePath(file.trim());'],
  ['M8 uncertain not cleared after refusal', "        await this.commit('tool_result', responses, model);\n        this.uncertain = false;\n        return responses;", "        await this.commit('tool_result', responses, model);\n        return responses;"],
  ['M9 uncertain not set before refusal commit', "      this.uncertain = true;\n      try {\n        await this.commit('assistant', parts, model);\n        await this.commit('tool_result', responses, model);", "      try {\n        await this.commit('assistant', parts, model);\n        await this.commit('tool_result', responses, model);"],
  ['M10 refuse only when every call is invalid', 'if (requests.some((request) => request.validationError)) {', 'if (requests.every((request) => request.validationError)) {'],
  ['M11 refusal skips assistant commit', "      try {\n        await this.commit('assistant', parts, model);\n        await this.commit('tool_result', responses, model);", "      try {\n        await this.commit('tool_result', responses, model);"],
];

const rows = [];
try {
  for (const [name, from, to] of MUTANTS) {
    let src = ORIGINAL;
    if (from !== null) {
      const n = ORIGINAL.split(from).length - 1;
      if (n !== 1) {
        rows.push({ name, result: `ANCHOR x${n}` });
        console.log(name, `ANCHOR x${n}`);
        continue;
      }
      src = ORIGINAL.replace(from, to);
    }
    fs.writeFileSync(FILE, src);
    const json = path.join(OUT, `vitest-${name.split(' ')[0]}.json`);
    let rc = 0;
    try {
      execFileSync(`${NODE_BIN}/npx`, ['vitest', 'run', TEST, '--reporter=json', `--outputFile=${json}`], {
        cwd: path.join(WT, 'packages/cli'),
        env: { ...process.env, PATH: `${NODE_BIN}:${process.env.PATH}`, CI: '1' },
        stdio: 'ignore',
        timeout: 300_000,
      });
    } catch (e) {
      rc = e.status ?? -1;
    }
    let summary = 'no-json';
    let failedNames = [];
    if (fs.existsSync(json)) {
      const r = JSON.parse(fs.readFileSync(json, 'utf8'));
      summary = `${r.numPassedTests} passed / ${r.numFailedTests} failed / ${r.numTotalTests} total`;
      failedNames = r.testResults.flatMap((f) => f.assertionResults.filter((a) => a.status === 'failed').map((a) => a.title));
    }
    const verdict = from === null ? (rc === 0 ? 'BASELINE OK' : 'BASELINE BROKEN') : rc === 0 ? 'SURVIVED' : 'KILLED';
    rows.push({ name, rc, verdict, summary, failedNames });
    console.log(`${verdict.padEnd(15)} ${name} :: ${summary} :: ${failedNames.slice(0, 3).join(' | ')}`);
  }
} finally {
  fs.writeFileSync(FILE, ORIGINAL);
}
fs.writeFileSync(path.join(OUT, 'mutants.json'), JSON.stringify(rows, null, 2));
