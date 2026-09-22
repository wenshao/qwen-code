// build one relay variant with the exact options esbuild.config.js uses for sandboxBwrapRelay
import esbuild from '/root/verify/pr12267-r8/node_modules/esbuild/lib/main.js';
const [src, outfile] = process.argv.slice(2);
await esbuild.build({ entryPoints: [src], bundle: true, outfile, platform: 'node', format: 'esm', target: 'node22' });
console.log('built', outfile);
