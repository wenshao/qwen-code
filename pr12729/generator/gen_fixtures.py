#!/usr/bin/env python3
"""Builds managed-tool-result-v1.fixtures.json from the O1a design document.

Written from the design document alone, independent of the TypeScript module
and the Java test. Every invalid case changes a valid base to target one
rule, and every digest is computed here from the bytes it describes.
"""

import base64
import copy
import hashlib
import json
import re
import sys

TOKEN = "managed-tool-result/1"
KIND_MANIFEST = "managed-tool-result-manifest"
KIND_PAGE = "managed-tool-result-page"
KIND_CONTENT = "managed-tool-result-content"
MIB = 1024 * 1024
LIMITS = {
    "maxManifestBytes": 65536,
    "maxPageBytes": 262144,
    "maxContents": 32,
    "maxPagesPerStream": 64,
    "maxSegmentsPerPage": 1024,
    "maxSegmentBytes": 16 * MIB,
    "maxOrdinal": 65535,
    "maxMimeTypeLength": 255,
    "maxIdBytes": 512,
    "maxTokenLength": 128,
}
ROUTES = [
    {
        "key": key,
        "method": "POST",
        "path": f"/internal/managed-runtime/v3/{key}",
        "protocolVersion": 3,
        "requestBodyLimitBytes": 262144 if key == "execute" else 16384,
        "responseBodyLimitBytes": 1048576,
        "cacheControl": "no-store",
    }
    for key in ["execute", "status", "cancel", "acknowledge"]
]
ERRORS = [
    {"status": 401, "code": "managed_runtime_unauthorized", "classification": "credentials"},
    {"status": 400, "code": "managed_runtime_attestation_invalid", "classification": "protocol"},
    {"status": 413, "code": "managed_runtime_attestation_too_large", "classification": "protocol"},
    {"status": 409, "code": "managed_runtime_identity_conflict", "classification": "identity"},
    {"status": 409, "code": "managed_tool_result_conflict", "classification": "identity"},
    {"status": 404, "code": None, "classification": "incompatible"},
    {"status": None, "code": "managed_tool_result_invalid", "classification": "protocol"},
    {"status": None, "code": "managed_tool_result_conflict", "classification": "identity"},
    {"status": None, "code": "managed_tool_result_digest_mismatch", "classification": "integrity"},
]


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def text_digest(label: str) -> str:
    return sha(label.encode())


EMPTY = sha(b"")


def compact(value) -> bytes:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()


def durable(resource_id, kind, byte_length, digest, schema_version=1):
    return {
        "resourceId": resource_id,
        "kind": kind,
        "schemaVersion": schema_version,
        "byteLength": byte_length,
        "digest": digest,
    }


# The canonical stdout: three segments with a non-UTF-8 byte and a euro sign
# split across two segments.
SEGMENTS = [b"ab\xff", b"\xe2\x82", b"\xacxyz"]
STDOUT = b"".join(SEGMENTS)


def page(capture_id, stream_id, first, offset, segments):
    return {
        "toolResult": TOKEN,
        "type": "page",
        "captureId": capture_id,
        "streamId": stream_id,
        "firstOrdinal": first,
        "offset": offset,
        "segments": [{"byteLength": len(s), "digest": sha(s)} for s in segments],
    }


def page_ref(resource_id, body):
    raw = compact(body)
    return {
        "ref": durable(resource_id, KIND_PAGE, len(raw), sha(raw)),
        "segmentCount": len(body["segments"]),
        "byteLength": sum(s["byteLength"] for s in body["segments"]),
    }


PAGE0 = page("capture-01", "stdout", 0, 0, SEGMENTS[:2])
PAGE1 = page("capture-01", "stdout", 2, 5, SEGMENTS[2:])
PAGE0_REF = page_ref("page-stdout-0", PAGE0)
PAGE1_REF = page_ref("page-stdout-1", PAGE1)


def descriptor(stream_id, role, mime, state, data, body, missing=None):
    return {
        "streamId": stream_id,
        "role": role,
        "mimeType": mime,
        "state": state,
        "byteLength": len(data),
        "digest": sha(data),
        "missingRanges": missing or [],
        "body": body,
    }


def content_ref(resource_id, data):
    return {"ref": durable(resource_id, KIND_CONTENT, len(data), sha(data))}


STDOUT_DESCRIPTOR = descriptor(
    "stdout", "stdout", "application/octet-stream", "sealed", STDOUT,
    {"pages": [PAGE0_REF, PAGE1_REF]},
)
STDERR_DESCRIPTOR = descriptor(
    "stderr", "stderr", "text/plain; charset=utf-8", "sealed", b"", {"pages": []},
)

MANIFEST = {
    "toolResult": TOKEN,
    "type": "manifest",
    "tenantId": "tenant-a",
    "sessionId": "session-a",
    "turnId": "turn-1",
    "executionCallId": "exec-1",
    "callId": "call-01",
    "invocationDigest": "sha256:" + "0123456789abcdef" * 4,
    "bindingGeneration": "3",
    "captureId": "capture-01",
    "revision": 2,
    "executionStatus": "success",
    "exitCode": 0,
    "signal": None,
    "captureScope": "process_pipes",
    "capturePolicy": "complete_required",
    "captureStatus": "complete",
    "captureReason": None,
    "upstreamTruncated": False,
    "contents": [STDOUT_DESCRIPTOR, STDERR_DESCRIPTOR],
}
MANIFEST_KEYS = list(MANIFEST.keys())
DESCRIPTOR_KEYS = list(STDOUT_DESCRIPTOR.keys())

# Revision 1 of the canonical capture: stdout open with its first page, the
# process still running.
OPEN_STDOUT = descriptor(
    "stdout", "stdout", "application/octet-stream", "open", b"".join(SEGMENTS[:2]),
    {"pages": [PAGE0_REF]},
)
OPEN_STDERR = descriptor(
    "stderr", "stderr", "text/plain; charset=utf-8", "open", b"", {"pages": []},
)
PENDING = dict(
    MANIFEST,
    revision=1,
    executionStatus="unknown",
    exitCode=None,
    captureStatus="pending",
    contents=[OPEN_STDOUT, OPEN_STDERR],
)


def with_(base, **changes):
    value = copy.deepcopy(base)
    value.update(copy.deepcopy(changes))
    return value


def without(base, key):
    value = copy.deepcopy(base)
    del value[key]
    return value


def with_content(base, index, **changes):
    value = copy.deepcopy(base)
    value["contents"][index].update(copy.deepcopy(changes))
    return value


