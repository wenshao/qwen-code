#!/usr/bin/env python3
"""Writes managed-tool-result-v1.schema.json for the O1a fixtures."""

import json
import sys

sys.path.insert(0, __import__("os").path.dirname(__file__))
from gen_fixtures import ERRORS, KIND_CONTENT, KIND_MANIFEST, KIND_PAGE, \
    LIMITS, ROUTES, TOKEN  # noqa: E402

MIB = 1024 * 1024
MAX_COUNT = 2**53 - 2


def ref(name):
    return {"$ref": f"#/$defs/{name}"}


def closed(properties, optional=()):
    return {
        "type": "object",
        "additionalProperties": False,
        "required": sorted(k for k in properties if k not in optional),
        "properties": properties,
    }


def nullable(schema):
    return {"anyOf": [{"type": "null"}, schema]}


def resource_ref(kind, max_bytes=None):
    byte_length = {"type": "integer", "minimum": 0, "maximum": MAX_COUNT}
    if max_bytes is not None:
        byte_length = {"type": "integer", "minimum": 1, "maximum": max_bytes}
    return closed({
        "resourceId": ref("id"),
        "kind": {"const": kind},
        "schemaVersion": {"const": 1},
        "byteLength": byte_length,
        "digest": ref("digest"),
    })


def has(key, schema):
    return {"type": "object", "properties": {key: schema}, "required": [key]}


def when(condition, then, otherwise=None):
    rule = {"if": condition, "then": then}
    if otherwise is not None:
        rule["else"] = otherwise
    return rule


def every(item):
    return {"type": "array", "items": item}


def some(item, most=None):
    rule = {"type": "array", "contains": item}
    if most is not None:
        rule["maxContains"] = most
    return rule


def state(value):
    return has("state", {"const": value})


def case(slot_properties, optional=()):
    properties = {"id": ref("caseId")}
    properties.update(slot_properties)
    return {"type": "array", "minItems": 1, "items": closed(properties, optional)}


ROLE_LIMITS = [
    when(has("contents", some(has("role", {"const": role}))),
         has("contents", some(has("role", {"const": role}), 1)))
    for role in ["stdout", "stderr", "pty", "result"]
]
SCOPE_ROLES = [
    when(has("captureScope", {"const": scope}),
         has("contents", every({"not": has("role", {"enum": roles})})))
    for scope, roles in [
        ("process_pty", ["stdout", "stderr"]),
        ("process_pipes", ["pty"]),
        ("tool_native", ["stdout", "stderr", "pty"]),
    ]
]
EMPTY_INCOMPLETE = {"type": "object", "properties": {
    "state": {"const": "incomplete"}, "byteLength": {"const": 0}}}
STATUS_RULES = [
    when(has("captureStatus", {"const": "pending"}),
         has("contents", some(state("open"))),
         has("contents", every({"not": state("open")}))),
    when(has("captureStatus", {"const": "complete"}),
         has("contents", {"type": "array", "minItems": 1,
                          "items": state("sealed")})),
    when(has("captureStatus", {"const": "unavailable"}),
         has("contents", every(EMPTY_INCOMPLETE))),
    when(has("captureStatus", {"const": "partial"}),
         has("contents", {"allOf": [
             some(state("incomplete")),
             {"not": every(EMPTY_INCOMPLETE)},
         ]})),
    when(has("captureStatus", {"enum": ["pending", "complete"]}),
         has("captureReason", {"type": "null"}),
         has("captureReason", {"type": "string"})),
]
EXIT_RULES = [
    when(has("executionStatus", {"const": "unknown"}),
         {"type": "object", "properties": {"exitCode": {"type": "null"},
                                           "signal": {"type": "null"}}}),
    when(has("captureScope", {"const": "tool_native"}),
         {"type": "object", "properties": {"exitCode": {"type": "null"},
                                           "signal": {"type": "null"}}},
         when(has("exitCode", {"type": "integer"}),
              has("signal", {"type": "null"}))),
]

