package com.alibaba.qwen.code.runtimebroker.managedworkspace;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * A managed-context/1 worker written from the design document alone, the way
 * a W0c author would write it in Java: Jackson for JSON, W0a's Java
 * ContextBinding for the binding rules and the digest. It does not look at
 * the TypeScript module. -Dmutant=NAME switches on one plausible mistake.
 */
final class DocWorker {
    static final ObjectMapper JSON = new ObjectMapper();
    static final String PROTOCOL = "managed-context/1";
    static final String MUTANT = System.getProperty("mutant", "none");
    /** Whether sameField runs for the installation route. */
    static boolean inInstall;

    static boolean on(String name) {
        return MUTANT.equals(name);
    }

    static final Set<String> BOOT_KEYS = Set.of("type", "version",
            "managedContext", "runtimeInstanceId", "runtimeIncarnation",
            "leaseId", "provisionRequestId", "token", "epoch",
            "capabilityDigest", "isolationClass", "tenantId", "workspaceId",
            "workspaceGeneration", "storageId", "mountRoot");
    static final Set<String> READY_KEYS = Set.of("type", "version",
            "managedContext", "runtimeInstanceId", "runtimeIncarnation",
            "leaseId", "epoch", "url");
    static final Set<String> ATTESTATION_KEYS = Set.of("protocolVersion",
            "managedContext", "provisionRequestId", "tenantId", "workspaceId",
            "workspaceGeneration", "storageId", "mountRoot",
            "capabilityDigest", "isolationClass");
    static final Set<String> INSTALLATION_KEYS = Set.of("protocolVersion",
            "managedContext", "operationId", "sessionId", "binding",
            "contextDigest");
    static final Set<String> BINDING_KEYS = Set.of("tenantId", "workspaceId",
            "workspaceGeneration", "storageId", "cwdRelative",
            "contextConfigRef", "contextRevision");
    static final List<String> ATTESTED = List.of("provisionRequestId",
            "tenantId", "workspaceId", "workspaceGeneration", "storageId",
            "mountRoot", "capabilityDigest", "isolationClass");
    static final List<String> WORKSPACE = List.of("tenantId", "workspaceId",
            "workspaceGeneration", "storageId");
    static final List<String> IDENTITY = List.of("provisionRequestId",
            "tenantId", "workspaceId", "storageId");