def manifest_cases():
    cases = []

    def add(case_id, manifest, valid):
        cases.append({"id": case_id, "manifest": manifest, "valid": valid})

    add("canonical", MANIFEST, True)
    add("pending-open-streams", PENDING, True)
    pty_bytes = b"$ make\r\n\x1b[32mok\x1b[0m\r\n"
    add(
        "pty-transcript-as-one-resource",
        with_(
            MANIFEST,
            captureScope="process_pty",
            contents=[descriptor(
                "pty", "pty", "application/octet-stream", "sealed", pty_bytes,
                content_ref("content-pty", pty_bytes),
            )],
        ),
        True,
    )
    result_bytes = b'{"matches":3}'
    native = with_(
        MANIFEST,
        captureScope="tool_native",
        exitCode=None,
        contents=[
            descriptor("result", "result", "application/json", "sealed",
                       result_bytes, content_ref("content-result", result_bytes)),
            descriptor("attachment-1", "attachment", "image/png", "sealed",
                       b"\x89PNG", content_ref("content-a1", b"\x89PNG")),
            descriptor("attachment-2", "attachment", "application/pdf", "sealed",
                       b"%PDF", content_ref("content-a2", b"%PDF")),
        ],
    )
    add("tool-native-result-and-attachments", native, True)
    add("zero-byte-resource-body", with_content(
        MANIFEST, 1, body=content_ref("content-empty", b"")), True)
    partial = with_content(
        MANIFEST, 0, state="incomplete",
        missingRanges=[{"start": len(STDOUT), "end": 4096}],
    )
    partial.update(captureStatus="partial", captureReason="quota_exhausted")
    add("partial-with-a-known-missing-range", partial, True)
    add("partial-with-an-unknown-end", with_content(
        partial, 0, missingRanges=[{"start": len(STDOUT), "end": None}]), True)
    add("partial-with-unknown-missing-bytes",
        with_content(partial, 0, missingRanges=[]), True)
    add("partial-under-best-effort",
        with_(partial, capturePolicy="best_effort"), True)
    add("partial-with-an-unknown-outcome", with_(
        partial, executionStatus="unknown", exitCode=None,
        captureReason="producer_lost"), True)
    add("unavailable-without-contents", with_(
        MANIFEST, captureStatus="unavailable", captureReason="storage_failed",
        contents=[]), True)
    empty_incomplete = descriptor(
        "stdout", "stdout", "application/octet-stream", "incomplete", b"",
        {"pages": []}, [{"start": 0, "end": None}])
    add("unavailable-with-empty-incomplete-streams", with_(
        MANIFEST, captureStatus="unavailable", captureReason="size_limit",
        contents=[empty_incomplete, dict(copy.deepcopy(empty_incomplete),
                                         streamId="stderr", role="stderr",
                                         missingRanges=[])]), True)
    add("ended-by-a-signal", with_(
        MANIFEST, executionStatus="cancelled", exitCode=None, signal="SIGTERM"),
        True)
    add("longest-signal", with_(MANIFEST, exitCode=None,
                                signal="SIG" + "A1" * 8), True)
    add("smallest-exit-code", with_(MANIFEST, exitCode=-2147483648), True)
    add("largest-exit-code", with_(MANIFEST, exitCode=4294967295), True)
    add("no-exit-information", with_(MANIFEST, exitCode=None), True)
    add("upstream-truncated-but-complete",
        with_(MANIFEST, upstreamTruncated=True), True)
    add("error-outcome", with_(MANIFEST, executionStatus="error", exitCode=2),
        True)
    add("largest-revision", with_(MANIFEST, revision=2**53 - 2), True)
    add("largest-generation",
        with_(MANIFEST, bindingGeneration="9223372036854775807"), True)
    add("longest-ids", with_(
        MANIFEST, tenantId="t" * 512, sessionId="é" * 256,
        turnId="\U0001d11e" * 128, executionCallId="e" * 512,
        callId="c" * 512, invocationDigest="d" * 512), True)
    add("non-ascii-nfc-ids", with_(MANIFEST, sessionId="séance-会话"),
        True)
    add("longest-tokens", with_content(
        with_(MANIFEST, captureId="c" * 128), 0, streamId="s" * 128), True)
    add("mime-type-with-parameters", with_content(
        MANIFEST, 0, mimeType="text/plain; charset=utf-8; format=flowed"), True)
    add("longest-mime-type", with_content(
        MANIFEST, 0, mimeType="application/" + "x" * 243), True)
    add("mime-type-with-suffix", with_content(
        MANIFEST, 0, mimeType="application/vnd.qwen.tool-result+json"), True)
    many = with_(native, contents=[
        descriptor(f"attachment-{i}", "attachment", "application/octet-stream",
                   "sealed", b"", {"pages": []})
        for i in range(32)
    ])
    add("thirty-two-contents", many, True)
    add("largest-page-and-segment", with_content(
        MANIFEST, 0,
        byteLength=1024 * 16 * MIB,
        body={"pages": [{"ref": PAGE0_REF["ref"], "segmentCount": 1024,
                         "byteLength": 1024 * 16 * MIB}]}), True)
    add("sixty-four-pages", with_content(
        MANIFEST, 0, byteLength=64,
        body={"pages": [{"ref": dict(PAGE0_REF["ref"], resourceId=f"p{i}"),
                         "segmentCount": 1, "byteLength": 1}
                        for i in range(64)]}), True)
    add("page-reference-at-its-byte-limits", with_content(
        MANIFEST, 0, body={"pages": [
            dict(PAGE0_REF, ref=dict(PAGE0_REF["ref"], byteLength=1)),
            dict(PAGE1_REF, ref=dict(PAGE1_REF["ref"], byteLength=262144)),
        ]}), True)
    add("pending-with-an-incomplete-stream", with_content(
        PENDING, 1, state="incomplete"), True)
    add("pending-with-a-settled-outcome", with_(
        PENDING, executionStatus="success", exitCode=0), True)
    add("complete-with-a-best-effort-policy",
        with_(MANIFEST, capturePolicy="best_effort"), True)

    # Shape.
    for value, name in [([], "array"), (None, "null"), ("manifest", "string"),
                        (7, "number")]:
        add(f"{name}-manifest", value, False)
    for key in MANIFEST_KEYS:
        add(f"missing-{key}", without(MANIFEST, key), False)
    add("extra-key", with_(MANIFEST, extra=True), False)
    add("other-token", with_(MANIFEST, toolResult="managed-tool-result/2"),
        False)
    add("page-type", with_(MANIFEST, type="page"), False)

    # Ids.
    id_fields = ["tenantId", "sessionId", "turnId", "executionCallId",
                 "callId", "invocationDigest"]
    bad_ids = [
        ("empty", ""),
        ("over-512-bytes", "t" * 513),
        ("two-byte-over-512-bytes", "é" * 256 + "t"),
        ("nul", "a\u0000b"),
        ("unit-separator", "a\u001fb"),
        ("del", "a\u007fb"),
        ("c1-control", "a\u0085b"),
        ("not-nfc", "é"),
        ("lone-high-surrogate", "a\ud800"),
        ("lone-low-surrogate", "\udc00a"),
        ("number", 7),
        ("null", None),
    ]
    # Every variant on one field, and the distinct checks on the others.
    for field in id_fields:
        for name, value in bad_ids:
            if field == "tenantId" or name in (
                    "empty", "over-512-bytes", "not-nfc",
                    "lone-high-surrogate", "number"):
                add(f"{field}-{name}", with_(MANIFEST, **{field: value}),
                    False)

    # Tokens.
    bad_tokens = [("empty", ""), ("uppercase", "Capture-01"),
                  ("over-128", "c" * 129), ("slash", "a/b"), ("dot", "a.b"),
                  ("dot-dot", ".."), ("space", "a b"), ("colon", "a:b"),
                  ("non-ascii", "é"), ("number", 1)]
    for name, value in bad_tokens:
        add(f"captureId-{name}", with_(MANIFEST, captureId=value), False)
        add(f"streamId-{name}", with_content(MANIFEST, 0, streamId=value), False)

    # Generation.
    for name, value in [("zero", "0"), ("leading-zero", "03"), ("sign", "+3"),
                        ("over-int64", "9223372036854775808"),
                        ("fraction", "3.0"), ("number", 3),
                        ("non-ascii-digit", "٣"), ("empty", ""),
                        ("space", " 3"), ("negative", "-3")]:
        add(f"generation-{name}", with_(MANIFEST, bindingGeneration=value),
            False)

    # Revision.
    for name, value in [("zero", 0), ("negative", -1), ("fraction", 1.5),
                        ("string", "2"), ("max-safe-integer", 2**53 - 1),
                        ("over-safe-integer", 2**53), ("boolean", True),
                        ("null", None)]:
        add(f"revision-{name}", with_(MANIFEST, revision=value), False)

    # Enumerations.
    for field, values in [
        ("executionStatus", ["not_started", "running", "SUCCESS", None]),
        ("captureScope", ["pty", "process", None]),
        ("capturePolicy", ["complete", "required", None]),
        ("captureStatus", ["failed", "Complete", None]),
    ]:
        for value in values:
            name = "null" if value is None else value
            add(f"{field}-{name}", with_(MANIFEST, **{field: value}), False)
    for value in ["upstream_truncated", "unknown", ""]:
        add(f"captureReason-{value or 'empty'}",
            with_(partial, captureReason=value), False)
    for name, value in [("string", "false"), ("number", 0), ("null", None)]:
        add(f"upstreamTruncated-{name}",
            with_(MANIFEST, upstreamTruncated=value), False)

    # Exit.
    for name, value in [("fraction", 1.5), ("string", "0"),
                        ("below-int32", -2147483649),
                        ("over-uint32", 4294967296), ("boolean", False)]:
        add(f"exitCode-{name}", with_(MANIFEST, exitCode=value), False)
    for name, value in [("no-prefix", "TERM"), ("lowercase", "SIGterm"),
                        ("prefix-only", "SIG"), ("too-long", "SIG" + "A" * 17),
                        ("number", 15), ("empty", "")]:
        add(f"signal-{name}", with_(MANIFEST, exitCode=None, signal=value),
            False)
    add("exit-code-and-signal", with_(MANIFEST, signal="SIGKILL"), False)
    add("unknown-outcome-without-exit-information", with_(
        MANIFEST, executionStatus="unknown", exitCode=None), True)
    add("unknown-outcome-with-an-exit-code", with_(
        MANIFEST, executionStatus="unknown", exitCode=137), False)
    add("unknown-outcome-with-a-signal", with_(
        MANIFEST, executionStatus="unknown", exitCode=None, signal="SIGKILL"),
        False)
    add("unknown-outcome-with-an-exit-code-under-best-effort", with_(
        MANIFEST, executionStatus="unknown", exitCode=0,
        capturePolicy="best_effort"), False)
    add("tool-native-with-an-exit-code", with_(native, exitCode=0), False)
    add("tool-native-with-a-signal", with_(native, signal="SIGTERM"), False)

    # Contents.
    add("contents-not-an-array", with_(MANIFEST, contents={}), False)
    add("thirty-three-contents", with_(many, contents=many["contents"] + [
        descriptor("attachment-32", "attachment", "application/octet-stream",
                   "sealed", b"", {"pages": []})]), False)
    add("descriptor-not-an-object", with_(MANIFEST, contents=[[]]), False)
    for key in DESCRIPTOR_KEYS:
        value = copy.deepcopy(MANIFEST)
        del value["contents"][0][key]
        add(f"descriptor-missing-{key}", value, False)
    add("descriptor-extra-key", with_content(MANIFEST, 0, extra=1), False)
    add("duplicate-stream-id", with_content(MANIFEST, 1, streamId="stdout"),
        False)
    add("two-stdout-streams", with_content(MANIFEST, 1, role="stdout"), False)
    add("two-results", with_(native, contents=[
        native["contents"][0],
        dict(copy.deepcopy(native["contents"][0]), streamId="result-2")]), False)
    add("two-pty-streams", with_(
        MANIFEST, captureScope="process_pty", contents=[
            dict(copy.deepcopy(STDERR_DESCRIPTOR), streamId="pty", role="pty"),
            dict(copy.deepcopy(STDERR_DESCRIPTOR), streamId="pty-2", role="pty"),
        ]), False)
    add("role-unknown", with_content(MANIFEST, 1, role="hook_outcome"), False)
    add("pty-under-pipes", with_content(MANIFEST, 1, role="pty"), False)
    add("stdout-under-pty", with_(MANIFEST, captureScope="process_pty"), False)
    pty_stream = descriptor("pty", "pty", "application/octet-stream", "sealed",
                            b"x", content_ref("content-pty", b"x"))
    add("stderr-under-pty", with_(MANIFEST, captureScope="process_pty",
                                  contents=[pty_stream, STDERR_DESCRIPTOR]),
        False)
    add("stderr-under-tool-native", with_(
        native, contents=native["contents"] + [STDERR_DESCRIPTOR]), False)
    add("pty-under-tool-native", with_(native, contents=native["contents"] + [
        dict(copy.deepcopy(STDERR_DESCRIPTOR), streamId="pty", role="pty")]),
        False)
    for name, value in [("uppercase", "Text/Plain"), ("no-slash", "text"),
                        ("empty-subtype", "text/"), ("empty-type", "/plain"),
                        ("over-255", "application/" + "x" * 244),
                        ("control", "text/plain;\u0001"),
                        ("non-ascii-parameter", "text/plain; name=é"),
                        ("space-before-slash", "text /plain"),
                        ("two-slashes", "text/plain/x"),
                        ("empty", ""), ("number", 1),
                        ("leading-dot", "application/.x")]:
        add(f"mimeType-{name}", with_content(MANIFEST, 0, mimeType=value), False)
    add("state-unknown", with_content(MANIFEST, 0, state="closed"), False)
    for name, value in [("negative", -1), ("fraction", 1.5), ("string", "9"),
                        ("max-safe-integer", 2**53 - 1)]:
        add(f"byteLength-{name}", with_content(MANIFEST, 0, byteLength=value),
            False)
    for name, value in [("uppercase", sha(STDOUT).upper()),
                        ("short", sha(STDOUT)[:63]),
                        ("prefixed", "sha256:" + sha(STDOUT)), ("number", 1)]:
        add(f"digest-{name}", with_content(MANIFEST, 0, digest=value), False)

    # Missing ranges.
    add("missing-ranges-not-an-array",
        with_content(partial, 0, missingRanges={}), False)
    add("missing-range-on-a-sealed-stream", with_content(
        MANIFEST, 0, missingRanges=[{"start": len(STDOUT), "end": None}]), False)
    add("missing-range-on-an-open-stream", with_content(
        PENDING, 0, missingRanges=[{"start": 5, "end": None}]), False)
    add("two-missing-ranges", with_content(partial, 0, missingRanges=[
        {"start": len(STDOUT), "end": 20}, {"start": 30, "end": None}]), False)
    add("two-missing-ranges-from-the-stored-length", with_content(
        partial, 0, missingRanges=[{"start": len(STDOUT), "end": 20},
                                   {"start": len(STDOUT), "end": None}]),
        False)
    add("missing-range-inside-stored-bytes", with_content(
        partial, 0, missingRanges=[{"start": 3, "end": None}]), False)
    add("missing-range-after-a-gap", with_content(
        partial, 0, missingRanges=[{"start": len(STDOUT) + 1, "end": None}]),
        False)
    add("missing-range-empty", with_content(partial, 0, missingRanges=[
        {"start": len(STDOUT), "end": len(STDOUT)}]), False)
    add("missing-range-reversed", with_content(partial, 0, missingRanges=[
        {"start": len(STDOUT), "end": 2}]), False)
    add("missing-range-extra-key", with_content(partial, 0, missingRanges=[
        {"start": len(STDOUT), "end": None, "reason": "quota"}]), False)
    add("missing-range-without-end", with_content(partial, 0, missingRanges=[
        {"start": len(STDOUT)}]), False)
    add("missing-range-string-start", with_content(partial, 0, missingRanges=[
        {"start": str(len(STDOUT)), "end": None}]), False)
    add("missing-range-fraction-end", with_content(partial, 0, missingRanges=[
        {"start": len(STDOUT), "end": 20.5}]), False)
    add("missing-range-not-an-object",
        with_content(partial, 0, missingRanges=[9]), False)

    # Bodies.
    both = {"pages": [PAGE0_REF, PAGE1_REF],
            "ref": content_ref("x", STDOUT)["ref"]}
    add("body-with-both-forms", with_content(MANIFEST, 0, body=both), False)
    add("body-empty", with_content(MANIFEST, 0, body={}), False)
    add("body-null", with_content(MANIFEST, 0, body=None), False)
    add("body-extra-key", with_content(
        MANIFEST, 0, body={"pages": [PAGE0_REF, PAGE1_REF], "extra": 1}), False)
    add("resource-body-for-an-open-stream", with_content(
        PENDING, 0, body=content_ref("content-open", b"".join(SEGMENTS[:2]))),
        False)
    add("resource-body-length-mismatch", with_content(MANIFEST, 0, body={
        "ref": durable("c", KIND_CONTENT, len(STDOUT) + 1, sha(STDOUT))}), False)
    add("resource-body-digest-mismatch", with_content(MANIFEST, 0, body={
        "ref": durable("c", KIND_CONTENT, len(STDOUT), EMPTY)}), False)
    add("resource-body-page-kind", with_content(MANIFEST, 0, body={
        "ref": durable("c", KIND_PAGE, len(STDOUT), sha(STDOUT))}), False)
    add("resource-body-schema-version-2", with_content(MANIFEST, 0, body={
        "ref": durable("c", KIND_CONTENT, len(STDOUT), sha(STDOUT), 2)}), False)
    add("resource-body-ref-extra-key", with_content(MANIFEST, 0, body={
        "ref": dict(durable("c", KIND_CONTENT, len(STDOUT), sha(STDOUT)),
                    extra=1)}), False)
    add("resource-body-ref-empty-id", with_content(MANIFEST, 0, body={
        "ref": durable("", KIND_CONTENT, len(STDOUT), sha(STDOUT))}), False)
    add("pages-not-an-array", with_content(MANIFEST, 0, body={"pages": {}}),
        False)
    add("sixty-five-pages", with_content(
        MANIFEST, 0, byteLength=65,
        body={"pages": [{"ref": dict(PAGE0_REF["ref"], resourceId=f"p{i}"),
                         "segmentCount": 1, "byteLength": 1}
                        for i in range(65)]}), False)
    page_ref_keys = list(PAGE0_REF.keys())
    for key in page_ref_keys:
        pages = copy.deepcopy([PAGE0_REF, PAGE1_REF])
        del pages[0][key]
        add(f"page-reference-missing-{key}",
            with_content(MANIFEST, 0, body={"pages": pages}), False)

    def with_page(index, **changes):
        pages = copy.deepcopy([PAGE0_REF, PAGE1_REF])
        pages[index].update(copy.deepcopy(changes))
        return with_content(MANIFEST, 0, body={"pages": pages})

    add("page-reference-extra-key", with_page(0, extra=1), False)
    add("page-reference-not-an-object", with_content(
        MANIFEST, 0, body={"pages": [PAGE0_REF, "page-stdout-1"]}), False)
    add("page-reference-content-kind", with_page(
        0, ref=dict(PAGE0_REF["ref"], kind=KIND_CONTENT)), False)
    add("page-reference-manifest-kind", with_page(
        0, ref=dict(PAGE0_REF["ref"], kind=KIND_MANIFEST)), False)
    add("page-reference-schema-version-2", with_page(
        0, ref=dict(PAGE0_REF["ref"], schemaVersion=2)), False)
    add("page-reference-empty-page", with_page(
        0, ref=dict(PAGE0_REF["ref"], byteLength=0)), False)
    add("page-reference-over-256-kib", with_page(
        0, ref=dict(PAGE0_REF["ref"], byteLength=262145)), False)
    add("page-reference-uppercase-digest", with_page(
        0, ref=dict(PAGE0_REF["ref"], digest=PAGE0_REF["ref"]["digest"].upper())),
        False)
    add("page-without-segments", with_page(0, segmentCount=0), False)
    add("empty-page-reference", with_content(MANIFEST, 1, body={"pages": [
        {"ref": PAGE0_REF["ref"], "segmentCount": 0, "byteLength": 0}]}),
        False)
    add("page-over-1024-segments", with_content(
        MANIFEST, 0, byteLength=1025, body={"pages": [
            {"ref": PAGE0_REF["ref"], "segmentCount": 1025,
             "byteLength": 1025}]}), False)
    add("page-shorter-than-its-segment-count", with_page(0, segmentCount=6),
        False)
    add("page-longer-than-its-segments-allow", with_content(
        MANIFEST, 0, byteLength=16 * MIB + 1,
        body={"pages": [{"ref": PAGE0_REF["ref"], "segmentCount": 1,
                         "byteLength": 16 * MIB + 1}]}), False)
    add("page-segment-count-fraction", with_page(0, segmentCount=1.5), False)
    add("page-byte-length-string", with_page(0, byteLength="5"), False)
    add("pages-add-up-to-less", with_page(1, byteLength=3, segmentCount=1),
        False)
    add("pages-add-up-to-more", with_page(1, byteLength=5), False)
    add("no-pages-for-stored-bytes", with_content(
        MANIFEST, 0, body={"pages": []}), False)
    add("pages-for-an-empty-stream", with_content(
        MANIFEST, 1, body={"pages": [PAGE0_REF]}), False)

    # Status and reason.
    add("complete-with-an-open-stream", with_(
        PENDING, captureStatus="complete"), False)
    add("complete-with-an-incomplete-stream", with_(
        partial, captureStatus="complete", captureReason=None), False)
    add("complete-without-contents", with_(MANIFEST, contents=[]), False)
    add("pending-without-an-open-stream", with_(
        MANIFEST, captureStatus="pending"), False)
    add("pending-without-contents", with_(
        MANIFEST, captureStatus="pending", contents=[]), False)
    add("partial-with-every-stream-sealed", with_(
        MANIFEST, captureStatus="partial", captureReason="quota_exhausted"),
        False)
    add("partial-with-an-open-stream", with_(
        PENDING, captureStatus="partial", captureReason="quota_exhausted"),
        False)
    unavailable = with_(MANIFEST, captureStatus="unavailable",
                        captureReason="size_limit",
                        contents=[copy.deepcopy(empty_incomplete)])
    add("partial-with-nothing-stored",
        with_(unavailable, captureStatus="partial"), False)
    add("unavailable-with-stored-bytes", with_(
        partial, captureStatus="unavailable"), False)
    add("unavailable-with-a-sealed-empty-stream", with_(
        unavailable, contents=[copy.deepcopy(empty_incomplete),
                               copy.deepcopy(STDERR_DESCRIPTOR)]), False)
    add("unavailable-with-an-open-stream", with_(
        PENDING, captureStatus="unavailable", captureReason="size_limit"),
        False)
    add("partial-without-a-reason", with_(partial, captureReason=None), False)
    add("unavailable-without-a-reason",
        with_(unavailable, captureReason=None), False)
    add("complete-with-a-reason",
        with_(MANIFEST, captureReason="size_limit"), False)
    add("pending-with-a-reason",
        with_(PENDING, captureReason="producer_lost"), False)
    return cases