DEFS = {
    "caseId": {"type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]*$"},
    "toolResult": {"const": TOKEN},
    "id": {"type": "string", "minLength": 1,
           "pattern": "^[^\\u0000-\\u001f\\u007f-\\u009f]+$"},
    "token": {"type": "string", "pattern": "^[a-z0-9_-]{1,128}$"},
    "digest": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
    "generation": {"type": "string", "pattern": "^[1-9][0-9]{0,18}$"},
    "count": {"type": "integer", "minimum": 0, "maximum": MAX_COUNT},
    "positiveCount": {"type": "integer", "minimum": 1, "maximum": MAX_COUNT},
    "durableRef": closed({
        "resourceId": ref("id"),
        "kind": ref("id"),
        "schemaVersion": ref("count"),
        "byteLength": ref("count"),
        "digest": ref("digest"),
    }),
    "manifestRef": resource_ref(KIND_MANIFEST, LIMITS["maxManifestBytes"]),
    "pageRef": resource_ref(KIND_PAGE, LIMITS["maxPageBytes"]),
    "contentRef": resource_ref(KIND_CONTENT),
    "mimeType": {
        "type": "string",
        "maxLength": LIMITS["maxMimeTypeLength"],
        "pattern": "^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*(?:;[\\u0020-\\u007e]*)?$",
    },
    "missingRange": closed({
        "start": ref("count"),
        "end": nullable(ref("count")),
    }),
    "pageReference": closed({
        "ref": ref("pageRef"),
        "segmentCount": {"type": "integer", "minimum": 1,
                         "maximum": LIMITS["maxSegmentsPerPage"]},
        "byteLength": ref("positiveCount"),
    }),
    "resourceBody": closed({"ref": ref("contentRef")}),
    "pagedBody": closed({"pages": {
        "type": "array", "maxItems": LIMITS["maxPagesPerStream"],
        "items": ref("pageReference")}}),
    "descriptor": {
        **closed({
            "streamId": ref("token"),
            "role": {"enum": ["stdout", "stderr", "pty", "result",
                              "attachment"]},
            "mimeType": ref("mimeType"),
            "state": {"enum": ["open", "sealed", "incomplete"]},
            "byteLength": ref("count"),
            "digest": ref("digest"),
            "missingRanges": {"type": "array", "maxItems": 1,
                              "items": ref("missingRange")},
            "body": {"oneOf": [ref("resourceBody"), ref("pagedBody")]},
        }),
        "allOf": [
            when(state("open"), has("body", ref("pagedBody"))),
            when({"type": "object", "properties": {
                "state": {"enum": ["open", "sealed"]}}, "required": ["state"]},
                has("missingRanges", {"type": "array", "maxItems": 0})),
        ],
    },
    "manifest": {
        **closed({
            "toolResult": ref("toolResult"),
            "type": {"const": "manifest"},
            "tenantId": ref("id"),
            "sessionId": ref("id"),
            "turnId": ref("id"),
            "executionCallId": ref("id"),
            "callId": ref("id"),
            "invocationDigest": ref("id"),
            "bindingGeneration": ref("generation"),
            "captureId": ref("token"),
            "revision": ref("positiveCount"),
            "executionStatus": {"enum": ["success", "error", "cancelled",
                                         "unknown"]},
            "exitCode": nullable({"type": "integer", "minimum": -2**31,
                                  "maximum": 2**32 - 1}),
            "signal": nullable({"type": "string",
                                "pattern": "^SIG[A-Z0-9]{1,16}$"}),
            "captureScope": {"enum": ["process_pty", "process_pipes",
                                      "tool_native"]},
            "capturePolicy": {"enum": ["complete_required", "best_effort"]},
            "captureStatus": {"enum": ["pending", "complete", "partial",
                                       "unavailable"]},
            "captureReason": nullable({"enum": [
                "quota_exhausted", "size_limit", "producer_lost",
                "storage_failed", "cancelled"]}),
            "upstreamTruncated": {"type": "boolean"},
            "contents": {"type": "array", "maxItems": LIMITS["maxContents"],
                         "items": ref("descriptor")},
        }),
        "allOf": ROLE_LIMITS + SCOPE_ROLES + STATUS_RULES + EXIT_RULES,
    },
    "segment": closed({
        "byteLength": {"type": "integer", "minimum": 1,
                       "maximum": LIMITS["maxSegmentBytes"]},
        "digest": ref("digest"),
    }),
    "page": closed({
        "toolResult": ref("toolResult"),
        "type": {"const": "page"},
        "captureId": ref("token"),
        "streamId": ref("token"),
        "firstOrdinal": {"type": "integer", "minimum": 0,
                         "maximum": LIMITS["maxOrdinal"]},
        "offset": ref("count"),
        "segments": {"type": "array", "minItems": 1,
                     "maxItems": LIMITS["maxSegmentsPerPage"],
                     "items": ref("segment")},
    }),
    "error": closed({
        "message": {"type": "string", "minLength": 1},
        "type": {"type": "string", "minLength": 1},
    }, optional=("type",)),
    "capture": {
        **closed({
            "captureStatus": {"enum": ["complete", "partial", "unavailable"]},
            "captureReason": nullable({"enum": [
                "quota_exhausted", "size_limit", "producer_lost",
                "storage_failed", "cancelled"]}),
            "manifest": nullable(ref("manifestRef")),
            "previewTruncated": {"type": "boolean"},
            "deliveryStatus": {"enum": ["pending", "committed", "blocked"]},
        }),
        "allOf": [
            when(has("captureStatus", {"const": "complete"}),
                 has("captureReason", {"type": "null"}),
                 has("captureReason", {"type": "string"})),
            when(has("captureStatus", {"enum": ["complete", "partial"]}),
                 has("manifest", {"type": "object"})),
        ],
    },
    "result": {
        **closed({
            "executionStatus": {"enum": ["not_started", "success", "error",
                                         "cancelled"]},
            "responseParts": {"type": "array"},
            "error": ref("error"),
            "capture": nullable(ref("capture")),
        }, optional=("error",)),
        "allOf": [
            when(has("executionStatus", {"const": "not_started"}),
                 has("capture", {"type": "null"}),
                 has("capture", {"type": "object"})),
        ],
    },
    "reference": closed({
        "sessionId": {"type": "string", "minLength": 1},
        "promptId": {"type": "string", "minLength": 1},
        "callId": ref("id"),
        "argsDigest": ref("id"),
    }),
    "captureRequest": closed({
        "tenantId": ref("id"),
        "sessionId": ref("id"),
        "turnId": ref("id"),
        "executionCallId": ref("id"),
        "bindingGeneration": ref("generation"),
        "capturePolicy": {"enum": ["complete_required", "best_effort"]},
    }),
    "receipt": {
        **closed({
            "executionCallId": ref("id"),
            "manifest": nullable(ref("manifestRef")),
            "deliveryStatus": {"enum": ["committed", "blocked"]},
            "historyRevision": nullable(ref("positiveCount")),
        }),
        "allOf": [
            when(has("deliveryStatus", {"const": "committed"}),
                 has("historyRevision", {"type": "integer"}),
                 has("historyRevision", {"type": "null"})),
        ],
    },
    "executeRequest": closed({
        "protocolVersion": {"const": 3},
        "toolResult": ref("toolResult"),
        "reference": ref("reference"),
        "toolName": {"type": "string", "minLength": 1},
        "input": {"type": "object"},
        "capture": ref("captureRequest"),
    }),
    "statusRequest": closed({
        "protocolVersion": {"const": 3},
        "toolResult": ref("toolResult"),
        "reference": ref("reference"),
        "afterSequence": ref("count"),
    }, optional=("afterSequence",)),
    "cancelRequest": closed({
        "protocolVersion": {"const": 3},
        "toolResult": ref("toolResult"),
        "reference": ref("reference"),
    }),
    "acknowledgeRequest": closed({
        "protocolVersion": {"const": 3},
        "toolResult": ref("toolResult"),
        "reference": ref("reference"),
        "receipt": ref("receipt"),
    }),
    "toolState": {"enum": ["prepared", "executing", "cancel_requested",
                           "settled", "unknown"]},
}

