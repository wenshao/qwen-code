import { readFileSync } from 'node:fs';
const { default: openapiTS, astToString } = await import('$HEAD_WORKTREE/node_modules/openapi-typescript/dist/index.mjs');
for (const f of process.argv.slice(2)) {
  const out = astToString(await openapiTS(JSON.parse(readFileSync(f, 'utf8'))));
  console.log(f.split('/').pop(), 'lines=' + out.split('\n').length, 'PublicTask=' + out.includes('PublicTask:'), 'cancelSessionTask=' + out.includes('cancelSessionTask'));
}
