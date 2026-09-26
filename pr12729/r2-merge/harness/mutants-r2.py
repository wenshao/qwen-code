# Independent mutation sweep of managed-tool-result.ts against the PR suite.
# Each mutant is one exact, unique text replacement; the file is restored
# from a byte copy after every run (never from git).
import os, shutil, subprocess, sys, json, time

ROOT = sys.argv[1]
SRC = os.path.join(ROOT, 'packages/core/src/managed-runtime/managed-tool-result.ts')
BAK = SRC + '.orig-bak'
M = [
    ('closed-extra-keys', "present.some((key) => !keys.includes(key as Key)) ||", "false ||"),
    ('closed-prototype', "if (prototype !== Object.prototype && prototype !== null) {", "if (false) {"),
    ('list-max+1', "if (value.length > max) fail", "if (value.length > max + 1) fail"),
    ('count-min-1', "if (number < min || (max", "if (number < min - 1 || (max"),
    ('count-max+1', "(max !== undefined && number > max)", "(max !== undefined && number > max + 1)"),
    ('generation-bound', "BigInt(value) > MAX_GENERATION", "BigInt(value) > MAX_GENERATION + 1n"),
    ('ref-schemaVersion', "ref.kind !== kind || ref.schemaVersion !== 1", "ref.kind !== kind"),
    ('ref-kind', "ref.kind !== kind || ref.schemaVersion !== 1", "ref.schemaVersion !== 1"),
    ('ref-min-bytes', "(ref.byteLength < 1 || ref.byteLength > maxBytes)", "ref.byteLength > maxBytes"),
    ('exit-max', "(value as number) > MAX_EXIT_CODE", "(value as number) > MAX_EXIT_CODE + 1"),
    ('exit-min', "(value as number) < MIN_EXIT_CODE", "(value as number) < MIN_EXIT_CODE - 1"),
    ('mime-length', "value.length > LIMITS.maxMimeTypeLength ||", "value.length > LIMITS.maxMimeTypeLength + 1 ||"),
    ('ranges-any-state', "state === 'incomplete' ? 1 : 0", "1"),
    ('range-end-equal', "count(end, `${label}[0].end`, start + 1)", "count(end, `${label}[0].end`, start)"),
    ('range-start-le', "if (start !== byteLength) {", "if (start > byteLength) {"),
    ('pageref-max-bytes', "segmentCount * LIMITS.maxSegmentBytes,\n    ),", "segmentCount * LIMITS.maxSegmentBytes + 1,\n    ),"),
    ('pageref-min-bytes', "`${label}.byteLength`,\n      segmentCount,", "`${label}.byteLength`,\n      1,"),
    ('ref-body-open', "if (state === 'open') fail(`${label}.body.ref cannot grow while open.`);", ""),
    ('ref-body-length', "if (ref.byteLength !== byteLength || ref.digest !== streamDigest) {", "if (ref.digest !== streamDigest) {"),
    ('ref-body-digest', "if (ref.byteLength !== byteLength || ref.digest !== streamDigest) {", "if (ref.byteLength !== byteLength) {"),
    ('pages-sum-le', "if (pages.reduce((sum, page) => sum + page.byteLength, 0) !== byteLength) {", "if (pages.reduce((sum, page) => sum + page.byteLength, 0) > byteLength) {"),
    ('implied-empty-complete', "if (contents.length > 0 && contents.every((e) => e.state === 'sealed')) {", "if (contents.every((e) => e.state === 'sealed')) {"),
    ('implied-unavailable-bytes', "(entry) => entry.state === 'incomplete' && entry.byteLength === 0,", "(entry) => entry.state === 'incomplete',"),
    ('roles-unique-stream', "if (streams.size !== contents.length) {", "if (false) {"),
    ('roles-once', "if (roles.filter((each) => each === role).length > 1) {", "if (roles.filter((each) => each === role).length > 2) {"),
    ('roles-pty-scope', "? ['stdout', 'stderr']\n      : scope", "? ['stdout']\n      : scope"),
    ('roles-native-scope', ": ['stdout', 'stderr', 'pty'];", ": ['stdout', 'stderr'];"),
    ('exit-native-signal', "? exitCode !== null || signal !== null", "? exitCode !== null"),
    ('exit-process-both', ": exitCode !== null && signal !== null", ": false"),
    ('reason-pending', "(captureStatus === 'pending' || captureStatus === 'complete')", "captureStatus === 'complete'"),
    ('status-implied', "if (captureStatus !== impliedStatus(contents)) {", "if (false) {"),
    ('revision-min0', "revision: count(manifest.revision, 'manifest.revision', 1),", "revision: count(manifest.revision, 'manifest.revision', 0),"),
    ('bytes-bound', "if (bytes.byteLength > maxBytes) {\n    fail", "if (bytes.byteLength > maxBytes + 1) {\n    fail"),
    ('page-empty', "if (segments.length === 0) fail('page.segments must not be empty.');", ""),
    ('page-last-ordinal', "LIMITS.maxOrdinal + 1 - segments.length,", "LIMITS.maxOrdinal + 1,"),
    ('page-end-count', "  count(\n    offset + segments.reduce((sum, segment) => sum + segment.byteLength, 0),\n    'page end',\n  );", ""),
    ('at-capture', "parsedPage.captureId === parsedManifest.captureId &&", ""),
    ('at-stream', "parsedPage.streamId === entry.streamId &&", ""),
    ('at-offset', "parsedPage.offset ===\n      earlier.reduce((sum, each) => sum + each.byteLength, 0) &&", ""),
    ('at-first-ordinal', "parsedPage.firstOrdinal ===\n      earlier.reduce((sum, each) => sum + each.segmentCount, 0) &&", ""),
    ('at-segment-count', "parsedPage.segments.length === slot.segmentCount &&", ""),
    ('desc-mime', "previous.mimeType !== next.mimeType", "false"),
    ('desc-role', "previous.role !== next.role ||", ""),
    ('desc-final-unchanged', "if (previous.state !== 'open') return sameJson(previous, next);", "if (previous.state !== 'open') return true;"),
    ('desc-fewer-pages', "next.digest !== previous.digest) ||\n    after.length < before.length", "next.digest !== previous.digest)"),
    ('desc-same-length-digest', "(next.byteLength === previous.byteLength &&\n      next.digest !== previous.digest) ||", ""),
    ('desc-last-segments', "after[index].segmentCount >= page.segmentCount &&", ""),
    ('desc-last-bytes', "&&\n        after[index].byteLength >= page.byteLength", ""),
    ('desc-earlier-pages', "? sameJson(page, after[index])", "? true"),
    ('desc-keeps-pages', "    !after ||\n    (next.byteLength", "    false ||\n    (next.byteLength"),
    ('succ-final', "before.captureStatus !== 'pending' ||", ""),
    ('succ-revision', "after.revision !== before.revision + 1 ||", "after.revision <= before.revision ||"),
    ('succ-fixed', "FIXED_KEYS.some((key) => before[key] !== after[key]) ||", ""),
    ('succ-truncated', "(before.upstreamTruncated && !after.upstreamTruncated) ||", ""),
    ('succ-fewer-contents', "after.contents.length < before.contents.length\n  ) {", "false\n  ) {"),
    ('succ-outcome', "before.executionStatus !== 'unknown' &&", "false &&"),
    ('succ-exit-code', "before.exitCode !== after.exitCode ||", ""),
    ('fixed-policy', "  'captureScope',\n  'capturePolicy',\n] as const;", "  'captureScope',\n] as const;"),
    ('fixed-generation', "  'invocationDigest',\n  'bindingGeneration',\n  'captureId',", "  'invocationDigest',\n  'captureId',"),
    ('psucc-first', "before.firstOrdinal === after.firstOrdinal &&", ""),
    ('psucc-offset', "before.offset === after.offset &&", ""),
    ('psucc-digest', "&&\n        after.segments[index]?.digest === segment.digest", ""),
    ('psucc-stream', "before.streamId === after.streamId &&", ""),
    ('cap-reason', "if ((captureReason === null) !== (captureStatus === 'complete')) {", "if (false) {"),
    ('cap-manifest-required', "if (manifest === null && captureStatus !== 'unavailable') {", "if (false) {"),
    ('cap-manifest-limit', "      MANAGED_TOOL_RESULT_KINDS.manifest,\n      LIMITS.maxManifestBytes,\n    ),", "      MANAGED_TOOL_RESULT_KINDS.manifest,\n    ),"),
    ('env-not-started', "executionStatus === 'not_started'\n      ? exactly(result.capture, null, 'result.capture')\n      : parseCapture(result.capture);", "result.capture === null ? null : parseCapture(result.capture);"),
    ('env-error-empty', "if (typeof value !== 'string' || value.length === 0) {", "if (typeof value !== 'string') {"),
    ('envof-status', "parsed.executionStatus === envelope.executionStatus &&", ""),
    ('envof-reason', "&&\n    parsed.captureReason === envelope.capture.captureReason", ""),
    ('envof-capture', "parsed.captureStatus === envelope.capture.captureStatus &&", ""),
    ('pub-digest', "if (fields.expected !== null && fields.expected !== received) {", "if (false) {"),
    ('pub-idempotent', "return sha256([stored]) === received &&", "return true ||"),
    ('pub-sealed-ge', "if (stream?.seal && fields.ordinal >= stream.seal.segmentCount) {", "if (stream?.seal && fields.ordinal > stream.seal.segmentCount) {"),
    ('pub-max-bytes', "bytes.byteLength > LIMITS.maxSegmentBytes", "bytes.byteLength > LIMITS.maxSegmentBytes + 1"),
    ('pub-ordinal-max', "count(value.ordinal, 'publish.ordinal', 0, LIMITS.maxOrdinal)", "count(value.ordinal, 'publish.ordinal', 0, LIMITS.maxOrdinal + 1)"),
    ('pub-stores-mismatch', "    if (fields.expected !== null && fields.expected !== received) {\n      return refused('managed_tool_result_digest_mismatch');",
     "    if (fields.expected !== null && fields.expected !== received) {\n      const s = this.#streams.get(fields.key) ?? { segments: new Map() }; s.segments.set(fields.ordinal, fields.bytes); this.#streams.set(fields.key, s);\n      return refused('managed_tool_result_digest_mismatch');"),
    ('seal-repeat', "return sameJson(stream.seal, wanted)\n        ? ok({ ...stream.seal })", "return true\n        ? ok({ ...stream.seal })"),
    ('seal-count', "ordinals.length !== fields.segmentCount ||", ""),
    ('seal-extra', "||\n      ordinals.some((ordinal) => ordinal >= fields.segmentCount)", ""),
    ('seal-length', "chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0) !==\n        fields.byteLength ||", ""),
    ('seal-digest', "||\n      sha256(chunks) !== fields.digest", ""),
    ('seal-max-count', "LIMITS.maxOrdinal + 1,\n        ),\n        byteLength: count(value.byteLength, 'seal.byteLength'),", "LIMITS.maxOrdinal + 2,\n        ),\n        byteLength: count(value.byteLength, 'seal.byteLength'),"),
    ('prefix-sealed', "sealed: stream?.seal !== undefined,", "sealed: false,"),
    ('prefix-gap', "chunk = stream?.segments.get(chunks.length)", "chunk = stream?.segments.get(chunks.length) ?? stream?.segments.get(chunks.length + 1)"),
    ('seal-refused-records', "    if (stream.seal) {\n      return sameJson", "    this.#streams.set(fields.key, stream);\n    if (stream.seal) {\n      return sameJson"),
    ('f1-drop-unknown', "captureScope === 'tool_native' || executionStatus === 'unknown'", "captureScope === 'tool_native'"),
    ('f1-unknown-exit-only', "    captureScope === 'tool_native' || executionStatus === 'unknown'\n      ? exitCode !== null || signal !== null\n      : exitCode !== null && signal !== null", "    captureScope === 'tool_native'\n      ? exitCode !== null || signal !== null\n      : executionStatus === 'unknown'\n        ? exitCode !== null\n        : exitCode !== null && signal !== null"),
    ('f1-unknown-signal-only', "    captureScope === 'tool_native' || executionStatus === 'unknown'\n      ? exitCode !== null || signal !== null\n      : exitCode !== null && signal !== null", "    captureScope === 'tool_native'\n      ? exitCode !== null || signal !== null\n      : executionStatus === 'unknown'\n        ? signal !== null\n        : exitCode !== null && signal !== null"),
    ('f1-wrong-status', "|| executionStatus === 'unknown'", "|| executionStatus === 'cancelled'"),
]