RESULT_WHEN_SETTLED = when(
    state("settled"), has("result", ref("result")),
    {"not": {"type": "object", "properties": {"result": True},
             "required": ["result"]}})


def response(extra=None, optional=("result",)):
    properties = {
        "protocolVersion": {"const": 3},
        "toolResult": ref("toolResult"),
        "state": ref("toolState"),
        "result": ref("result"),
    }
    properties.update(extra or {})
    return {**closed(properties, optional=optional),
            "allOf": [RESULT_WHEN_SETTLED]}


DEFS["executeResponse"] = response()
DEFS["cancelResponse"] = response()
DEFS["statusResponse"] = response({"lastSequence": ref("count")},
                                  optional=("result", "lastSequence"))
DEFS["acknowledgeResponse"] = response()
DEFS["acknowledgeResponse"]["allOf"].append(
    has("state", {"enum": ["settled", "unknown"]}))
DEFS["acknowledgeResponse"]["allOf"].append(when(
    state("settled"),
    has("result", has("capture", has("deliveryStatus",
                                     {"enum": ["committed", "blocked"]})))))

DEFS["bytes"] = {"oneOf": [
    closed({"base64": {"type": "string",
                       "pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"}}),
    closed({"fill": closed({
        "byte": {"type": "integer", "minimum": 0, "maximum": 255},
        "length": ref("count"),
    })}),
]}
DEFS["segmentReceipt"] = closed({"ordinal": ref("count"),
                                 "byteLength": ref("positiveCount"),
                                 "digest": ref("digest")})
