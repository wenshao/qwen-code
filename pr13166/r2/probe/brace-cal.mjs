import { createRequire } from 'node:module';
const require = createRequire('/Users/wenshao/pr13166-rig/wt/packages/core/package.json');
const { globStream } = require('glob');
const cwd = process.argv[2];
for (const n of process.argv.slice(3).map(Number)) {
  const pattern = '{a,b}'.repeat(n) + '/*';
  const t0 = performance.now();
  let lag = 0, last = performance.now();
  const tick = setInterval(() => { const now = performance.now(); lag = Math.max(lag, now - last - 50); last = now; }, 50);
  let count = 0;
  for await (const _ of globStream(pattern, { cwd, nocase: true, dot: true, follow: false, withFileTypes: true })) count++;
  clearInterval(tick);
  console.log(`groups=${n} bytes=${pattern.length} ms=${Math.round(performance.now() - t0)} maxEventLoopLag=${Math.round(lag)} hits=${count}`);
}