orig = open(SRC).read()
shutil.copyfile(SRC, BAK)
results = []
try:
    for name, a, b in M:
        n = orig.count(a)
        if n != 1:
            results.append((name, 'BAD-ANCHOR(%d)' % n)); print(name, 'BAD-ANCHOR', n, flush=True); continue
        open(SRC, 'w').write(orig.replace(a, b))
        t = time.time()
        p = subprocess.run(['npx', 'vitest', 'run', 'src/managed-runtime/managed-tool-result.test.ts'],
                           cwd=os.path.join(ROOT, 'packages/core'), capture_output=True, text=True)
        out = p.stdout + p.stderr
        failed = [l for l in out.splitlines() if 'Tests' in l and ('failed' in l or 'passed' in l)]
        verdict = 'killed' if p.returncode != 0 else 'SURVIVED'
        results.append((name, verdict, failed[-1].strip() if failed else ''))
        print(f'{name:28} {verdict:9} {failed[-1].strip() if failed else ""} ({time.time()-t:.1f}s)', flush=True)
        shutil.copyfile(BAK, SRC)
finally:
    shutil.copyfile(BAK, SRC)
    os.remove(BAK)
json.dump(results, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mutants-r2.json'), 'w'), indent=1)
k = sum(1 for r in results if r[1] == 'killed'); s = [r[0] for r in results if r[1] == 'SURVIVED']
print(f'killed {k}/{len(results)}; survivors: {s}')
