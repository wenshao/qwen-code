#!/usr/bin/env python3
"""Mutation sweep over managed-tool-result.ts: each mutant must fail a test."""

import subprocess
import sys

# Run from the repository root, or point CORE_DIR at packages/core.
ROOT = __import__("os").path.abspath(
    __import__("os").environ.get("CORE_DIR", "packages/core"))
FILE = f"{ROOT}/src/managed-runtime/managed-tool-result.ts"
TEST = "src/managed-runtime/managed-tool-result.test.ts"

MUTANTS = [
    ("closed-extra-keys", "present.some((key) => !keys.includes(key as Key)) ||", "false ||"),
    ("closed-missing-keys", "keys.some((key) => !optional.includes(key) && !present.includes(key))", "false"),
    ("closed-prototype", "if (prototype !== Object.prototype && prototype !== null) {", "if (false) {"),
    ("closed-null", "  if (typeof value !== 'object' || value === null) {\n    fail(`${label} must be a JSON object.`);", "  if (typeof value !== 'object') {\n    fail(`${label} must be a JSON object.`);"),
    ("list-max", "if (value.length > max) fail(", "if (false) fail("),
    ("token-case", "new RegExp(`^[a-z0-9_-]{1,", "new RegExp(`^[a-zA-Z0-9_-]{1,"),
    ("token-length", "{1,${LIMITS.maxTokenLength}}$`", "{1,${LIMITS.maxTokenLength + 1}}$`"),
    ("generation-bound", "    BigInt(value) > MAX_GENERATION\n", "    false\n"),
    ("generation-pattern", "const GENERATION_PATTERN = /^[1-9][0-9]{0,18}$/;", "const GENERATION_PATTERN = /^[0-9]{1,19}$/;"),
    ("signal-length", "const SIGNAL_PATTERN = /^SIG[A-Z0-9]{1,16}$/;", "const SIGNAL_PATTERN = /^SIG[A-Z0-9]{1,17}$/;"),
    ("mime-case", "/^[a-z0-9][a-z0-9.+-]*\\/[a-z0-9][a-z0-9.+-]*(?:;[\\x20-\\x7e]*)?$/", "/^[a-z0-9][a-z0-9.+-]*\\/[a-z0-9][a-z0-9.+-]*(?:;[\\x20-\\x7e]*)?$/i"),
    ("mime-parameters", "(?:;[\\x20-\\x7e]*)?$/", "(?:;.*)?$/"),
    ("mime-length", "    value.length > LIMITS.maxMimeTypeLength ||\n", ""),
    ("exit-min", "const MIN_EXIT_CODE = -(2 ** 31);", "const MIN_EXIT_CODE = -(2 ** 31) - 1;"),
    ("exit-max", "const MAX_EXIT_CODE = 2 ** 32 - 1;", "const MAX_EXIT_CODE = 2 ** 32;"),
    ("exit-integer", "    !Number.isInteger(value) ||\n", "    typeof value !== 'number' ||\n"),
    ("reference-kind", "if (ref.kind !== kind || ref.schemaVersion !== 1) {", "if (ref.schemaVersion !== 1) {"),
    ("reference-version", "if (ref.kind !== kind || ref.schemaVersion !== 1) {", "if (ref.kind !== kind) {"),
    ("reference-min", "(ref.byteLength < 1 || ref.byteLength > maxBytes)", "ref.byteLength > maxBytes"),
    ("reference-max", "(ref.byteLength < 1 || ref.byteLength > maxBytes)", "ref.byteLength < 1"),
    ("ranges-sealed", "const ranges = list(value, label, state === 'incomplete' ? 1 : 0);", "const ranges = list(value, label, 1);"),
    ("ranges-two", "const ranges = list(value, label, state === 'incomplete' ? 1 : 0);", "const ranges = list(value, label, state === 'incomplete' ? 2 : 0);"),
    ("range-start", "      if (start !== byteLength) {", "      if (false) {"),
    ("range-end", "count(end, `${label}[0].end`, start + 1)", "count(end, `${label}[0].end`, start)"),
    ("page-ref-count-max", "    1,\n    LIMITS.maxSegmentsPerPage,\n  );\n  return Object.freeze({\n    ref:", "    1,\n  );\n  return Object.freeze({\n    ref:"),
    ("page-ref-count-min", "    `${label}.segmentCount`,\n    1,", "    `${label}.segmentCount`,\n    0,"),
    ("page-ref-bytes-min", "      segmentCount,\n      segmentCount * LIMITS.maxSegmentBytes,", "      1,\n      segmentCount * LIMITS.maxSegmentBytes,"),
    ("page-ref-bytes-max", "      segmentCount,\n      segmentCount * LIMITS.maxSegmentBytes,", "      segmentCount,"),
    ("page-ref-max-bytes", "      MANAGED_TOOL_RESULT_KINDS.page,\n      LIMITS.maxPageBytes,", "      MANAGED_TOOL_RESULT_KINDS.page,"),
    ("body-one-form", "  if (forms.length !== 1) {", "  if (forms.length === 0) {"),
    ("body-ref-open", "    if (state === 'open') fail(", "    if (false) fail("),
    ("body-ref-length", "if (ref.byteLength !== byteLength || ref.digest !== streamDigest) {", "if (ref.digest !== streamDigest) {"),
    ("body-ref-digest", "if (ref.byteLength !== byteLength || ref.digest !== streamDigest) {", "if (ref.byteLength !== byteLength) {"),
    ("pages-sum", "if (pages.reduce((sum, page) => sum + page.byteLength, 0) !== byteLength) {", "if (false) {"),
    ("pages-max", "      LIMITS.maxPagesPerStream,\n    ).map", "      LIMITS.maxPagesPerStream + 1,\n    ).map"),
    ("status-complete-empty", "if (contents.length > 0 && contents.every((e) => e.state === 'sealed')) {", "if (contents.every((e) => e.state === 'sealed')) {"),
    ("status-unavailable-bytes", "(entry) => entry.state === 'incomplete' && entry.byteLength === 0,", "(entry) => entry.state === 'incomplete',"),
    ("status-unavailable-state", "(entry) => entry.state === 'incomplete' && entry.byteLength === 0,", "(entry) => entry.byteLength === 0,"),
    ("status-check", "  if (captureStatus !== impliedStatus(contents)) {", "  if (false) {"),
    ("reason-check", "    (captureReason === null) !==\n    (captureStatus === 'pending' || captureStatus === 'complete')", "    false"),
    ("reason-pending", "(captureStatus === 'pending' || captureStatus === 'complete')", "(captureStatus === 'complete')"),
    ("roles-unique-stream", "  if (streams.size !== contents.length) {", "  if (false) {"),
    ("roles-once", "    if (roles.filter((each) => each === role).length > 1) {", "    if (false) {"),
    ("roles-result-once", "for (const role of ['stdout', 'stderr', 'pty', 'result'] as const) {", "for (const role of ['stdout', 'stderr', 'pty'] as const) {"),
    ("roles-pty-scope", "      ? ['stdout', 'stderr']\n", "      ? ['stdout']\n"),
    ("roles-pipes-scope", "        ? ['pty']\n", "        ? []\n"),
    ("roles-native-scope", "        : ['stdout', 'stderr', 'pty'];", "        : ['stdout', 'stderr'];"),
    ("exit-unknown", "    captureScope === 'tool_native' || executionStatus === 'unknown'\n", "    captureScope === 'tool_native'\n"),
    ("exit-native", "      ? exitCode !== null || signal !== null", "      ? exitCode !== null"),
    ("exit-both", "      : exitCode !== null && signal !== null", "      : false"),
    ("manifest-token", "  exactly(manifest.toolResult, MANAGED_TOOL_RESULT_PROTOCOL, 'toolResult');\n", ""),
    ("manifest-type", "  exactly(manifest.type, 'manifest', 'manifest.type');\n", ""),
    ("revision-min", "revision: count(manifest.revision, 'manifest.revision', 1),", "revision: count(manifest.revision, 'manifest.revision'),"),
    ("json-limit", "  if (bytes.byteLength > maxBytes) {\n    fail(`record exceeds ${maxBytes} bytes.`);\n  }\n", ""),
    ("json-bom", "{ fatal: true, ignoreBOM: true }", "{ fatal: true }"),
    ("page-token", "  exactly(page.toolResult, MANAGED_TOOL_RESULT_PROTOCOL, 'page.toolResult');\n", ""),
    ("page-type", "  exactly(page.type, 'page', 'page.type');\n", ""),
    ("page-empty", "  if (segments.length === 0) fail('page.segments must not be empty.');\n", ""),
    ("page-first-ordinal", "    LIMITS.maxOrdinal + 1 - segments.length,", "    LIMITS.maxOrdinal,"),
    ("page-end", "  count(\n    offset + segments.reduce((sum, segment) => sum + segment.byteLength, 0),\n    'page end',\n  );\n", ""),
    ("segment-min", "        `page.segments[${index}].byteLength`,\n        1,", "        `page.segments[${index}].byteLength`,\n        0,"),
    ("segment-max", "        1,\n        LIMITS.maxSegmentBytes,\n      ),\n      digest:", "        1,\n      ),\n      digest:"),
    ("at-capture", "    parsedPage.captureId === parsedManifest.captureId &&", ""),
    ("at-stream", "    parsedPage.streamId === entry.streamId &&", ""),
    ("at-ordinal", "    parsedPage.firstOrdinal ===\n      earlier.reduce((sum, each) => sum + each.segmentCount, 0) &&", ""),
    ("at-offset", "    parsedPage.offset ===\n      earlier.reduce((sum, each) => sum + each.byteLength, 0) &&", ""),
    ("at-count", "    parsedPage.segments.length === slot.segmentCount &&", ""),
    ("at-bytes", "    parsedPage.segments.length === slot.segmentCount &&\n    parsedPage.segments.reduce((sum, each) => sum + each.byteLength, 0) ===\n      slot.byteLength", "    parsedPage.segments.length === slot.segmentCount"),
    ("desc-stream", "    previous.streamId !== next.streamId ||\n", ""),
    ("desc-role", "    previous.role !== next.role ||\n", ""),
    ("desc-mime", "    previous.role !== next.role ||\n    previous.mimeType !== next.mimeType", "    previous.role !== next.role"),
    ("desc-closed", "  if (previous.state !== 'open') return sameJson(previous, next);", "  if (previous.state !== 'open') return true;"),
    ("desc-pages-form", "    !after ||\n    (next.byteLength", "    false ||\n    (next.byteLength"),
    ("desc-digest", "    (next.byteLength === previous.byteLength &&\n      next.digest !== previous.digest) ||\n", ""),
    ("desc-pages-count", "    after.length < before.length\n", "    false\n"),
    ("desc-earlier-pages", "      ? sameJson(page, after[index])", "      ? true"),
    ("desc-last-count", "      : after[index].segmentCount >= page.segmentCount &&\n", "      : "),
    ("desc-last-bytes", "        after[index].byteLength >= page.byteLength,", "        true,"),
    ("succ-pending", "    before.captureStatus !== 'pending' ||\n", ""),
    ("succ-revision", "    after.revision !== before.revision + 1 ||", "    after.revision <= before.revision ||"),
    ("succ-fixed", "    FIXED_KEYS.some((key) => before[key] !== after[key]) ||\n", ""),
    ("succ-upstream", "    (before.upstreamTruncated && !after.upstreamTruncated) ||\n", ""),
    ("succ-length", "    after.contents.length < before.contents.length\n", "    false\n"),
    ("succ-settled-status", "    (before.executionStatus !== after.executionStatus ||\n", "    (false ||\n"),
    ("succ-settled-exit", "      before.exitCode !== after.exitCode ||\n", ""),
    ("succ-settled-signal", "      before.exitCode !== after.exitCode ||\n      before.signal !== after.signal)", "      before.exitCode !== after.exitCode)"),
    ("page-succ-capture", "    before.captureId === after.captureId &&", ""),
    ("page-succ-stream", "    before.streamId === after.streamId &&", ""),
    ("page-succ-ordinal", "    before.firstOrdinal === after.firstOrdinal &&", ""),
    ("page-succ-offset", "    before.offset === after.offset &&", ""),
    ("page-succ-segments", "        after.segments[index]?.byteLength === segment.byteLength &&\n        after.segments[index]?.digest === segment.digest,", "        after.segments[index] !== undefined,"),
    ("capture-reason", "  if ((captureReason === null) !== (captureStatus === 'complete')) {", "  if (false) {"),
    ("capture-manifest", "  if (manifest === null && captureStatus !== 'unavailable') {", "  if (false) {"),
    ("capture-pending", "    ['complete', 'partial', 'unavailable'] as const,", "    ['pending', 'complete', 'partial', 'unavailable'] as const,"),
    ("capture-manifest-kind", "      MANAGED_TOOL_RESULT_KINDS.manifest,\n      LIMITS.maxManifestBytes,", "      MANAGED_TOOL_RESULT_KINDS.page,\n      LIMITS.maxManifestBytes,"),
    ("envelope-not-started", "      ? exactly(result.capture, null, 'result.capture')", "      ? (result.capture as null)"),
    ("envelope-started", "      : parseCapture(result.capture);", "      : result.capture === null ? null : parseCapture(result.capture);"),
    ("envelope-parts", "  if (!Array.isArray(result.responseParts)) {", "  if (false) {"),
    ("envelope-error-text", "      if (typeof value !== 'string' || value.length === 0) {", "      if (typeof value !== 'string') {"),
    ("of-manifest", "    !!envelope?.capture?.manifest &&", "    !!envelope?.capture &&"),
    ("of-execution", "    parsed.executionStatus === envelope.executionStatus &&\n", ""),
    ("of-status", "    parsed.captureStatus === envelope.capture.captureStatus &&\n", ""),
    ("of-reason", "    parsed.captureStatus === envelope.capture.captureStatus &&\n    parsed.captureReason === envelope.capture.captureReason", "    parsed.captureStatus === envelope.capture.captureStatus"),
    ("publish-min", "        bytes.byteLength < 1 ||\n", ""),
    ("publish-max", "        bytes.byteLength > LIMITS.maxSegmentBytes\n", "        false\n"),
    ("publish-ordinal", "ordinal: count(value.ordinal, 'publish.ordinal', 0, LIMITS.maxOrdinal),", "ordinal: count(value.ordinal, 'publish.ordinal'),"),
    ("publish-copy", "        bytes: Uint8Array.from(bytes),", "        bytes,"),
    ("publish-digest", "    if (fields.expected !== null && fields.expected !== received) {", "    if (false) {"),
    ("publish-stored", "      return sha256([stored]) === received &&", "      return true &&"),
    ("publish-sealed", "    if (stream?.seal && fields.ordinal >= stream.seal.segmentCount) {", "    if (false) {"),
    ("publish-order", "    const received = sha256([fields.bytes]);\n    if (fields.expected !== null && fields.expected !== received) {\n      return refused('managed_tool_result_digest_mismatch');\n    }\n    const stream = this.#streams.get(fields.key);\n    const stored = stream?.segments.get(fields.ordinal);\n    if (stored) {", "    const received = sha256([fields.bytes]);\n    const stream = this.#streams.get(fields.key);\n    const stored = stream?.segments.get(fields.ordinal);\n    if (stored && sha256([stored]) === received) {\n      return ok(segmentReceipt(fields.ordinal, stored));\n    }\n    if (fields.expected !== null && fields.expected !== received) {\n      return refused('managed_tool_result_digest_mismatch');\n    }\n    if (stored) {"),
    ("seal-count-max", "          LIMITS.maxOrdinal + 1,\n        ),\n        byteLength", "        ),\n        byteLength"),
    ("seal-same", "      return sameJson(stream.seal, wanted)", "      return true"),
    ("seal-count", "      ordinals.length !== fields.segmentCount ||\n", ""),
    ("seal-extra", "      ordinals.some((ordinal) => ordinal >= fields.segmentCount)\n", "      false\n"),
    ("seal-length", "      chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0) !==\n        fields.byteLength ||\n", ""),
    ("seal-digest", "      sha256(chunks) !== fields.digest\n", "      false\n"),
    ("seal-record", "    stream.seal = Object.freeze(wanted);\n", ""),
    ("prefix-gap", "      chunk = stream?.segments.get(chunks.length)", "      chunk = [...(stream?.segments.values() ?? [])][chunks.length]"),
    ("prefix-sealed", "      sealed: stream?.seal !== undefined,", "      sealed: false,"),
    ("stream-key", "  return `${token(fields.captureId, 'captureId')}/${token(", "  return `${token(fields.streamId, 'captureId')}/${token("),
]


def run():
    original = open(FILE).read()
    survivors = []
    wanted = set(sys.argv[1:])
    try:
        for name, old, new in MUTANTS:
            if wanted and name not in wanted:
                continue
            if original.count(old) != 1:
                print(f"SKIP {name}: found {original.count(old)} times", flush=True)
                survivors.append(f"{name} (unapplied)")
                continue
            open(FILE, "w").write(original.replace(old, new))
            result = subprocess.run(
                ["npx", "vitest", "run", TEST, "--reporter=dot"],
                cwd=ROOT, capture_output=True, text=True, timeout=600)
            killed = result.returncode != 0
            print(f"{'killed ' if killed else 'SURVIVED'} {name}", flush=True)
            if not killed:
                survivors.append(name)
    finally:
        open(FILE, "w").write(original)
    print("survivors:", survivors)


if __name__ == "__main__":
    run()
