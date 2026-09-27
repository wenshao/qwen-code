// Checks #12863's revocation decision against #12855's real grant gate
// (trial-merge dist): a revoked revision never reopens.
import * as path from 'node:path';
const dist = path.resolve(process.argv[2]);
const { ManagedOperationGrantGate } = await import(path.join(dist, 'src/managed-runtime/managed-operation-grant-gate.js'));
const { isOperationGrantSuccessor } = await import(path.join(dist, 'src/managed-runtime/managed-extension-record.js'));
const fx = (await import(path.join(process.argv[3]), { with: { type: 'json' } })).default;
const g1 = fx.canonical?.grant ?? fx.grantCases.find((c) => c.valid).grant;
const renew = { ...g1, expiresAt: g1.expiresAt + 1000 };
const g2 = { ...g1, operationRevision: g1.operationRevision + 1 };
const gate = new ManagedOperationGrantGate();
const phase = g1.resourceScope.phases[0];
const now = g1.expiresAt - 1;
const t = (f) => { try { return f(); } catch (e) { return `REFUSED ${e.constructor.name}: ${e.message}`; } };
const admits = (g) => gate.admits(g.sessionKey, g.operationId, phase, now);
console.log(`isOperationGrantSuccessor(g1, renewal of g1) = ${isOperationGrantSuccessor(g1, renew)}   (the predicate alone cannot see a revocation)`);
console.log(`install g1 (revision ${g1.operationRevision})            -> ${t(() => gate.install(g1))}; admits=${admits(g1)}`);
gate.revoke(g1.sessionKey, g1.operationId, g1.operationRevision);
console.log(`revoke revision ${g1.operationRevision}                    -> admits=${admits(g1)}`);
console.log(`install a renewal of g1               -> ${t(() => gate.install(renew))}`);
console.log(`install g1 again (reinstall)          -> ${t(() => gate.install(g1))}; admits=${admits(g1)}`);
console.log(`install g2 (revision ${g2.operationRevision})            -> ${t(() => gate.install(g2))}; admits=${admits(g2)}`);
