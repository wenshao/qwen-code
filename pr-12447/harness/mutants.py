#!/usr/bin/env python3
"""Hand-written semantic mutants of managed-runtime-attestation-contract.ts.

Each mutant is written to packages/cli/src/serve/__mut__/<id>/ together with a
copy of the test file and the contracts/ directory, so ONE vitest run executes
the (unchanged) test suite against every mutant in parallel. Nothing tracked is
modified. Usage: mutants.py <worktree> <fixtures-dir-to-copy> <test-file-to-copy>
"""
import json
import pathlib
import shutil
import sys

WT = pathlib.Path(sys.argv[1])
CONTRACTS = pathlib.Path(sys.argv[2])
TEST = pathlib.Path(sys.argv[3])
import os
SRC = pathlib.Path(os.environ['SRC_OVERRIDE']) if os.environ.get('SRC_OVERRIDE') else WT / 'packages/cli/src/serve/managed-runtime-attestation-contract.ts'
OUT = WT / 'packages/cli/src/serve/__mut__'

MUTANTS = [
    # id, group, description, old, new
    ('M01', 'credentials', 'any Bearer token accepted (token compare removed)',
     "!equalSecret(authorization.slice('Bearer '.length), identity.token)", 'false'),
    ('M02', 'credentials', 'length guard removed before timingSafeEqual',
     'actualBytes.length === expectedBytes.length &&\n    timingSafeEqual', 'timingSafeEqual'),
    ('M03', 'credentials', '"Bearer " scheme check removed (any 7-char prefix)',
     "!authorization?.startsWith('Bearer ') ||", '!authorization ||'),
    ('M04', 'headers', 'request Cache-Control: no-store check removed',
     "req.get('Cache-Control') !== 'no-store'", 'false'),
    ('M05', 'headers', 'lease-id header check removed',
     "req.get('X-Qwen-Managed-Lease-Id') !== identity.leaseId ||", 'false ||'),
    ('M06', 'headers', 'lease-epoch header check removed',
     "req.get('X-Qwen-Managed-Lease-Epoch') !== String(identity.epoch)", 'false'),
    ('M07', 'identity', 'provisionRequestId comparison removed',
     'body.provisionRequestId !== identity.provisionRequestId ||', 'false ||'),
    ('M08', 'identity', 'tenantId comparison removed',
     'body.tenantId !== identity.tenantId ||', 'false ||'),
    ('M09', 'identity', 'workspaceId comparison removed',
     'body.workspaceId !== identity.workspaceId ||', 'false ||'),
    ('M10', 'identity', 'workspaceGeneration comparison removed',
     'body.workspaceGeneration !== identity.workspaceGeneration ||', 'false ||'),
    ('M11', 'identity', 'workspaceCwd comparison removed',
     'body.workspaceCwd !== identity.workspaceCwd ||', 'false ||'),
    ('M12', 'identity', 'capabilityDigest comparison removed',
     'body.capabilityDigest !== identity.capabilityDigest ||', 'false ||'),
    ('M13', 'identity', 'isolationClass comparison removed',
     'body.isolationClass !== identity.isolationClass\n', 'false\n'),
    ('M14', 'protocol', 'non-empty provisionRequestId check removed',
     '!isNonEmptyString(body.provisionRequestId) ||', 'false ||'),
    ('M15', 'protocol', 'non-empty tenantId check removed',
     '!isNonEmptyString(body.tenantId) ||', 'false ||'),
    ('M16', 'protocol', 'non-empty workspaceId check removed',
     '!isNonEmptyString(body.workspaceId) ||', 'false ||'),
    ('M17', 'protocol', 'workspaceGeneration string check removed',
     '!isNonEmptyString(body.workspaceGeneration) ||', 'false ||'),
    ('M18', 'protocol', 'non-empty workspaceCwd check removed',
     '!isNonEmptyString(body.workspaceCwd) ||', 'false ||'),
    ('M19', 'protocol', 'capabilityDigest typeof string check removed',
     "typeof body.capabilityDigest !== 'string' ||", 'false ||'),
    ('M20', 'protocol', 'capabilityDigest pattern check removed',
     '!CAPABILITY_DIGEST_PATTERN.test(body.capabilityDigest) ||', 'false ||'),
    ('M21', 'protocol', 'isolationClass enum check removed',
     "(body.isolationClass !== 'session' && body.isolationClass !== 'workspace')\n    ) {",
     'false\n    ) {'),
    ('M22', 'protocol', 'protocolVersion check removed',
     'body.protocolVersion !== ATTEST_ROUTE.protocolVersion ||', 'false ||'),
    ('M23', 'protocol', 'closed body -> extra keys allowed',
     'keys.length === REQUEST_KEYS.length &&\n    keys.every((key, index) => key === REQUEST_KEYS[index])',
     'REQUEST_KEYS.every((key) => keys.includes(key))'),
    ('M24', 'limits', 'request limit raised to 1 MiB',
     'limit: ATTEST_ROUTE.requestBodyLimitBytes,', 'limit: 1024 * 1024,'),
    ('M25', 'limits', 'request limit off by one (16383)',
     'limit: ATTEST_ROUTE.requestBodyLimitBytes,', 'limit: ATTEST_ROUTE.requestBodyLimitBytes - 1,'),
    ('M26', 'body', 'Content-Type filter removed (parse any type)',
     "type: 'application/json',", 'type: () => true,'),
    ('M27', 'body', 'strict JSON off',
     'strict: true,', 'strict: false,'),
    ('M28', 'errors', 'SyntaxError -> JSON 400 mapping removed (Express default page)',
     'if (error instanceof SyntaxError) {', 'if (false) {'),
    ('M29', 'errors', 'entity.too.large -> JSON 413 mapping removed (Express default page)',
     "error.type === 'entity.too.large'", 'false'),
    ('M30', 'order', 'JSON parsed before authentication',
     "    noStore,\n    authorize(identity),\n    express.json({\n      limit: ATTEST_ROUTE.requestBodyLimitBytes,\n      strict: true,\n      type: 'application/json',\n    }),\n",
     "    noStore,\n    express.json({\n      limit: ATTEST_ROUTE.requestBodyLimitBytes,\n      strict: true,\n      type: 'application/json',\n    }),\n    authorize(identity),\n"),
    ('M31', 'no-store', 'route-level no-store middleware made a no-op',
     "res.setHeader('Cache-Control', ATTEST_ROUTE.cacheControl);\n  next();", 'next();'),
    ('M32', 'no-store', 'gate-level no-store header removed',
     "res.setHeader('Cache-Control', ATTEST_ROUTE.cacheControl);\n    if (!isOwned", 'if (!isOwned'),
    ('M33', 'gate', 'gate ignores method',
     'method === route.method && url === route.path', 'url === route.path'),
    ('M34', 'gate', 'gate strips query string',
     'method === route.method && url === route.path',
     "method === route.method && url?.split('?')[0] === route.path"),
    ('M35', 'gate', 'gate lower-cases the path',
     'method === route.method && url === route.path',
     'method === route.method && url?.toLowerCase() === route.path'),
    ('M36', 'gate', 'gate removed (everything reaches Express)',
     'if (!isOwnedManagedRuntimeRoute(req.method, req.url)) {', 'if (false) {'),
    ('M37', 'response', 'response size check > becomes >= (boundary)',
     'Buffer.byteLength(JSON.stringify(response)) >\n', 'Buffer.byteLength(JSON.stringify(response)) >=\n'),
    ('M38', 'response', 'identity validation at registration removed',
     "throw new Error('Managed Runtime attestation identity is invalid.');", '/* removed */'),
    ('M39', 'response', 'response echoes the bearer token',
     '    epoch: identity.epoch,\n    provisionRequestId: identity.provisionRequestId,',
     '    epoch: identity.epoch,\n    token: identity.token,\n    provisionRequestId: identity.provisionRequestId,'),
    # present only from b1ff554 on
    ('M40', 'snapshot', 'identity snapshot neither copied nor frozen',
     'return Object.freeze({ ...identity });', 'return identity;'),
    ('M41', 'response', 'response re-serialised by res.json (host json settings apply)',
     "res.status(200).type('application/json').send(responseJson);", 'res.status(200).json(JSON.parse(responseJson));'),
    ('M42', 'errors', 'charset.unsupported -> 400 mapping removed',
     "(error.type === 'charset.unsupported' ||", '(false ||'),
    ('M43', 'errors', 'encoding.unsupported -> 400 mapping removed',
     "error.type === 'encoding.unsupported'))", 'false))'),
    # present only in the suggested-fix arm
    ('M44', 'errors', 'inflate: false reverted (zlib errors reach Express page)',
     'inflate: false,', 'inflate: true,'),
]
OPTIONAL = {'M44'}

