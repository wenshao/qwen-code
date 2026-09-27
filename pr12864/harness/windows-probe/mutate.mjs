// Applies one arm's edit and fails if its anchor is gone.
import { readFileSync, writeFileSync } from 'node:fs';

const edit = (file, from, to) => {
  const source = readFileSync(file, 'utf8');
  if (!source.includes(from)) {
    console.error(`anchor missing in ${file}: ${from}`);
    process.exit(1);
  }
  writeFileSync(file, source.replace(from, to));
};
const suite = 'integration-tests/cli/hosted-harness-process.test.ts';
const envCase = `it("keeps the caller's HOME, QWEN_HOME and environment out of the child", `;
switch (process.argv[2]) {
  case 'skip-on-win32':
    // A case that skips itself on Windows only, through an options object.
    edit(suite, envCase, `${envCase}{ skip: process.platform === 'win32' }, `);
    break;
  case 'name-filter':
    // A name filter that matches nothing: vitest itself exits 0.
    edit(
      'integration-tests/vitest.hosted.config.ts',
      'retry: 0,',
      "retry: 0,\n    testNamePattern: 'no such Hosted case',",
    );
    break;
  default:
    console.error(`unknown arm ${process.argv[2]}`);
    process.exit(1);
}
