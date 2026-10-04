import { createRequire } from 'node:module';
const require = createRequire('/Users/wenshao/pr13166-rig/wt/packages/core/package.json');
const { glob } = require('glob');
const [cwd, pattern] = process.argv.slice(2);
const t0 = performance.now();
const hits = await glob(pattern, { cwd, nocase: true, dot: true, follow: false });
console.log(`${pattern.length}B ${pattern.slice(0, 40)} ms=${Math.round(performance.now() - t0)} hits=${hits.length}`);