def manifest_text_cases():
    cases = []
    canonical = json.dumps(MANIFEST, ensure_ascii=False)

    cases.append({"id": "canonical", "text": canonical, "valid": True})
    cases.append({"id": "exactly-64-kib", "text": canonical,
                  "padToBytes": 65536, "valid": True})
    cases.append({"id": "over-64-kib", "text": canonical,
                  "padToBytes": 65537, "valid": False})
    cases.append({"id": "duplicate-key",
                  "text": canonical[:-1] + ', "revision": 3}', "valid": False})
    cases.append({"id": "not-json", "text": canonical[:-1], "valid": False})
    cases.append({"id": "byte-order-mark", "text": "﻿" + canonical,
                  "valid": False})
    cases.append({"id": "invalid-manifest", "text": json.dumps(
        with_(MANIFEST, revision=0)), "valid": False})
    return cases


def page_cases():
    cases = []

    def add(case_id, value, valid, repeat=None):
        case = {"id": case_id, "page": value, "valid": valid}
        if repeat is not None:
            case["repeatSegments"] = repeat
        cases.append(case)

    add("canonical", PAGE0, True)
    add("second-page", PAGE1, True)
    add("largest", dict(PAGE0, firstOrdinal=64512,
                        offset=2**53 - 2 - 1024 * 16 * MIB,
                        segments=[{"byteLength": 16 * MIB, "digest": EMPTY}]),
        True, 1024)
    add("smallest-segment", dict(PAGE0, segments=[
        {"byteLength": 1, "digest": sha(b"a")}]), True)
    for value, name in [([], "array"), (None, "null"), ("page", "string")]:
        add(f"{name}-page", value, False)
    for key in PAGE0:
        add(f"missing-{key}", without(PAGE0, key), False)
    add("extra-key", dict(PAGE0, extra=1), False)
    add("other-token", dict(PAGE0, toolResult="managed-tool-result/2"), False)
    add("manifest-type", dict(PAGE0, type="manifest"), False)
    add("captureId-uppercase", dict(PAGE0, captureId="Capture-01"), False)
    add("streamId-slash", dict(PAGE0, streamId="std/out"), False)
    for field in ["firstOrdinal", "offset"]:
        for name, value in [("negative", -1), ("fraction", 0.5),
                            ("string", "0"), ("max-safe-integer", 2**53 - 1)]:
            add(f"{field}-{name}", dict(PAGE0, **{field: value}), False)
    add("first-ordinal-past-the-last", dict(PAGE0, firstOrdinal=65535,
                                            segments=PAGE0["segments"]), False)
    add("ends-at-the-last-ordinal", dict(PAGE0, firstOrdinal=65534), True)
    add("ends-past-the-largest-count", dict(PAGE0, offset=2**53 - 6), False)
    add("ends-at-the-largest-count", dict(PAGE0, offset=2**53 - 7), True)
    add("no-segments", dict(PAGE0, segments=[]), False)
    add("over-1024-segments", dict(PAGE0, segments=[
        {"byteLength": 1, "digest": EMPTY}]), False, 1025)
    add("segments-not-an-array", dict(PAGE0, segments={}), False)
    for name, value in [("empty", 0), ("over-16-mib", 16 * MIB + 1),
                        ("fraction", 1.5), ("string", "3")]:
        add(f"segment-length-{name}", dict(PAGE0, segments=[
            {"byteLength": value, "digest": EMPTY}]), False)
    add("segment-digest-uppercase", dict(PAGE0, segments=[
        {"byteLength": 3, "digest": sha(b"x").upper()}]), False)
    add("segment-extra-key", dict(PAGE0, segments=[
        {"byteLength": 3, "digest": sha(b"x"), "ordinal": 0}]), False)
    add("segment-missing-digest", dict(PAGE0, segments=[{"byteLength": 3}]),
        False)
    add("segment-not-an-object", dict(PAGE0, segments=[3]), False)
    return cases


