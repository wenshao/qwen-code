#!/usr/bin/env python3
"""augment2.py <worktree@b1ff554> <outdir>: suggested additions on top of b1ff554."""
import json, pathlib, sys
wt = pathlib.Path(sys.argv[1]); out = pathlib.Path(sys.argv[2]); (out / 'contracts').mkdir(parents=True, exist_ok=True)
serve = wt / 'packages/cli/src/serve'
fx = json.loads((serve / 'contracts/managed-runtime-attestation-v2.fixtures.json').read_text())
CODE = {401: 'managed_runtime_unauthorized', 400: 'managed_runtime_attestation_invalid',
        409: 'managed_runtime_identity_conflict', 413: 'managed_runtime_attestation_too_large'}
CLS = {401: 'credentials', 400: 'protocol', 409: 'identity', 413: 'protocol', 404: 'incompatible'}
def case(cid, status, **request):
    return {'id': cid, 'request': request, 'expected': {'status': status, 'classification': CLS[status]}}
rh = lambda n, v: {'replaceHeader': {'name': n, 'value': v}}
rb = lambda n, v: {'replaceBody': {'name': n, 'value': v}}
digest = fx['identity']['capabilityDigest']
new = [
    case('wrong-token', 401, **rh('authorization', 'Bearer fixture-tokeX')),
    case('wrong-token-length', 401, **rh('authorization', 'Bearer x')),
    case('wrong-auth-scheme', 401, **rh('authorization', 'Digest fixture-token')),
    case('wrong-provision-request', 409, **rb('provisionRequestId', 'provision-02')),
    case('wrong-tenant', 409, **rb('tenantId', 'tenant-b')),
    case('wrong-workspace', 409, **rb('workspaceId', 'workspace-b')),
    case('wrong-workspace-cwd', 409, **rb('workspaceCwd', '/runtime/other')),
    case('wrong-capability-digest', 409, **rb('capabilityDigest', 'sha256:' + 'b' * 64)),
    case('wrong-isolation-class', 409, **rb('isolationClass', 'workspace')),
    case('empty-provision-request', 400, **rb('provisionRequestId', '')),
    case('empty-tenant', 400, **rb('tenantId', '')),
    case('empty-workspace', 400, **rb('workspaceId', '')),
    case('numeric-workspace-generation', 400, **rb('workspaceGeneration', 7)),
    case('empty-workspace-cwd', 400, **rb('workspaceCwd', '')),
    case('array-capability-digest', 400, **rb('capabilityDigest', [digest])),
    case('unknown-isolation-class', 400, **rb('isolationClass', 'tenant')),
    case('non-json-content-type', 400, **rh('content-type', 'text/plain')),
    case('gzip-content-encoding', 400, **rh('content-encoding', 'gzip')),
    case('case-variant-route', 404, pathOverride=fx['route']['path'].upper()),
    case('options-method', 404, method='OPTIONS'),
]
ids = {c['id'] for c in fx['cases']}
assert not ids & {c['id'] for c in new}
fx['cases'].extend(new)
for c in fx['cases']:
    st = c['expected']['status']
    if st in CODE:
        c['expected']['code'] = CODE[st]
(out / 'contracts/managed-runtime-attestation-v2.fixtures.json').write_text(json.dumps(fx, indent=2) + '\n')

sch = (serve / 'contracts/managed-runtime-attestation-v2.schema.json').read_text()
old = '            "body": { "$ref": "#/$defs/responseBody" }\n'
assert sch.count(old) == 1
sch = sch.replace(old, '''            "body": { "$ref": "#/$defs/responseBody" },
            "code": {
              "enum": [
                "managed_runtime_attestation_invalid",
                "managed_runtime_attestation_too_large",
                "managed_runtime_identity_conflict",
                "managed_runtime_unauthorized"
              ]
            }
''')
(out / 'contracts/managed-runtime-attestation-v2.schema.json').write_text(sch)

test = (serve / 'managed-runtime-attestation-contract.test.ts').read_text()
o1 = "    readonly classification: string;\n    readonly body?: Readonly<Record<string, unknown>>;"
assert test.count(o1) == 1
test = test.replace(o1, "    readonly classification: string;\n    readonly code?: string;\n    readonly body?: Readonly<Record<string, unknown>>;")
o2 = "      if (fixture.expected.body) {"
assert test.count(o2) == 1
test = test.replace(o2, """      if (fixture.expected.code) {
        expect(response.headers.get('content-type')).toMatch(
          /^application\\/json/u,
        );
        expect(await response.clone().json()).toMatchObject({
          code: fixture.expected.code,
        });
      }
      if (fixture.expected.body) {""")
o3 = "  it('keeps request and response objects closed in the shared schema', () => {"
assert test.count(o3) == 1
test = test.replace(o3, """  it.each([
    ['empty token', { token: '' }],
    ['zero epoch', { epoch: 0 }],
    ['fractional epoch', { epoch: 1.5 }],
    ['uppercase digest', { capabilityDigest: `sha256:${'A'.repeat(64)}` }],
    ['unknown isolation class', { isolationClass: 'tenant' }],
  ])('rejects an invalid identity at registration: %s', (_label, patch) => {
    expect(() =>
      registerManagedRuntimeAttestationRoute(express(), {
        ...fixtures.identity,
        ...(patch as Partial<ManagedRuntimeAttestationIdentity>),
      }),
    ).toThrow('Managed Runtime attestation identity is invalid.');
  });

""" + o3)
(out / 'managed-runtime-attestation-contract.test.ts').write_text(test)

src = (serve / 'managed-runtime-attestation-contract.ts').read_text()
o4 = "    express.json({\n      limit: ATTEST_ROUTE.requestBodyLimitBytes,\n"
assert src.count(o4) == 1
src = src.replace(o4, """    express.json({
      // A 16 KiB private request gains nothing from compression. Refusing
      // any non-identity Content-Encoding keeps the limit a wire-byte limit
      // and sends it through the encoding.unsupported mapping below; with
      // inflation on, a corrupt gzip/deflate/br body fails inside zlib with
      // no body-parser type and reaches Express' HTML error page.
      inflate: false,
      limit: ATTEST_ROUTE.requestBodyLimitBytes,
""")
(out / 'managed-runtime-attestation-contract.ts').write_text(src)
print(f'{len(fx["cases"])} cases ({len(new)} new) -> {out}')