DEFS["sealReceipt"] = closed({"segmentCount": ref("count"),
                              "byteLength": ref("count"),
                              "digest": ref("digest")})
DEFS["prefix"] = closed({"segmentCount": ref("count"),
                         "byteLength": ref("count"),
                         "digest": ref("digest"),
                         "sealed": {"type": "boolean"}})
DEFS["refusal"] = closed({"status": {"const": "refused"}, "code": {"enum": [
    "managed_tool_result_invalid", "managed_tool_result_conflict",
    "managed_tool_result_digest_mismatch"]}})


def outcome(result):
    return {"oneOf": [closed({"status": {"const": "ok"}, "result": ref(result)}),
                      ref("refusal")]}


DEFS["step"] = {
    **closed({
        "op": {"enum": ["publish", "seal", "prefix"]},
        "request": {"type": "object"},
        "expected": {"type": "object"},
    }),
    "allOf": [
        when(has("op", {"const": op}), has("expected", outcome(result)))
        for op, result in [("publish", "segmentReceipt"),
                           ("seal", "sealReceipt"), ("prefix", "prefix")]
    ] + [when(has("op", {"const": "publish"}),
              has("request", {"type": "object",
                              "properties": {"bytes": ref("bytes")}}))],
}

ROUTE_KEYS = ["execute", "status", "cancel", "acknowledge"]

SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://qwenlm.github.io/qwen-code/contracts/managed-tool-result-v1.schema.json",
    "title": "Managed tool result v1 (managed-tool-result/1) conformance fixtures",
    **closed({
        "contractVersion": {"const": 1},
        "toolResult": ref("toolResult"),
        "kinds": {"const": {"manifest": KIND_MANIFEST, "page": KIND_PAGE,
                            "content": KIND_CONTENT}},
        "limits": {"const": LIMITS},
        "routes": {"const": ROUTES},
        "errors": {"const": ERRORS},
        "manifest": ref("manifest"),
        "pages": {"type": "array", "minItems": 2, "maxItems": 2,
                  "items": ref("page")},
        "stdout": ref("bytes"),
        "manifestCases": case({"manifest": {}, "valid": {"type": "boolean"}}),
        "manifestTextCases": case({
            "text": {"type": "string"},
            "padToBytes": ref("positiveCount"),
            "valid": {"type": "boolean"},
        }, optional=("padToBytes",)),
        "pageCases": case({
            "page": {},
            "repeatSegments": {"type": "integer", "minimum": 2},
            "valid": {"type": "boolean"},
        }, optional=("repeatSegments",)),
        "pageTextCases": case({
            "text": {"type": "string"},
            "padToBytes": ref("positiveCount"),
            "valid": {"type": "boolean"},
        }, optional=("padToBytes",)),
        "pagePositionCases": case({
            "manifest": {},
            "streamIndex": {"type": "integer"},
            "pageIndex": {"type": "integer"},
            "page": {},
            "valid": {"type": "boolean"},
        }),
        "revisionCases": case({"previous": {}, "next": {},
                               "valid": {"type": "boolean"}}),
        "pageRevisionCases": case({"previous": {}, "next": {},
                                   "valid": {"type": "boolean"}}),
        "segmentSequences": case({"steps": {
            "type": "array", "minItems": 1, "items": ref("step")}}),
        "envelopeCases": case({"result": {}, "valid": {"type": "boolean"}}),
        "envelopeManifestCases": case({"result": {}, "manifest": {},
                                       "valid": {"type": "boolean"}}),
        "requests": closed({key: ref(f"{key}Request") for key in ROUTE_KEYS}),
        "requestCases": case({"route": {"enum": ROUTE_KEYS}, "body": {},
                              "valid": {"type": "boolean"}}),
        "responseCases": case({"route": {"enum": ROUTE_KEYS}, "body": {},
                               "valid": {"type": "boolean"}}),
    }),
    "$defs": DEFS,
}

json.dump(SCHEMA, sys.stdout, indent=2, ensure_ascii=True)
sys.stdout.write("\n")