def page_text_cases():
    canonical = json.dumps(PAGE0)
    return [
        {"id": "canonical", "text": canonical, "valid": True},
        {"id": "exactly-256-kib", "text": canonical, "padToBytes": 262144,
         "valid": True},
        {"id": "over-256-kib", "text": canonical, "padToBytes": 262145,
         "valid": False},
        {"id": "duplicate-key", "text": canonical[:-1] + ', "offset": 1}',
         "valid": False},
    ]


def page_position_cases():
    cases = []

    def add(case_id, stream, index, value, valid, manifest=MANIFEST):
        cases.append({"id": case_id, "manifest": manifest, "streamIndex": stream,
                      "pageIndex": index, "page": value, "valid": valid})

    add("first-page", 0, 0, PAGE0, True)
    add("second-page", 0, 1, PAGE1, True)
    add("first-page-in-the-second-place", 0, 1, PAGE0, False)
    add("second-page-in-the-first-place", 0, 0, PAGE1, False)
    add("other-capture", 0, 0, dict(PAGE0, captureId="capture-02"), False)
    add("other-stream", 0, 0, dict(PAGE0, streamId="stderr"), False)
    add("other-first-ordinal", 0, 1, dict(PAGE1, firstOrdinal=3), False)
    add("other-offset", 0, 1, dict(PAGE1, offset=4), False)
    add("fewer-segments", 0, 0, dict(PAGE0, segments=PAGE0["segments"][:1]),
        False)
    add("more-segments", 0, 0, dict(PAGE0, segments=PAGE0["segments"] + [
        {"byteLength": 1, "digest": EMPTY}]), False)
    add("fewer-segments-with-the-same-bytes", 0, 0, dict(PAGE0, segments=[
        {"byteLength": 5, "digest": EMPTY}]), False)
    add("more-segments-with-the-same-bytes", 0, 0, dict(PAGE0, segments=[
        {"byteLength": 2, "digest": EMPTY}, {"byteLength": 2, "digest": EMPTY},
        {"byteLength": 1, "digest": EMPTY}]), False)
    add("other-segment-lengths", 0, 0, dict(PAGE0, segments=[
        {"byteLength": 1, "digest": EMPTY}, {"byteLength": 4, "digest": EMPTY}
    ]), True)
    add("other-byte-total", 0, 0, dict(PAGE0, segments=[
        {"byteLength": 1, "digest": EMPTY}, {"byteLength": 3, "digest": EMPTY}
    ]), False)
    add("no-such-page", 0, 2, PAGE1, False)
    add("negative-page-index", 0, -1, PAGE0, False)
    add("no-such-stream", 2, 0, PAGE0, False)
    add("stream-without-pages", 1, 0, PAGE0, False)
    pty_bytes = b"x"
    add("stream-with-a-resource-body", 0, 0, PAGE0, False, with_content(
        MANIFEST, 0, byteLength=1, digest=sha(pty_bytes),
        body=content_ref("c", pty_bytes)))
    add("invalid-page", 0, 0, dict(PAGE0, type="manifest"), False)
    add("invalid-manifest", 0, 0, PAGE0, False, with_(MANIFEST, revision=0))
    return cases


def grown_page1():
    return page("capture-01", "stdout", 2, 5, SEGMENTS[2:] + [b"!"])