# Same mutant expressed against the suggested-fix source (handleJsonError condition widened).
ALTERNATIVES = {
    ('M28', 'if (error instanceof SyntaxError) {'):
        ('    error instanceof SyntaxError ||\n', '    false ||\n'),
    ('M30', "    noStore,\n    authorize(identity),\n    express.json({\n      limit: ATTEST_ROUTE.requestBodyLimitBytes,\n      strict: true,\n      type: 'application/json',\n    }),\n"):
        ("    noStore,\n    authorize(identitySnapshot),\n    express.json({\n      limit: ATTEST_ROUTE.requestBodyLimitBytes,\n      strict: true,\n      type: 'application/json',\n    }),\n",
         "    noStore,\n    express.json({\n      limit: ATTEST_ROUTE.requestBodyLimitBytes,\n      strict: true,\n      type: 'application/json',\n    }),\n    authorize(identitySnapshot),\n"),
    ('M37', 'Buffer.byteLength(JSON.stringify(response)) >\n'):
        ('if (Buffer.byteLength(responseJson) > ATTEST_ROUTE.responseBodyLimitBytes) {',
         'if (Buffer.byteLength(responseJson) >= ATTEST_ROUTE.responseBodyLimitBytes) {'),
}


def main() -> None:
    src = SRC.read_text()
    if OUT.exists():
        shutil.rmtree(OUT)
    manifest = []
    for mid, group, desc, old, new in [('M00', 'control', 'unmutated control', None, None)] + MUTANTS:
        if old is not None and src.count(old) == 0 and (mid, old) in ALTERNATIVES:
            old, new = ALTERNATIVES[(mid, old)]
        if old is not None and src.count(old) == 0 and mid == 'M30':
            # suggested-fix arm: express.json options gained a comment + inflate line
            old = '    noStore,\n    authorize(identitySnapshot),\n'
            new = '    noStore,\n'
            src_m = src.replace(old, new, 1).replace('    handleAttestation(identitySnapshot, responseJson),', '    authorize(identitySnapshot),\n    handleAttestation(identitySnapshot, responseJson),', 1)
            d = OUT / mid.lower(); d.mkdir(parents=True)
            (d / SRC.name).write_text(src_m); shutil.copy(TEST, d / TEST.name); shutil.copytree(CONTRACTS, d / 'contracts')
            manifest.append({'id': mid, 'group': group, 'desc': desc}); continue
        if old is not None and src.count(old) == 0 and mid in OPTIONAL:
            continue
        if old is not None:
            count = src.count(old)
            if count != 1:
                raise SystemExit(f'{mid}: pattern occurs {count} times')
            mutated = src.replace(old, new, 1)
        else:
            mutated = src
        d = OUT / mid.lower()
        d.mkdir(parents=True)
        (d / SRC.name).write_text(mutated)
        shutil.copy(TEST, d / TEST.name)
        shutil.copytree(CONTRACTS, d / 'contracts')
        manifest.append({'id': mid, 'group': group, 'desc': desc})
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    print(f'wrote {len(manifest)} dirs under {OUT}')


main()
