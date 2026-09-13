import esbuild from '/root/git/pr11644/node_modules/esbuild/lib/main.js';
import path from 'node:path';
const pkg = '/root/git/pr11644/packages/sdk-typescript';
await esbuild.build({
  entryPoints: [path.join(pkg, 'src/daemon/index.ts')],
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
  outfile: '/root/git/h11644/sdk-base-dist/daemon.mjs',
  absWorkingDir: pkg, logLevel: 'warning',
  plugins: [{ name: 'swap-daemon-client', setup(b) {
    b.onResolve({ filter: /(^|\/)DaemonClient(\.js)?$/ }, (args) => {
      if (!args.importer.startsWith(path.join(pkg, 'src'))) return undefined;
      return { path: path.join(path.dirname(path.resolve(args.resolveDir, args.path)), 'DaemonClient.base11644.ts') };
    });
  } }],
});
console.log('built');