def revision_cases():
    cases = []

    def add(case_id, previous, following, valid):
        cases.append({"id": case_id, "previous": previous, "next": following,
                      "valid": valid})

    add("seals-the-open-streams", PENDING, MANIFEST, True)
    grown = with_content(with_(PENDING, revision=2), 0,
                         byteLength=len(STDOUT), digest=sha(STDOUT),
                         body={"pages": [PAGE0_REF, PAGE1_REF]})
    add("adds-a-page", PENDING, grown, True)
    more = grown_page1()
    more_bytes = STDOUT + b"!"
    longer = with_content(
        with_(grown, revision=3), 0, byteLength=len(more_bytes),
        digest=sha(more_bytes),
        body={"pages": [PAGE0_REF, page_ref("page-stdout-1b", more)]})
    add("replaces-the-last-page-with-a-longer-one", grown, longer, True)
    add("keeps-the-same-bytes", PENDING, with_(PENDING, revision=2), True)
    settled = with_(PENDING, revision=2, executionStatus="success", exitCode=0)
    add("settles-the-outcome", PENDING, settled, True)
    add("keeps-a-settled-outcome", settled, with_(MANIFEST, revision=3), True)
    ended = with_content(
        with_(PENDING, revision=2, captureStatus="partial",
              captureReason="producer_lost", executionStatus="error",
              exitCode=1),
        1, state="incomplete")
    ended["contents"][0]["state"] = "incomplete"
    add("ends-with-a-partial-capture", PENDING, ended, True)
    add("ends-with-an-open-stream", PENDING, with_content(
        ended, 0, state="open"), False)
    stopped = with_content(
        with_(PENDING, revision=2), 1, state="incomplete",
        missingRanges=[{"start": 0, "end": 7}])
    add("stops-one-stream-while-another-runs", PENDING, stopped, True)
    add("keeps-an-incomplete-stream", stopped, with_content(
        with_(stopped, revision=3, captureStatus="partial",
              captureReason="producer_lost"), 0, state="sealed"), True)
    add("changes-an-incomplete-stream", stopped, with_content(
        with_(stopped, revision=3), 1, missingRanges=[]), False)
    added = with_(PENDING, revision=2, contents=PENDING["contents"] + [
        descriptor("attachment-1", "attachment", "image/png", "open", b"",
                   {"pages": []})])
    add("adds-a-stream", PENDING, added, True)
    add("reports-upstream-truncation", PENDING,
        with_(PENDING, revision=2, upstreamTruncated=True), True)
    truncated = with_(PENDING, upstreamTruncated=True)
    add("withdraws-upstream-truncation", truncated,
        with_(truncated, revision=2, upstreamTruncated=False), False)
    add("same-revision", PENDING, PENDING, False)
    add("skips-a-revision", PENDING, with_(MANIFEST, revision=3), False)
    add("goes-back-a-revision", with_(PENDING, revision=5),
        with_(MANIFEST, revision=4), False)
    add("follows-a-final-revision", MANIFEST, with_(MANIFEST, revision=3),
        False)
    partial_final = with_content(
        with_(PENDING, revision=2, captureStatus="partial",
              captureReason="producer_lost"),
        1, state="incomplete")
    partial_final["contents"][0]["state"] = "incomplete"
    add("follows-a-partial-revision", partial_final,
        with_(partial_final, revision=3), False)
    for field, value in [
        ("tenantId", "tenant-b"), ("sessionId", "session-b"),
        ("turnId", "turn-2"), ("executionCallId", "exec-2"),
        ("callId", "call-02"), ("invocationDigest", "sha256:" + "f" * 64),
        ("bindingGeneration", "4"), ("captureId", "capture-02"),
        ("captureScope", "process_pty"), ("capturePolicy", "best_effort"),
    ]:
        following = with_(MANIFEST, **{field: value})
        if field == "captureScope":
            following = with_(following, contents=[dict(
                copy.deepcopy(STDOUT_DESCRIPTOR), streamId="stdout",
                role="pty")])
        add(f"changes-{field}", PENDING, following, False)
    add("changes-a-settled-status", settled,
        with_(MANIFEST, revision=3, executionStatus="error"), False)
    add("changes-a-settled-exit-code", settled,
        with_(MANIFEST, revision=3, exitCode=1), False)
    add("changes-a-settled-signal", settled,
        with_(MANIFEST, revision=3, exitCode=None, signal="SIGTERM"), False)
    signalled = with_(PENDING, revision=2, executionStatus="cancelled",
                      exitCode=None, signal="SIGTERM")
    add("keeps-a-settled-signal", signalled, with_(
        MANIFEST, revision=3, executionStatus="cancelled", exitCode=None,
        signal="SIGTERM"), True)
    add("changes-only-a-settled-signal", signalled, with_(
        MANIFEST, revision=3, executionStatus="cancelled", exitCode=None,
        signal="SIGKILL"), False)
    add("returns-to-an-unknown-status", settled,
        with_(settled, revision=3, executionStatus="unknown", exitCode=None),
        False)
    add("removes-a-stream", PENDING,
        with_(PENDING, revision=2, contents=[OPEN_STDOUT]), False)
    add("reorders-the-streams", PENDING,
        with_(PENDING, revision=2, contents=[OPEN_STDERR, OPEN_STDOUT]), False)
    add("renames-a-stream", PENDING, with_content(
        with_(PENDING, revision=2), 1, streamId="stderr-2"), False)
    add("changes-a-role", PENDING, with_content(
        with_(PENDING, revision=2), 0, role="attachment"), False)
    add("changes-a-mime-type", PENDING, with_content(
        with_(PENDING, revision=2), 0, mimeType="text/plain"), False)
    sealed_first = with_content(PENDING, 1, state="sealed")
    add("changes-a-sealed-stream", sealed_first, with_content(
        with_(sealed_first, revision=2), 1, byteLength=1, digest=sha(b"x"),
        body={"pages": [page_ref("p", page("capture-01", "stderr", 0, 0,
                                           [b"x"]))]}), False)
    add("reopens-a-sealed-stream", sealed_first, with_content(
        with_(sealed_first, revision=2), 1, state="open"), False)
    add("shrinks-an-open-stream", grown, with_(PENDING, revision=3), False)
    add("changes-the-digest-of-the-same-bytes", PENDING, with_content(
        with_(PENDING, revision=2), 0, digest=EMPTY), False)
    add("changes-an-earlier-page", grown, with_content(
        with_(grown, revision=3), 0, body={"pages": [
            dict(PAGE0_REF, ref=dict(PAGE0_REF["ref"], resourceId="page-x")),
            PAGE1_REF]}), False)
    add("drops-the-last-page", grown, with_content(
        with_(grown, revision=3), 0, byteLength=5,
        digest=sha(b"".join(SEGMENTS[:2])), body={"pages": [PAGE0_REF]}),
        False)
    add("republishes-the-last-page", grown, with_content(
        with_(grown, revision=3), 0, body={"pages": [
            PAGE0_REF, dict(PAGE1_REF, ref=dict(PAGE1_REF["ref"],
                                                resourceId="p2"))]}), True)
    longer_last = longer["contents"][0]["body"]["pages"][1]
    add("replaces-the-last-page-with-fewer-segments", longer, with_content(
        with_(longer, revision=4), 0, body={"pages": [
            PAGE0_REF, dict(longer_last, segmentCount=1,
                            ref=dict(longer_last["ref"], resourceId="p3"))]}),
        False)
    add("replaces-the-last-page-with-fewer-bytes", longer, with_content(
        with_(longer, revision=4), 0, byteLength=9, digest=sha(STDOUT),
        body={"pages": [PAGE0_REF, dict(
            longer_last, byteLength=4,
            ref=dict(longer_last["ref"], resourceId="p3"))]}), False)
    add("moves-to-a-resource-body", grown, with_content(
        with_(MANIFEST, revision=3), 0, body=content_ref("c", STDOUT)), False)
    add("invalid-next", PENDING, with_(MANIFEST, revision=0), False)
    add("invalid-previous", with_(PENDING, revision=0),
        with_(MANIFEST, revision=1), False)
    return cases


def page_revision_cases():
    cases = []

    def add(case_id, previous, following, valid):
        cases.append({"id": case_id, "previous": previous, "next": following,
                      "valid": valid})

    add("same-page", PAGE1, PAGE1, True)
    add("appends-segments", PAGE1, grown_page1(), True)
    add("other-capture", PAGE1, dict(grown_page1(), captureId="capture-02"),
        False)
    add("other-stream", PAGE1, dict(grown_page1(), streamId="stderr"), False)
    add("other-first-ordinal", PAGE1, dict(grown_page1(), firstOrdinal=3), False)
    add("other-offset", PAGE1, dict(grown_page1(), offset=6), False)
    add("changes-a-segment", PAGE1, page("capture-01", "stdout", 2, 5,
                                         [b"\xacxy!", b"!"]), False)
    add("drops-a-segment", PAGE0, dict(PAGE0, segments=PAGE0["segments"][:1]),
        False)
    add("invalid-next", PAGE1, dict(PAGE1, type="manifest"), False)
    return cases


def b64(data: bytes):
    return {"base64": base64.b64encode(data).decode()}


def fill(byte, length):
    return {"fill": {"byte": byte, "length": length}}


def materialize(spec) -> bytes:
    if "base64" in spec:
        return base64.b64decode(spec["base64"])
    return bytes([spec["fill"]["byte"]]) * spec["fill"]["length"]


