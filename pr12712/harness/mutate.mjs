// Writes one mutant of managed-context-envelope.ts to stdout. Every mutant
// must change the file, or the script exits 2.
import fs from 'node:fs';

const [, , source, name] = process.argv;
let s = fs.readFileSync(source, 'utf8');
const before = s;
const rep = (a, b) => {
  if (!s.includes(a)) {
    console.error(`anchor missing for ${name}: ${a.slice(0, 60)}`);
    process.exit(2);
  }
  s = s.replace(a, b);
};

switch (name) {
  case 'D1a-install-case-insensitive':
    rep(
      'if (WORKSPACE_KEYS.some((key) => binding[key] !== this.#boot[key])) {',
      'if (WORKSPACE_KEYS.some((key) => String(binding[key]).toLowerCase() !== String(this.#boot[key]).toLowerCase())) {',
    );
    break;
  case 'D1b-attest-case-insensitive':
    rep(
      'if (ATTESTED_KEYS.some((key) => request[key] !== identity[key])) {',
      "if (ATTESTED_KEYS.some((key) => (['tenantId', 'workspaceId', 'storageId', 'provisionRequestId'].includes(key) ? String(request[key]).toLowerCase() !== String(identity[key]).toLowerCase() : request[key] !== identity[key]))) {",
    );
    break;
  case 'D2-session-conflict-on-cwd-only':
    rep(
      'const installed = this.#sessions.get(sessionId);\n    if (installed !== undefined && installed !== contextDigest) {',
      'const installed = this.#sessions.get(sessionId);\n    if (installed !== undefined && installed !== (binding.cwdRelative as string)) {',
    );
    rep(
      'this.#sessions.set(sessionId, contextDigest);',
      'this.#sessions.set(sessionId, binding.cwdRelative as string);',
    );
    break;
  case 'I3-other-session-reuse-before-digest':
    rep(
      'const contextDigest = digestOf(binding);',
      `const early = this.#operations.get(operationId);
    if (early && early.sessionId !== sessionId) {
      return CONTEXT_CONFLICT;
    }
    const contextDigest = digestOf(binding);`,
    );
    break;
  case 'I4-operation-conflict-overwrites':
    rep(
      `        ? { status: 200, body: previous.receipt }
        : CONTEXT_CONFLICT;`,
      `        ? { status: 200, body: previous.receipt }
        : (this.#operations.set(operationId, Object.freeze({ sessionId, contextDigest, receipt: previous.receipt })), CONTEXT_CONFLICT);`,
    );
    break;
  default:
    console.error(`unknown mutant ${name}`);
    process.exit(2);
}
if (s === before) process.exit(2);
process.stdout.write(s);