    static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9._~+/-]+=*");
    static final Pattern DIGEST = Pattern.compile("sha256:[0-9a-f]{64}");
    static final Pattern DECIMAL = Pattern.compile("[1-9][0-9]{0,18}");
    static final Pattern IDENTIFIER = Pattern.compile("[A-Za-z0-9._:-]{1,128}");
    static final Pattern READY_URL = Pattern.compile(
            "http://127\\.0\\.0\\.1:([1-9][0-9]{0,4})");
    static final long MAX_EPOCH = (1L << 53) - 1;

    // ---- mistakes a Java port commonly makes -------------------------------
    // J8: /^...$/ ported as find(), where Java's $ also matches before a
    // final line terminator.
    static final Pattern IDENTIFIER_FIND = Pattern.compile(
            "^[A-Za-z0-9._:-]{1,128}$");
    static final Pattern TOKEN_FIND = Pattern.compile("^[A-Za-z0-9._~+/-]+=*$");
    static final Pattern DIGEST_FIND = Pattern.compile("^sha256:[0-9a-f]{64}$");
    // J9 / R5: \d under UNICODE_CHARACTER_CLASS matches every Nd digit.
    static final Pattern DECIMAL_UNICODE = Pattern.compile("[1-9]\\d{0,18}",
            Pattern.UNICODE_CHARACTER_CLASS);
    static final Pattern READY_URL_UNICODE = Pattern.compile(
            "http://127\\.0\\.0\\.1:([1-9]\\d{0,4})",
            Pattern.UNICODE_CHARACTER_CLASS);
    static final Pattern IDENTIFIER_UNICODE = Pattern.compile(
            "[A-Za-z\\d._:-]{1,128}", Pattern.UNICODE_CHARACTER_CLASS);
    static final Pattern TOKEN_UNICODE = Pattern.compile(
            "[A-Za-z\\d._~+/-]+=*", Pattern.UNICODE_CHARACTER_CLASS);
    static final Pattern DIGEST_UNICODE = Pattern.compile(
            "sha256:[\\da-f]{64}", Pattern.UNICODE_CHARACTER_CLASS);
    // J15: the identifier class without its length bound, for operationId.
    static final Pattern OPERATION_UNBOUNDED = Pattern.compile(
            "[A-Za-z0-9._:-]+");
    // J16: a star where the token needs a plus.
    static final Pattern TOKEN_STAR = Pattern.compile("[A-Za-z0-9._~+/-]*=*");

    record Outcome(int status, String code, JsonNode body) {
        JsonNode toJson() {
            ObjectNode node = JSON.createObjectNode();
            node.put("status", status);
            if (body != null) {
                node.set("body", body);
            } else {
                node.put("code", code);
            }
            return node;
        }
    }

    static final Outcome INVALID = new Outcome(400,
            "managed_runtime_attestation_invalid", null);
    static final Outcome IDENTITY_CONFLICT = new Outcome(409,
            "managed_runtime_identity_conflict", null);
    static final Outcome CONTEXT_CONFLICT = new Outcome(409,
            "managed_context_conflict", null);

    // ---- field readers ------------------------------------------------------
    static boolean closed(JsonNode value, Set<String> keys) {
        if (value == null || !value.isObject() || value.size() != keys.size()) {
            return false;
        }
        Set<String> present = new HashSet<>();
        value.fieldNames().forEachRemaining(present::add);
        return present.equals(keys);
    }

    /** The string value, or null when the field is not a JSON string. */
    static String text(JsonNode object, String key) {
        JsonNode value = object.get(key);
        if (value == null) {
            return null;
        }
        if (on("J10")) {
            // asText() stringifies numbers and booleans instead of refusing.
            return value.isContainerNode() ? null : value.asText();
        }
        return value.isTextual() ? value.textValue() : null;
    }

    static boolean isIdentifier(String value) {
        if (value == null) {
            return false;
        }
        if (on("J8")) {
            return IDENTIFIER_FIND.matcher(value).find();
        }
        if (on("R5")) {
            return IDENTIFIER_UNICODE.matcher(value).matches();
        }
        return WorkspaceValues.isIdentifier(value);
    }

    static boolean isToken(String value) {
        if (value == null || value.length() > 512) {
            return false;
        }
        if (on("J8")) {
            return TOKEN_FIND.matcher(value).find();
        }
        if (on("J16")) {
            return TOKEN_STAR.matcher(value).matches();
        }
        if (on("R5")) {
            return TOKEN_UNICODE.matcher(value).matches();
        }
        return TOKEN.matcher(value).matches();
    }

    static boolean isDigest(String value) {
        if (value == null) {
            return false;
        }
        if (on("J8")) {
            return DIGEST_FIND.matcher(value).find();
        }
        if (on("R5")) {
            return DIGEST_UNICODE.matcher(value).matches();
        }
        return DIGEST.matcher(value).matches();
    }

    /** Canonical decimal text from 1 to 2^63-1, or -1. */
    static long decimal(String value) {
        if (value == null) {
            return -1;
        }
        try {
            if (on("J7")) {
                // No leading zero, then let parseLong judge the rest.
                return value.isEmpty() || value.charAt(0) == '0' ? -1
                        : Math.max(-1, Long.parseLong(value));
            }
            if (on("J9")) {
                return DECIMAL_UNICODE.matcher(value).matches()
                        ? Long.parseLong(value) : -1;
            }
            if (on("J9b")) {
                // First digit ASCII 1-9, the rest Character.isDigit.
                if (value.isEmpty() || value.length() > 19
                        || value.charAt(0) < '1' || value.charAt(0) > '9') {
                    return -1;
                }
                for (int i = 1; i < value.length(); i++) {
                    if (!Character.isDigit(value.charAt(i))) {
                        return -1;
                    }
                }
                return Long.parseLong(value);
            }
            return DECIMAL.matcher(value).matches() ? Long.parseLong(value)
                    : -1;
        } catch (NumberFormatException overflow) {
            return -1;
        }
    }

    static boolean isWellFormed(String value) {
        return WorkspaceValues.isWellFormed(value);
    }

    static boolean isMountRoot(String value) {
        if (value == null || value.isEmpty() || !isWellFormed(value)) {
            return false;
        }
        boolean absolute = value.startsWith("/") || value.startsWith("\\\\")
                || (value.length() >= 3 && isAsciiLetter(value.charAt(0))
                        && value.charAt(1) == ':'
                        && (value.charAt(2) == '\\' || value.charAt(2) == '/'));
        if (!absolute || WorkspaceValues.hasControl(value)) {
            return false;
        }
        return value.getBytes(StandardCharsets.UTF_8).length <= 4096;
    }

    static boolean isAsciiLetter(char c) {
        return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
    }

    static boolean isEpoch(JsonNode value) {
        return value != null && value.isIntegralNumber()
                && value.canConvertToLong() && value.longValue() >= 1
                && value.longValue() <= MAX_EPOCH;
    }

    static boolean isInt(JsonNode value, int expected) {
        return value != null && value.isIntegralNumber()
                && value.canConvertToInt() && value.intValue() == expected;
    }

    static boolean isSessionId(String value) {
        return value != null && !value.isEmpty() && value.length() <= 512
                && value.indexOf('\0') < 0 && isWellFormed(value);
    }

    static boolean hasValidAttestedFields(JsonNode fields) {
        String isolation = text(fields, "isolationClass");
        return isIdentifier(text(fields, "provisionRequestId"))
                && isIdentifier(text(fields, "tenantId"))
                && isIdentifier(text(fields, "workspaceId"))
                && decimal(text(fields, "workspaceGeneration")) >= 1
                && isStorageId(text(fields, "storageId"))
                && isMountRoot(text(fields, "mountRoot"))
                && isDigest(text(fields, "capabilityDigest"))
                && ("session".equals(isolation)
                        || "workspace".equals(isolation));
    }

    static boolean isStorageId(String value) {
        if (value == null || value.isEmpty() || value.length() > 256) {
            return false;
        }
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c < 0x21 || c > 0x7E) {
                return false;
            }
        }
        return true;
    }

    // ---- boot and ready -----------------------------------------------------
    static JsonNode parseBoot(JsonNode boot) {
        if (!closed(boot, BOOT_KEYS)
                || !"boot".equals(text(boot, "type"))
                || !isInt(boot.get("version"), 2)
                || !PROTOCOL.equals(text(boot, "managedContext"))
                || !isToken(text(boot, "token"))
                || !isIdentifier(text(boot, "runtimeInstanceId"))
                || !isIdentifier(text(boot, "runtimeIncarnation"))
                || !isIdentifier(text(boot, "leaseId"))
                || !isEpoch(boot.get("epoch"))
                || !hasValidAttestedFields(boot)) {
            return null;
        }
        return boot;
    }

    static boolean isReady(JsonNode ready, JsonNode boot) {
        if (!closed(ready, READY_KEYS)
                || !"ready".equals(text(ready, "type"))
                || !isInt(ready.get("version"), 2)
                || !PROTOCOL.equals(text(ready, "managedContext"))
                || !sameEcho(text(ready, "runtimeInstanceId"),
                        boot.get("runtimeInstanceId").textValue())
                || !sameEcho(text(ready, "runtimeIncarnation"),
                        boot.get("runtimeIncarnation").textValue())
                || !sameEcho(text(ready, "leaseId"),
                        boot.get("leaseId").textValue())
                || !isEpoch(ready.get("epoch"))
                || ready.get("epoch").longValue()
                        != boot.get("epoch").longValue()) {
            return false;
        }
        String url = text(ready, "url");
        if (url == null) {
            return false;
        }
        if (on("J5")) {
            return uriReady(url);
        }
        var matcher = (on("J9") || on("J9b") ? READY_URL_UNICODE : READY_URL)
                .matcher(url);
        try {
            return matcher.matches()
                    && Integer.parseInt(matcher.group(1)) <= 65535;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    static boolean sameEcho(String actual, String expected) {
        if (actual == null) {
            return false;
        }
        if (on("J4")) {
            return actual.equalsIgnoreCase(expected);
        }
        if (on("R3c")) {
            return actual.strip().equals(expected);
        }
        return actual.equals(expected);
    }

    /** J5: java.net.URI instead of the exact pattern; forgets the fragment. */
    static boolean uriReady(String url) {
        try {
            URI uri = new URI(url);
            String authority = uri.getRawAuthority();
            if (authority == null) {
                return false;
            }
            String port = authority.substring(authority.lastIndexOf(':') + 1);
            return "http".equals(uri.getScheme())
                    && "127.0.0.1".equals(uri.getHost())
                    && uri.getPort() >= 1 && uri.getPort() <= 65535
                    && !port.startsWith("0")
                    && (uri.getRawPath() == null || uri.getRawPath().isEmpty())
                    && uri.getRawQuery() == null
                    && uri.getRawUserInfo() == null;
        } catch (Exception e) {
            return false;
        }
    }

    // ---- attestation --------------------------------------------------------
    static JsonNode attestationResponse(JsonNode boot) {
        ObjectNode body = JSON.createObjectNode();
        body.put("protocolVersion", 3);
        body.put("managedContext", PROTOCOL);
        for (String key : List.of("runtimeInstanceId", "runtimeIncarnation",
                "leaseId", "epoch")) {
            body.set(key, boot.get(key));
        }
        for (String key : ATTESTED) {
            body.set(key, boot.get(key));
        }
        return body;
    }

    static Outcome attest(JsonNode request, JsonNode boot) {
        if (!closed(request, ATTESTATION_KEYS)
                || !isInt(request.get("protocolVersion"), 3)
                || !PROTOCOL.equals(text(request, "managedContext"))
                || !hasValidAttestedFields(request)) {
            return INVALID;
        }
        for (String key : ATTESTED) {
            if (!sameField(key, text(request, key),
                    boot.get(key).textValue())) {
                return IDENTITY_CONFLICT;
            }
        }
        return new Outcome(200, null, attestationResponse(boot));
    }

    /** Exact comparison, unless a mutant loosens it. */
    static boolean sameField(String key, String actual, String expected) {
        if ((on("J1") || (on("J1a") && !inInstall) || (on("J1i") && inInstall))
                && IDENTITY.contains(key)) {
            return actual.equalsIgnoreCase(expected);
        }
        if (key.equals("mountRoot")) {
            if (on("J2")) {
                return java.nio.file.Path.of(actual).normalize()
                        .equals(java.nio.file.Path.of(expected).normalize());
            }
            if (on("R2c-strip")) {
                return actual.strip().equals(expected);
            }
            if (on("R2c-nfkc")) {
                return Normalizer.normalize(actual, Normalizer.Form.NFKC)
                        .equals(expected);
            }
            if (on("R2c-pct")) {
                return percentDecode(actual).equals(expected);
            }
        }
        if (key.equals("storageId")) {
            if (on("J3")) {
                return uriEquals(actual, expected);
            }
            if (on("J3-pct")) {
                return percentDecode(actual).equals(percentDecode(expected));
            }
            if (on("R2a")) {
                return storagePathIgnoringCase(actual, expected);
            }
            if (on("R2b")) {
                return storageSlashes(actual).equals(storageSlashes(expected));
            }
        }
        return actual.equals(expected);
    }

    static String percentDecode(String value) {
        try {
            return URLDecoder.decode(value.replace("+", "%2B"),
                    StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return value;
        }
    }

    static boolean uriEquals(String a, String b) {
        try {
            return URI.create(a).normalize().equals(URI.create(b).normalize());
        } catch (IllegalArgumentException e) {
            return a.equals(b);
        }
    }

    /** R2a: scheme and host exact, path without regard to case. */
    static boolean storagePathIgnoringCase(String a, String b) {
        int ia = a.indexOf('/', a.indexOf("://") + 3);
        int ib = b.indexOf('/', b.indexOf("://") + 3);
        if (ia < 0 || ib < 0) {
            return a.equals(b);
        }
        return a.substring(0, ia).equals(b.substring(0, ib))
                && a.substring(ia).equalsIgnoreCase(b.substring(ib));
    }

    /** R2b: trailing slash stripped and // collapsed after the scheme. */
    static String storageSlashes(String value) {
        int start = value.indexOf("://");
        String head = start < 0 ? "" : value.substring(0, start + 3);
        String rest = start < 0 ? value : value.substring(start + 3);
        rest = rest.replaceAll("/{2,}", "/");
        while (rest.endsWith("/") && rest.length() > 1) {
            rest = rest.substring(0, rest.length() - 1);
        }
        return head + rest;
    }

    // ---- installation -------------------------------------------------------
    record Installation(String sessionId, String contextDigest,
            String cwdRelative, JsonNode receipt) {
    }

    static final class Installations {
        final JsonNode boot;
        final Map<String, Installation> operations = new HashMap<>();
        /** Session ID to installed context digest (or cwd, for J13). */
        final Map<String, String> sessions = new HashMap<>();

        Installations(JsonNode boot) {
            this.boot = parseBoot(boot);
            if (this.boot == null) {
                throw new IllegalArgumentException("boot");
            }
        }

        String sessionKey(String id) {
            if (on("J6") || on("J6s")) {
                return id.toLowerCase(Locale.ROOT);
            }
            if (on("R3a")) {
                return id.strip();
            }
            if (on("R3b")) {
                return Normalizer.normalize(id, Normalizer.Form.NFC);
            }
            return id;
        }

        String operationKey(String id) {
            return on("J6") || on("J6o") ? id.toLowerCase(Locale.ROOT) : id;
        }

        boolean sameOwner(String recorded, String sessionId) {
            if (on("R1")) {
                return recorded.equalsIgnoreCase(sessionId);
            }
            return sessionKey(recorded).equals(sessionKey(sessionId));
        }

        Outcome install(JsonNode request) {
            inInstall = true;
            try {
                return installChecked(request);
            } finally {
                inInstall = false;
            }
        }

        Outcome installChecked(JsonNode request) {
            JsonNode binding = request == null ? null : request.get("binding");
            String operationId = closed(request, INSTALLATION_KEYS)
                    ? text(request, "operationId") : null;
            boolean operationOk = operationId != null
                    && (on("J15") ? OPERATION_UNBOUNDED.matcher(operationId)
                            .matches() : isIdentifier(operationId));
            if (!closed(request, INSTALLATION_KEYS)
                    || !closed(binding, BINDING_KEYS)
                    || !isInt(request.get("protocolVersion"), 3)
                    || !PROTOCOL.equals(text(request, "managedContext"))
                    || !operationOk
                    || !isSessionId(text(request, "sessionId"))
                    || !isDigest(text(request, "contextDigest"))) {
                return INVALID;
            }
            String sessionId = text(request, "sessionId");
            String requestDigest = text(request, "contextDigest");
            Installation previous = operations.get(operationKey(operationId));

            // J11b: another Session's reuse of the operation checked before
            // the digest.
            if (on("J11b") && previous != null
                    && !sameOwner(previous.sessionId(), sessionId)) {
                return CONTEXT_CONFLICT;
            }
            // J11c: the whole operation-reuse check ahead of the digest check,
            // trusting the claimed digest (#12700 deferred item 3).
            if (on("J11c") && previous != null) {
                return sameOwner(previous.sessionId(), sessionId)
                        && previous.contextDigest().equals(requestDigest)
                        ? new Outcome(200, null, previous.receipt())
                        : CONTEXT_CONFLICT;
            }
            ContextBinding parsed = binding(binding);
            if (on("R7") && parsed == null) {
                parsed = canonicalBinding(binding);
            }
            String digest = parsed == null ? null : parsed.getContextDigest();
            if (digest == null || !digest.equals(requestDigest)) {
                if (on("R4b") && previous != null
                        && !sameOwner(previous.sessionId(), sessionId)) {
                    operations.put(operationKey(operationId), new Installation(
                            sessionId, requestDigest, "", previous.receipt()));
                }
                if (on("R4c") && previous == null) {
                    sessions.put(sessionKey(sessionId), requestDigest);
                }
                if (on("R4c2") && previous == null
                        && sessions.containsKey(sessionKey(sessionId))) {
                    sessions.put(sessionKey(sessionId), requestDigest);
                }
                return INVALID;
            }
            // J11: another Session's reuse checked before the Workspace part.
            if (on("J11") && previous != null
                    && !sameOwner(previous.sessionId(), sessionId)) {
                return CONTEXT_CONFLICT;
            }
            for (String key : WORKSPACE) {
                if (!sameField(key, text(binding, key),
                        boot.get(key).textValue())) {
                    if (on("R4a")) {
                        sessions.put(sessionKey(sessionId), digest);
                    }
                    if (on("R4a2") && sessions.containsKey(sessionKey(sessionId))) {
                        sessions.put(sessionKey(sessionId), digest);
                    }
                    return IDENTITY_CONFLICT;
                }
            }
            String cwd = parsed.getCwdRelative();
            if (previous != null) {
                boolean same = sameOwner(previous.sessionId(), sessionId)
                        && (on("J14") || (on("J13")
                                ? previous.cwdRelative().equals(cwd)
                                : previous.contextDigest().equals(digest)));
                if (same) {
                    return new Outcome(200, null, previous.receipt());
                }
                if (on("J12a")) {
                    Installation replaced = new Installation(sessionId, digest,
                            cwd, receipt(operationId, sessionId, digest,
                                    binding));
                    operations.put(operationKey(operationId), replaced);
                    sessions.put(sessionKey(sessionId), digest);
                }
                return CONTEXT_CONFLICT;
            }
            String installed = sessions.get(sessionKey(sessionId));
            String mine = on("J13") ? cwd : digest;
            if (installed != null && !installed.equals(mine)) {
                if (on("J12b")) {
                    sessions.put(sessionKey(sessionId), mine);
                }
                return CONTEXT_CONFLICT;
            }
            JsonNode receipt = receipt(operationId, sessionId, digest, binding);
            operations.put(operationKey(operationId),
                    new Installation(sessionId, digest, cwd, receipt));
            sessions.put(sessionKey(sessionId), mine);
            return new Outcome(200, null, receipt);
        }

        JsonNode receipt(String operationId, String sessionId, String digest,
                JsonNode binding) {
            ObjectNode receipt = JSON.createObjectNode();
            receipt.put("protocolVersion", 3);
            receipt.put("managedContext", PROTOCOL);
            receipt.put("operationId", operationId);
            receipt.put("sessionId", sessionId);
            receipt.set("runtimeInstanceId", boot.get("runtimeInstanceId"));
            receipt.set("runtimeIncarnation", boot.get("runtimeIncarnation"));
            receipt.set("epoch", boot.get("epoch"));
            receipt.put("contextDigest", digest);
            receipt.put("contextRevision", text(binding, "contextRevision"));
            receipt.put("workspaceGeneration",
                    text(binding, "workspaceGeneration"));
            return receipt;
        }
    }

    /** W0a's Java ContextBinding over the wire strings, or null. */
    static ContextBinding binding(JsonNode binding) {
        long generation = decimal(text(binding, "workspaceGeneration"));
        long revision = decimal(text(binding, "contextRevision"));
        if (generation < 1 || revision < 1) {
            return null;
        }
        try {
            String tenant = text(binding, "tenantId");
            String workspace = text(binding, "workspaceId");
            // J8 lets a trailing newline through the worker's own checks; W0a's
            // ContextBinding still refuses it, so check the identifiers here
            // with the worker's rule first, as a port would.
            if (!isIdentifier(tenant) || !isIdentifier(workspace)) {
                return null;
            }
            return new ContextBinding(tenant, workspace, generation,
                    text(binding, "storageId"), text(binding, "cwdRelative"),
                    text(binding, "contextConfigRef"), revision);
        } catch (IllegalArgumentException | NullPointerException e) {
            return null;
        }
    }

    /** R7: canonicalize the directory, then hash. */
    static ContextBinding canonicalBinding(JsonNode binding) {
        try {
            long generation = decimal(text(binding, "workspaceGeneration"));
            long revision = decimal(text(binding, "contextRevision"));
            return new ContextBinding(text(binding, "tenantId"),
                    text(binding, "workspaceId"), generation,
                    text(binding, "storageId"),
                    WorkspaceRelativePath.normalize(
                            text(binding, "cwdRelative")),
                    text(binding, "contextConfigRef"), revision);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private DocWorker() {
    }
}