class Ledger:
    """The segment store semantics of the design document."""

    def __init__(self):
        self.segments = {}
        self.seals = {}

    @staticmethod
    def token(value):
        return (isinstance(value, str) and 1 <= len(value) <= 128
                and all(c in "abcdefghijklmnopqrstuvwxyz0123456789_-"
                        for c in value))

    @staticmethod
    def count(value, low, high):
        return (type(value) is int and low <= value <= high)

    @staticmethod
    def hexdigest(value):
        return (isinstance(value, str) and len(value) == 64
                and all(c in "0123456789abcdef" for c in value))

    def publish(self, request):
        keys = set(request)
        if not ({"captureId", "streamId", "ordinal", "bytes"} <= keys
                <= {"captureId", "streamId", "ordinal", "bytes", "digest"}):
            return refused("managed_tool_result_invalid")
        data = request["bytes"]
        if (not self.token(request["captureId"])
                or not self.token(request["streamId"])
                or not self.count(request["ordinal"], 0, 65535)
                or not isinstance(data, bytes)
                or not 1 <= len(data) <= 16 * MIB
                or ("digest" in request and not self.hexdigest(request["digest"]))):
            return refused("managed_tool_result_invalid")
        digest = sha(data)
        if "digest" in request and request["digest"] != digest:
            return refused("managed_tool_result_digest_mismatch")
        stream = (request["captureId"], request["streamId"])
        identity = stream + (request["ordinal"],)
        if identity in self.segments:
            stored = self.segments[identity]
            if stored == data:
                return ok({"ordinal": request["ordinal"],
                           "byteLength": len(stored), "digest": sha(stored)})
            return refused("managed_tool_result_conflict")
        seal = self.seals.get(stream)
        if seal is not None and request["ordinal"] >= seal["segmentCount"]:
            return refused("managed_tool_result_conflict")
        self.segments[identity] = data
        return ok({"ordinal": request["ordinal"], "byteLength": len(data),
                   "digest": digest})

    def seal(self, request):
        if set(request) != {"captureId", "streamId", "segmentCount",
                            "byteLength", "digest"}:
            return refused("managed_tool_result_invalid")
        if (not self.token(request["captureId"])
                or not self.token(request["streamId"])
                or not self.count(request["segmentCount"], 0, 65536)
                or not self.count(request["byteLength"], 0, 2**53 - 2)
                or not self.hexdigest(request["digest"])):
            return refused("managed_tool_result_invalid")
        stream = (request["captureId"], request["streamId"])
        wanted = {k: request[k] for k in ("segmentCount", "byteLength", "digest")}
        if stream in self.seals:
            if self.seals[stream] == wanted:
                return ok(dict(wanted))
            return refused("managed_tool_result_conflict")
        ordinals = sorted(o for (c, s, o) in self.segments if (c, s) == stream)
        if ordinals != list(range(request["segmentCount"])):
            return refused("managed_tool_result_conflict")
        data = b"".join(self.segments[stream + (o,)] for o in ordinals)
        if len(data) != request["byteLength"] or sha(data) != request["digest"]:
            return refused("managed_tool_result_digest_mismatch")
        self.seals[stream] = wanted
        return ok(dict(wanted))

    def prefix(self, request):
        if set(request) != {"captureId", "streamId"} or not (
                self.token(request["captureId"])
                and self.token(request["streamId"])):
            return refused("managed_tool_result_invalid")
        stream = (request["captureId"], request["streamId"])
        data = b""
        ordinal = 0
        while stream + (ordinal,) in self.segments:
            data += self.segments[stream + (ordinal,)]
            ordinal += 1
        return ok({"segmentCount": ordinal, "byteLength": len(data),
                   "digest": sha(data), "sealed": stream in self.seals})


def ok(result):
    return {"status": "ok", "result": result}


def refused(code):
    return {"status": "refused", "code": code}


def sequence(case_id, operations):
    ledger = Ledger()
    steps = []
    for op, request in operations:
        live = dict(request)
        if "bytes" in live and isinstance(live["bytes"], dict):
            live["bytes"] = materialize(live["bytes"])
        expected = getattr(ledger, op)(live)
        steps.append({"op": op, "request": request, "expected": expected})
    return {"id": case_id, "steps": steps}


def pub(ordinal, data, stream="stdout", capture="capture-01", digest=None,
        **extra):
    request = {"captureId": capture, "streamId": stream, "ordinal": ordinal,
               "bytes": data if isinstance(data, dict) else b64(data)}
    if digest is not None:
        request["digest"] = digest
    request.update(extra)
    return ("publish", request)


def seal_op(count, length, digest, stream="stdout", capture="capture-01",
            **extra):
    request = {"captureId": capture, "streamId": stream, "segmentCount": count,
               "byteLength": length, "digest": digest}
    request.update(extra)
    return ("seal", request)


def prefix_op(stream="stdout", capture="capture-01"):
    return ("prefix", {"captureId": capture, "streamId": stream})


def segment_sequences():
    s0, s1, s2 = SEGMENTS
    full_seal = seal_op(3, len(STDOUT), sha(STDOUT))
    publish_all = [pub(0, s0), pub(1, s1), pub(2, s2)]
    sequences = [
        sequence("publishes-and-seals-a-stream",
                 publish_all + [prefix_op(), full_seal, prefix_op()]),
        sequence("returns-the-original-result-for-the-same-bytes",
                 [pub(0, s0), pub(0, s0), prefix_op()]),
        sequence("returns-the-original-result-after-sealing",
                 publish_all + [full_seal, pub(1, s1), pub(1, s1, digest=sha(s1))]),
        sequence("refuses-other-bytes-of-the-same-length",
                 [pub(0, s0), pub(0, b"abc"), prefix_op()]),
        sequence("refuses-other-bytes-of-another-length",
                 [pub(0, s0), pub(0, s0 + b"!"), pub(0, s0[:2]), prefix_op()]),
        sequence("refuses-other-bytes-after-sealing",
                 publish_all + [full_seal, pub(2, b"\xacxy!"), prefix_op()]),
        sequence("accepts-a-matching-expected-digest",
                 [pub(0, s0, digest=sha(s0))]),
        sequence("refuses-a-mismatched-expected-digest-and-records-nothing",
                 [pub(0, s0, digest=sha(s1)), prefix_op(), pub(0, s0)]),
        sequence("checks-the-expected-digest-before-the-stored-segment",
                 [pub(0, s0), pub(0, s0, digest=sha(s1)),
                  pub(0, b"xyz", digest=sha(s0))]),
        sequence("refuses-a-segment-past-the-seal",
                 publish_all + [full_seal, pub(3, b"!"), pub(65535, b"!"),
                                prefix_op()]),
        sequence("grows-the-prefix-when-a-gap-fills",
                 [pub(2, s2), prefix_op(), pub(0, s0), prefix_op(), pub(1, s1),
                  prefix_op()]),
        sequence("refuses-a-seal-with-a-missing-segment",
                 [pub(0, s0), pub(2, s2), full_seal, prefix_op(), pub(1, s1),
                  full_seal]),
        sequence("refuses-a-seal-over-a-gap",
                 [pub(0, s0), pub(2, s2), seal_op(2, len(s0 + s2), sha(s0 + s2)),
                  prefix_op()]),
        sequence("refuses-a-seal-with-an-extra-segment",
                 publish_all + [seal_op(2, 5, sha(s0 + s1)), pub(3, b"!"),
                                full_seal]),
        sequence("refuses-a-seal-with-another-length",
                 publish_all + [seal_op(3, len(STDOUT) + 1, sha(STDOUT)),
                                prefix_op()]),
        sequence("refuses-a-seal-with-another-digest",
                 publish_all + [seal_op(3, len(STDOUT), sha(STDOUT + b"!")),
                                full_seal]),
        sequence("returns-the-original-seal",
                 publish_all + [full_seal, full_seal]),
        sequence("refuses-another-seal-after-sealing",
                 publish_all + [full_seal, seal_op(3, len(STDOUT), EMPTY),
                                seal_op(2, 5, sha(s0 + s1)), full_seal]),
        sequence("seals-an-empty-stream",
                 [seal_op(0, 0, EMPTY, stream="stderr"),
                  prefix_op(stream="stderr"), pub(0, b"x", stream="stderr"),
                  seal_op(0, 0, EMPTY, stream="stderr")]),
        sequence("refuses-an-empty-seal-with-the-wrong-digest",
                 [seal_op(0, 0, sha(b"x"), stream="stderr")]),
        sequence("keeps-streams-and-captures-apart",
                 [pub(0, s0), pub(0, b"err", stream="stderr"),
                  pub(0, b"other", capture="capture-02"), prefix_op(),
                  prefix_op(stream="stderr"), prefix_op(capture="capture-02"),
                  seal_op(1, 3, sha(b"err"), stream="stderr"), prefix_op()]),
        sequence("answers-an-empty-prefix-for-an-unknown-stream",
                 [prefix_op(stream="unknown")]),
        sequence("accepts-the-largest-ordinal-and-segment",
                 [pub(65535, fill(120, 16 * MIB)), pub(0, fill(0, 1)),
                  prefix_op()]),
        sequence("keeps-non-utf8-bytes-exact",
                 [pub(0, b"\xff\xfe\x00\x80"), pub(1, b"\xed\xa0\x80"),
                  seal_op(2, 7, sha(b"\xff\xfe\x00\x80\xed\xa0\x80")),
                  prefix_op()]),
        sequence("refuses-invalid-publications", [
            pub(-1, s0), pub(65536, s0), pub(1.5, s0), pub("0", s0),
            pub(0, b""), pub(0, fill(120, 16 * MIB + 1)),
            pub(0, s0, capture="Capture-01"), pub(0, s0, capture=""),
            pub(0, s0, stream="std/out"), pub(0, s0, stream="s" * 129),
            pub(0, s0, digest=sha(s0).upper()),
            pub(0, s0, digest="sha256:" + sha(s0)),
            pub(0, s0, extra=True),
            ("publish", {"captureId": "capture-01", "streamId": "stdout",
                         "bytes": b64(s0)}),
            prefix_op(),
        ]),
        sequence("refuses-invalid-seals", [
            seal_op(65537, 0, EMPTY), seal_op(-1, 0, EMPTY),
            seal_op(0, -1, EMPTY), seal_op(0, 0.5, EMPTY),
            seal_op(0, 0, EMPTY.upper()), seal_op(0, 0, EMPTY, capture="C"),
            seal_op(0, 0, EMPTY, extra=1),
            ("seal", {"captureId": "capture-01", "streamId": "stdout",
                      "segmentCount": 0, "byteLength": 0}),
            prefix_op(),
        ]),
        sequence("refuses-a-seal-of-an-unwritten-stream-with-segments",
                 [seal_op(65536, 0, EMPTY), seal_op(1, 1, sha(b"x"))]),
        sequence("refuses-invalid-prefix-queries", [
            ("prefix", {"captureId": "capture-01"}),
            ("prefix", {"captureId": "capture-01", "streamId": "STDOUT"}),
            ("prefix", {"captureId": "capture-01", "streamId": "stdout",
                        "ordinal": 0}),
        ]),
    ]
    return sequences


