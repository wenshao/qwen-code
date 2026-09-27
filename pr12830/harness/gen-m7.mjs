import { readFileSync, writeFileSync } from 'node:fs';
const W = '$HEAD_WORKTREE/packages/web-shell';
const { webShellContract } = await import(W + '/scripts/generate-managed-agent-api.mjs');
const { default: openapiTS, astToString } = await import('$HEAD_WORKTREE/node_modules/openapi-typescript/dist/index.mjs');
const s = JSON.parse(readFileSync('$HEAD_WORKTREE/packages/sdk-java/managed-agent-server/src/main/resources/openapi/managed-agent-public-api.openapi.json', 'utf8'));
s.paths['/api/agent/web-shell/v1/tasks/cancel'].post['x-qwen-implementation-status'] = 'partial';
const committed = readFileSync(W + '/client/components/managed/generated/managed-agent-api.ts', 'utf8');
writeFileSync(process.argv[2], committed.split('\n').slice(0, 2).join('\n') + '\n' + astToString(await openapiTS(webShellContract(s), { defaultNonNullable: false })));
