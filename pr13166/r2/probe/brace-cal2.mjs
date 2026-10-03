import { createRequire } from 'node:module';
const require = createRequire('/Users/wenshao/pr13166-rig/wt/packages/core/package.json');
const { globStream } = require('glob');
const cwd = process.argv[2];
for (const pattern of process.argv.slice(3)) {
  const t0 = performance.now();
  let n = 0;
  for await (const _ of globStream(pattern, { cwd, nocase: true, dot: true, follow: false })) n++;
  console.log(`bytes=${pattern.length} ms=${Math.round(performance.now() - t0)} pattern=${pattern.slice(0, 40)}`);
}
