// Differential: head's new acp-bridge parser guard vs core's existing
// HttpManagedSessionStore guard (both built dist of the same head) over
// plaintext base URLs, no allowInsecureHttp.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [repo] = process.argv.slice(2);
const bridge = await import(pathToFileURL(path.join(repo, 'packages/acp-bridge/dist/bridgeTypes.js')).href);
const core = await import(pathToFileURL(path.join(repo, 'packages/core/dist/src/managed-runtime/http-managed-session-store.js')).href);
const urls = ['http://localhost:8080','http://LOCALHOST:8080','http://api.localhost:8080','http://localhost.:8080','http://127.0.0.1:8080','http://127.1:8080','http://127.0.1:8080','http://127.255.255.254:8080','http://2130706433:8080','http://0x7f000001:8080','http://0x7f.1:8080','http://127.000.000.001:8080','http://127.0.0.1.:8080','http://[::1]:8080','http://[0:0:0:0:0:0:0:1]:8080','http://[::ffff:127.0.0.1]:8080','http://127.foo.example.test:8080','http://10.0.0.5:8080','http://0.0.0.0:8080','http://[::]:8080','http://host.docker.internal:8080','http://localhost.localdomain:8080','https://10.0.0.5:8443'];
const verdict = (fn) => { try { fn(); return 'accept'; } catch (e) { return 'reject'; } };
let disagreements = 0;
for (const baseUrl of urls) {
  const b = verdict(() => bridge.parseBridgeManagedSessionStore({ baseUrl, tenantId: 'tenant', workspaceId: 'workspace', writerId: 'writer', leaseDurationMs: 30000 }));
  const c = verdict(() => core.createHttpManagedSessionStores({ baseUrl, sessionKey: { tenantId: 'tenant', workspaceId: 'workspace', sessionId: '550e8400-e29b-41d4-a716-446655440301' }, writerId: 'writer', leaseDurationMs: 30000 }));
  if (b !== c) disagreements++;
  console.log(`RESULT ${baseUrl.padEnd(36)} host=${new URL(baseUrl).hostname.padEnd(22)} bridge=${b} core=${c}${b !== c ? '  <-- DIFFERS' : ''}`);
}
console.log(`RESULT disagreements = ${disagreements}`);
