#!/usr/bin/env python3
"""Restore the pre-PR greedy first-match walk in walkWorkerAnchorPath.

This is the control arm: one file, one hunk, everything else identical to the
PR head, so any behavioural difference observed is attributable to this change
alone.
"""
import sys, pathlib
p = pathlib.Path(sys.argv[1])
src = p.read_text()

NEW = """    const issuers = chain.filter(
      (candidate) =>
        !walked.has(candidate.fingerprint256) &&
        certIssuedBy(current, candidate),
    );
    // A renewed CA leaves two certificates in the bundle that share a subject
    // AND a key, so both verify what they issued. Taking whichever one came
    // first reported the expired copy as the path the handshake depends on and
    // told the operator to renew a CA they had already renewed, while the
    // merged bundle authorizes through the renewed copy. OpenSSL may use
    // either, so prefer the copy that is usable now.
    const issuer: X509Certificate | undefined =
      issuers.find((candidate) => certValidAt(candidate, Date.now())) ??
      issuers[0];
"""

OLD = """    const issuer: X509Certificate | undefined = chain.find(
      (candidate) =>
        !walked.has(candidate.fingerprint256) &&
        certIssuedBy(current, candidate),
    );
"""

if NEW not in src:
    print("FAIL: fix hunk not found (already reverted?)", file=sys.stderr)
    sys.exit(1)
src = src.replace(NEW, OLD, 1)

# certValidAt is now unused; drop it so lint/tsc noUnusedLocals stays quiet.
HELPER = """/** Whether `cert`'s validity window contains `now`. */
function certValidAt(cert: X509Certificate, now: number): boolean {
  return (
    new Date(cert.validFrom).getTime() <= now &&
    new Date(cert.validTo).getTime() >= now
  );
}

"""
if HELPER in src:
    src = src.replace(HELPER, "", 1)
else:
    print("WARN: certValidAt helper not found", file=sys.stderr)

p.write_text(src)
print("reverted:", p)