MANIFEST_REF = durable("manifest-r2", KIND_MANIFEST, len(compact(MANIFEST)),
                       sha(compact(MANIFEST)))
RESULT = {
    "executionStatus": "success",
    "responseParts": [{"text": "ab�€xyz"}],
    "capture": {
        "captureStatus": "complete",
        "captureReason": None,
        "manifest": MANIFEST_REF,
        "previewTruncated": False,
        "deliveryStatus": "pending",
    },
}


def with_capture(**changes):
    value = copy.deepcopy(RESULT)
    value["capture"].update(copy.deepcopy(changes))
    return value


def envelope_cases():
    cases = []

    def add(case_id, result, valid):
        cases.append({"id": case_id, "result": result, "valid": valid})

    add("canonical", RESULT, True)
    add("partial", with_capture(captureStatus="partial",
                                captureReason="quota_exhausted"), True)
    add("unavailable-without-a-manifest", with_capture(
        captureStatus="unavailable", captureReason="storage_failed",
        manifest=None), True)
    add("unavailable-with-a-manifest", with_capture(
        captureStatus="unavailable", captureReason="size_limit"), True)
    add("not-started", {"executionStatus": "not_started", "responseParts": [],
                        "capture": None}, True)
    add("error-with-a-message", dict(
        copy.deepcopy(RESULT), executionStatus="error",
        error={"message": "exit 2", "type": "shell_exit"}), True)
    add("cancelled", dict(copy.deepcopy(RESULT), executionStatus="cancelled"),
        True)
    add("truncated-preview", with_capture(previewTruncated=True), True)
    add("committed", with_capture(deliveryStatus="committed"), True)
    add("blocked", with_capture(deliveryStatus="blocked"), True)
    add("manifest-at-64-kib", with_capture(
        manifest=dict(MANIFEST_REF, byteLength=65536)), True)
    for value, name in [([], "array"), (None, "null")]:
        add(f"{name}-result", value, False)
    for key in ["executionStatus", "responseParts", "capture"]:
        add(f"missing-{key}", without(RESULT, key), False)
    add("extra-key", dict(copy.deepcopy(RESULT), extra=1), False)
    add("execution-unknown", dict(copy.deepcopy(RESULT),
                                  executionStatus="unknown"), False)
    add("response-parts-not-an-array", dict(copy.deepcopy(RESULT),
                                            responseParts={}), False)
    add("error-extra-key", dict(copy.deepcopy(RESULT),
                                error={"message": "x", "code": 1}), False)
    add("error-empty-message", dict(copy.deepcopy(RESULT),
                                    error={"message": ""}), False)
    add("error-empty-type", dict(copy.deepcopy(RESULT),
                                 error={"message": "x", "type": ""}), False)
    add("no-capture-for-a-started-call",
        dict(copy.deepcopy(RESULT), capture=None), False)
    add("capture-for-a-call-that-did-not-start",
        dict(copy.deepcopy(RESULT), executionStatus="not_started"), False)
    for key in RESULT["capture"]:
        value = copy.deepcopy(RESULT)
        del value["capture"][key]
        add(f"capture-missing-{key}", value, False)
    add("capture-extra-key", with_capture(revision=2), False)
    add("capture-pending", with_capture(captureStatus="pending"), False)
    add("capture-pending-with-a-reason", with_capture(
        captureStatus="pending", captureReason="producer_lost"), False)
    add("capture-status-unknown", with_capture(captureStatus="failed"), False)
    add("partial-without-a-reason", with_capture(captureStatus="partial"),
        False)
    add("unavailable-without-a-reason", with_capture(
        captureStatus="unavailable", manifest=None), False)
    add("complete-with-a-reason", with_capture(captureReason="size_limit"),
        False)
    add("reason-unknown", with_capture(captureStatus="partial",
                                       captureReason="lost"), False)
    add("complete-without-a-manifest", with_capture(manifest=None), False)
    add("partial-without-a-manifest", with_capture(
        captureStatus="partial", captureReason="quota_exhausted",
        manifest=None), False)
    for name, ref in [
        ("page-kind", dict(MANIFEST_REF, kind=KIND_PAGE)),
        ("schema-version-2", dict(MANIFEST_REF, schemaVersion=2)),
        ("empty", dict(MANIFEST_REF, byteLength=0)),
        ("over-64-kib", dict(MANIFEST_REF, byteLength=65537)),
        ("extra-key", dict(MANIFEST_REF, extra=1)),
        ("prefixed-digest", dict(MANIFEST_REF,
                                 digest="sha256:" + MANIFEST_REF["digest"])),
        ("not-nfc-id", dict(MANIFEST_REF, resourceId="é")),
    ]:
        add(f"manifest-{name}", with_capture(manifest=ref), False)
    add("preview-truncated-not-a-boolean",
        with_capture(previewTruncated="false"), False)
    add("delivery-unknown", with_capture(deliveryStatus="acknowledged"), False)
    return cases


def envelope_manifest_cases():
    cases = []

    def add(case_id, result, manifest, valid):
        cases.append({"id": case_id, "result": result, "manifest": manifest,
                      "valid": valid})

    add("canonical", RESULT, MANIFEST, True)
    partial = with_content(MANIFEST, 0, state="incomplete", missingRanges=[])
    partial.update(captureStatus="partial", captureReason="quota_exhausted")
    add("partial", with_capture(captureStatus="partial",
                                captureReason="quota_exhausted"), partial, True)
    add("other-execution-status", dict(copy.deepcopy(RESULT),
                                       executionStatus="error"),
        MANIFEST, False)
    add("unknown-execution-status", RESULT,
        with_(MANIFEST, executionStatus="unknown", exitCode=None), False)
    add("other-capture-status", RESULT, partial, False)
    add("other-capture-status-with-the-same-reason", with_capture(
        captureStatus="unavailable", captureReason="quota_exhausted"),
        partial, False)
    add("other-capture-reason", with_capture(
        captureStatus="partial", captureReason="size_limit"), partial, False)
    add("pending-manifest", RESULT, PENDING, False)
    add("result-without-a-manifest", with_capture(
        captureStatus="unavailable", captureReason="storage_failed",
        manifest=None), with_(MANIFEST, captureStatus="unavailable",
                              captureReason="storage_failed", contents=[]),
        False)
    add("call-that-did-not-start", {"executionStatus": "not_started",
                                    "responseParts": [], "capture": None},
        MANIFEST, False)
    add("invalid-manifest", RESULT, with_(MANIFEST, revision=0), False)
    add("invalid-result", with_capture(captureStatus="pending"), MANIFEST,
        False)
    return cases


REFERENCE = {
    "sessionId": "runtime-session-01",
    "promptId": "prompt-01",
    "callId": "call-01",
    "argsDigest": "sha256:" + "0123456789abcdef" * 4,
}
CAPTURE = {
    "tenantId": "tenant-a",
    "sessionId": "session-a",
    "turnId": "turn-1",
    "executionCallId": "exec-1",
    "bindingGeneration": "3",
    "capturePolicy": "complete_required",
}
REQUESTS = {
    "execute": {"protocolVersion": 3, "toolResult": TOKEN,
                "reference": REFERENCE, "toolName": "run_shell_command",
                "input": {"command": "make"}, "capture": CAPTURE},
    "status": {"protocolVersion": 3, "toolResult": TOKEN,
               "reference": REFERENCE, "afterSequence": 0},
    "cancel": {"protocolVersion": 3, "toolResult": TOKEN,
               "reference": REFERENCE},
    "acknowledge": {"protocolVersion": 3, "toolResult": TOKEN,
                    "reference": REFERENCE,
                    "receipt": {"executionCallId": "exec-1",
                                "manifest": MANIFEST_REF,
                                "deliveryStatus": "committed",
                                "historyRevision": 12}},
}
V2_REQUESTS = {
    "execute": {"protocolVersion": 2, "reference": REFERENCE,
                "toolName": "run_shell_command", "input": {"command": "make"}},
    "status": {"protocolVersion": 2, "reference": REFERENCE},
    "cancel": {"protocolVersion": 2, "reference": REFERENCE},
}


