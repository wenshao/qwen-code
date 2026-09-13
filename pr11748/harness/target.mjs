import { resolve } from 'node:path';
const H = '/root/git/pr11748-harness/head';
const root = resolve(H, 'packages/web-shell');
const vites = { 'vite 5.4.21 (box root)': H + '/node_modules/vite/dist/node/index.js', 'vite 7.3.6 (CI lockfile root)': process.env.S + '/tc/v7/node_modules/vite/dist/node/index.js' };
for (const [vn, vp] of Object.entries(vites)) {
  const { resolveConfig, version } = await import(vp);
  for (const [cn, cf] of Object.entries({ 'head vite.config.ts': 'vite.config.ts', 'merge-base vite.config.ts': 'vite.config.base11748probe.ts' })) {
    const c = await resolveConfig({ root, configFile: resolve(root, cf), logLevel: 'silent' }, 'build');
    console.log(`${vn} [${version}] + ${cn} -> build.target = ${JSON.stringify(c.build.target)}`);
  }
}
