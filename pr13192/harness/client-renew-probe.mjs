// Drives the production TypeScript Hosted client (createHttpManagedSessionStores,
// bundled from packages/core) against a real Spring server, then counts the
// writer renewals it sends in a fixed idle window.
import { writeFileSync } from 'node:fs';
import { createHttpManagedSessionStores } from './hmss.mjs';

const [, , baseUrl, label, windowMsText, outFile] = process.argv;
const windowMs = Number(windowMsText);
const counts = { acquire: 0, renew: 0, seal: 0, other: 0 };
const grants = [];
const fetchFn = async (url, init) => {
  const path = String(url).split('/').pop();
  if (path === 'writers:acquire') counts.acquire++;
  else if (path === 'writers:renew') counts.renew++;
  else if (path === 'writers:seal') counts.seal++;
  else counts.other++;
  const sentAt = Date.now();
  const response = await fetch(url, init);
  if (path === 'writers:acquire' || path === 'writers:renew') {
    try {
      const json = await response.clone().json();
      grants.push({ path, status: response.status, sentAt, leaseUntil: json.leaseUntil,
        clientRemainingMs: json.leaseUntil - sentAt });
    } catch {
      grants.push({ path, status: response.status, sentAt });
    }
  }
  return response;
};

const sessionKey = { tenantId: 'tz-client', workspaceId: 'ws-client', sessionId: `c-${label}-${Date.now()}` };
const stores = createHttpManagedSessionStores({
  baseUrl, sessionKey, writerId: 'hosted-client', leaseDurationMs: 60000, fetchFn,
});
const started = Date.now();
await stores.journalStore.open({ sessionKey });
await new Promise((resolve) => setTimeout(resolve, windowMs));
const renewsInWindow = counts.renew;
await stores.close();
const out = {
  label, windowMs, leaseDurationMs: 60000, renewsInWindow, counts,
  firstGrant: grants[0], lastGrant: grants.at(-1), elapsedMs: Date.now() - started,
};
writeFileSync(outFile, JSON.stringify({ ...out, grants }, null, 2));
console.log(JSON.stringify(out));
console.log(`CLIENT ${label} renews=${renewsInWindow} in ${windowMs}ms`);
