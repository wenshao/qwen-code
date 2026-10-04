// Bundles each probe once per arm so .75 needs nothing but node.
// @armcli → <arm>/cli, @qwen-code/qwen-code-core → <arm>/core; npm deps come
// from the PR worktree's node_modules.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad';
const WT = `${SP}/wt-pr8`;
const R5 = '/Users/wenshao/pr13265-rig/r5';
const require = createRequire(`${WT}/package.json`);
const esbuild = require('esbuild');
const probes = process.argv.slice(2);
for (const arm of ['head', 'nulonly', 'cand']) {
  for (const probe of probes) {
    const name = probe.replace(/\.mjs$/, '');
    const result = await esbuild.build({
      entryPoints: [`/Users/wenshao/pr13265-rig/probe/${probe}`],
      outfile: `${R5}/bundles/${arm}/${name}.mjs`,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      alias: {
        '@armcli': `${R5}/arms/${arm}/cli`,
        '@qwen-code/qwen-code-core': `${R5}/arms/${arm}/core`,
      },
      nodePaths: [`${WT}/node_modules`, `${WT}/packages/cli/node_modules`, `${WT}/packages/core/node_modules`],
      external: ['*.node', 'node-pty', '@lydell/node-pty', 'fsevents', '@vscode/ripgrep'],
      banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
      plugins: [{
        name: 'wasm-binary',
        setup(b) {
          b.onResolve({ filter: /\.wasm\?binary$/ }, (args) => ({
            path: require.resolve(args.path.replace(/\?binary$/, ''), { paths: [args.resolveDir, `${WT}/node_modules`, `${WT}/packages/core/node_modules`] }),
            namespace: 'wasm-binary',
          }));
          b.onLoad({ filter: /.*/, namespace: 'wasm-binary' }, async (args) => ({ contents: await fs.promises.readFile(args.path), loader: 'binary' }));
        },
      }],
      logLevel: 'silent',
      metafile: true,
    });
    const inputs = Object.keys(result.metafile.inputs);
    const fromArm = inputs.filter((p) => p.includes(`arms/${arm}/`)).length;
    const leaked = inputs.filter((p) => p.includes('/packages/core/dist/') || p.includes('/packages/cli/dist/')).length;
    const size = fs.statSync(`${R5}/bundles/${arm}/${name}.mjs`).size;
    console.log(`${arm}/${name}: ${(size / 1048576).toFixed(1)} MiB, ${fromArm} arm files, ${leaked} worktree-dist files, ${result.warnings.length} warnings`);
  }
}