def request_cases():
    cases = []

    def add(case_id, route, body, valid):
        cases.append({"id": case_id, "route": route, "body": body,
                      "valid": valid})

    for route, body in REQUESTS.items():
        add(f"{route}-canonical", route, body, True)
        add(f"{route}-without-the-token", route, without(body, "toolResult"),
            False)
        add(f"{route}-other-token", route,
            with_(body, toolResult="managed-tool-result/2"), False)
        add(f"{route}-protocol-version-2", route,
            with_(body, protocolVersion=2), False)
        add(f"{route}-extra-key", route, with_(body, extra=1), False)
        add(f"{route}-without-a-reference", route, without(body, "reference"),
            False)
        add(f"{route}-reference-extra-key", route, with_(
            body, reference=dict(REFERENCE, invocationId="x")), False)
        add(f"{route}-reference-empty-call-id", route, with_(
            body, reference=dict(REFERENCE, callId="")), False)
        v2 = V2_REQUESTS.get(route, V2_REQUESTS["cancel"])
        add(f"{route}-v2-body", route, v2, False)
    for key, value in [("callId", "call\u0001"), ("argsDigest", "a\u007fb")]:
        add(f"execute-reference-{key}-with-a-control-character", "execute",
            with_(REQUESTS["execute"], reference=dict(REFERENCE, **{key: value})),
            False)
    add("status-without-a-cursor", "status",
        without(REQUESTS["status"], "afterSequence"), True)
    add("status-negative-cursor", "status",
        with_(REQUESTS["status"], afterSequence=-1), False)
    add("execute-with-a-cursor", "execute",
        with_(REQUESTS["execute"], afterSequence=0), False)
    for key in ["toolName", "input", "capture"]:
        add(f"execute-without-{key}", "execute", without(REQUESTS["execute"], key),
            False)
    add("execute-empty-tool-name", "execute",
        with_(REQUESTS["execute"], toolName=""), False)
    add("execute-input-not-an-object", "execute",
        with_(REQUESTS["execute"], input=[]), False)
    for key in CAPTURE:
        add(f"execute-capture-without-{key}", "execute", with_(
            REQUESTS["execute"], capture=without(CAPTURE, key)), False)
    add("execute-capture-extra-key", "execute", with_(
        REQUESTS["execute"], capture=dict(CAPTURE, captureId="c")), False)
    add("execute-capture-best-effort", "execute", with_(
        REQUESTS["execute"], capture=dict(CAPTURE, capturePolicy="best_effort")),
        True)
    add("execute-capture-policy-unknown", "execute", with_(
        REQUESTS["execute"], capture=dict(CAPTURE, capturePolicy="required")),
        False)
    add("execute-capture-generation-zero", "execute", with_(
        REQUESTS["execute"], capture=dict(CAPTURE, bindingGeneration="0")),
        False)
    add("execute-capture-generation-number", "execute", with_(
        REQUESTS["execute"], capture=dict(CAPTURE, bindingGeneration=3)), False)
    add("execute-capture-empty-tenant", "execute", with_(
        REQUESTS["execute"], capture=dict(CAPTURE, tenantId="")), False)
    ack = REQUESTS["acknowledge"]
    blocked = {"executionCallId": "exec-1", "manifest": MANIFEST_REF,
               "deliveryStatus": "blocked", "historyRevision": None}
    add("acknowledge-blocked", "acknowledge", with_(ack, receipt=blocked), True)
    add("acknowledge-without-a-manifest", "acknowledge", with_(
        ack, receipt=dict(ack["receipt"], manifest=None)), True)
    add("acknowledge-committed-without-a-revision", "acknowledge", with_(
        ack, receipt=dict(ack["receipt"], historyRevision=None)), False)
    add("acknowledge-committed-at-revision-zero", "acknowledge", with_(
        ack, receipt=dict(ack["receipt"], historyRevision=0)), False)
    add("acknowledge-blocked-with-a-revision", "acknowledge", with_(
        ack, receipt=dict(blocked, historyRevision=12)), False)
    add("acknowledge-pending", "acknowledge", with_(
        ack, receipt=dict(ack["receipt"], deliveryStatus="pending")), False)
    add("acknowledge-without-a-receipt", "acknowledge",
        without(ack, "receipt"), False)
    for key in ack["receipt"]:
        add(f"acknowledge-receipt-without-{key}", "acknowledge", with_(
            ack, receipt=without(ack["receipt"], key)), False)
    add("acknowledge-receipt-extra-key", "acknowledge", with_(
        ack, receipt=dict(ack["receipt"], sessionId="s")), False)
    add("acknowledge-page-reference", "acknowledge", with_(
        ack, receipt=dict(ack["receipt"],
                          manifest=dict(MANIFEST_REF, kind=KIND_PAGE))), False)
    return cases


def response_cases():
    cases = []

    def add(case_id, route, body, valid):
        cases.append({"id": case_id, "route": route, "body": body,
                      "valid": valid})

    def settled(route, **capture):
        if route == "acknowledge":
            capture.setdefault("deliveryStatus", "committed")
        return {"protocolVersion": 3, "toolResult": TOKEN, "state": "settled",
                "result": with_capture(**capture)}

    unknown = {"protocolVersion": 3, "toolResult": TOKEN, "state": "unknown"}
    for route in ["execute", "status", "cancel", "acknowledge"]:
        body = settled(route)
        add(f"{route}-settled", route, body, True)
        add(f"{route}-unknown", route, unknown, True)
        add(f"{route}-v2-body", route, {"protocolVersion": 2,
                                        "state": "settled",
                                        "result": without(RESULT, "capture")},
            False)
        add(f"{route}-without-the-token", route, without(body, "toolResult"),
            False)
        add(f"{route}-protocol-version-2", route,
            with_(body, protocolVersion=2), False)
        add(f"{route}-v2-result", route,
            with_(body, result=without(RESULT, "capture")), False)
        add(f"{route}-settled-without-a-result", route,
            without(body, "result"), False)
        add(f"{route}-unknown-with-a-result", route,
            with_(body, state="unknown"), False)
        add(f"{route}-extra-key", route, with_(body, extra=1), False)
        add(f"{route}-state-outside-the-contract", route,
            with_(body, state="done"), False)
    for route in ["execute", "status", "cancel"]:
        for state in ["prepared", "executing", "cancel_requested"]:
            add(f"{route}-{state}", route, {
                "protocolVersion": 3, "toolResult": TOKEN, "state": state},
                True)
        add(f"{route}-committed", route,
            settled(route, deliveryStatus="committed"), True)
        add(f"{route}-not-started", route, {
            "protocolVersion": 3, "toolResult": TOKEN, "state": "settled",
            "result": {"executionStatus": "not_started", "responseParts": [],
                       "capture": None}}, True)
    add("status-with-a-cursor", "status",
        with_(settled("status"), lastSequence=4), True)
    add("status-executing-with-a-cursor", "status", {
        "protocolVersion": 3, "toolResult": TOKEN, "state": "executing",
        "lastSequence": 2}, True)
    add("status-negative-cursor", "status",
        with_(settled("status"), lastSequence=-1), False)
    for route in ["execute", "cancel", "acknowledge"]:
        add(f"{route}-with-a-cursor", route,
            with_(settled(route), lastSequence=4), False)
    add("acknowledge-blocked", "acknowledge",
        settled("acknowledge", deliveryStatus="blocked"), True)
    add("acknowledge-pending-delivery", "acknowledge",
        settled("acknowledge", deliveryStatus="pending"), False)
    for state in ["prepared", "executing", "cancel_requested"]:
        add(f"acknowledge-{state}", "acknowledge", {
            "protocolVersion": 3, "toolResult": TOKEN, "state": state}, False)
    add("acknowledge-not-started", "acknowledge", {
        "protocolVersion": 3, "toolResult": TOKEN, "state": "settled",
        "result": {"executionStatus": "not_started", "responseParts": [],
                   "capture": None}}, False)
    return cases


def build():
    manifest_bytes = compact(MANIFEST)
    assert len(manifest_bytes) <= 65536
    return {
        "contractVersion": 1,
        "toolResult": TOKEN,
        "kinds": {"manifest": KIND_MANIFEST, "page": KIND_PAGE,
                  "content": KIND_CONTENT},
        "limits": LIMITS,
        "routes": ROUTES,
        "errors": ERRORS,
        "manifest": MANIFEST,
        "pages": [PAGE0, PAGE1],
        "stdout": b64(STDOUT),
        "manifestCases": manifest_cases(),
        "manifestTextCases": manifest_text_cases(),
        "pageCases": page_cases(),
        "pageTextCases": page_text_cases(),
        "pagePositionCases": page_position_cases(),
        "revisionCases": revision_cases(),
        "pageRevisionCases": page_revision_cases(),
        "segmentSequences": segment_sequences(),
        "envelopeCases": envelope_cases(),
        "envelopeManifestCases": envelope_manifest_cases(),
        "requests": REQUESTS,
        "requestCases": request_cases(),
        "responseCases": response_cases(),
    }


def main():
    fixtures = build()
    for name, value in fixtures.items():
        if isinstance(value, list) and value and "id" in value[0]:
            ids = [case["id"] for case in value]
            duplicates = {i for i in ids if ids.count(i) > 1}
            assert not duplicates, (name, duplicates)
            bad = [i for i in ids if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", i)]
            assert not bad, (name, bad)
    text = json.dumps(fixtures, indent=2, ensure_ascii=True) + "\n"
    sys.stdout.write(text)


if __name__ == "__main__":
    main()
