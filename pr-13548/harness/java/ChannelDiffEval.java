package com.alibaba.qwen.code.managedagent.store;

import com.alibaba.qwen.code.managedagent.store.ManagedExtensionRecords.InvalidRecordException;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.function.BooleanSupplier;

/** Java side of the differential: reads cases.jsonl on stdin, prints verdicts. */
public final class ChannelDiffEval {
    // Same parser configuration as ManagedExtensionRecordStore.JSON.
    private static final ObjectMapper JSON = JsonMapper.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();

    private static String cls(Throwable e) {
        if (e instanceof InvalidRecordException) return "R";
        String m = String.valueOf(e.getMessage());
        return "C(" + e.getClass().getSimpleName() + ":" + m.substring(0, Math.min(60, m.length())) + ")";
    }

    private static String bool(BooleanSupplier f) {
        try { return f.getAsBoolean() ? "T" : "F"; } catch (Throwable e) { String c = cls(e); return c.equals("R") ? "C(R)" : c; }
    }

    public static void main(String[] args) throws Exception {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        PrintWriter out = new PrintWriter(new java.io.OutputStreamWriter(System.out, StandardCharsets.UTF_8));
        ObjectMapper plain = new ObjectMapper();
        String line;
        while ((line = in.readLine()) != null) {
            if (line.isEmpty()) continue;
            JsonNode c = plain.readTree(line);
            String id = c.get("id").textValue();
            ManagedExtensionProjection.Body body = ManagedExtensionProjection.RECORD_BODIES.get(c.get("domain").textValue());
            JsonNode a, b = null;
            try {
                a = JSON.readTree(c.get("a").textValue());
                if (c.has("b")) b = JSON.readTree(c.get("b").textValue());
            } catch (Exception e) { out.println(id + "\tJSONERR"); continue; }
            final JsonNode fa = a, fb = b;
            if ("one".equals(c.get("op").textValue())) {
                String p;
                try { body.require().accept(fa); p = "A"; } catch (Throwable e) { p = cls(e); }
                out.println(id + "\tP=" + p + "\tS=" + bool(() -> body.isStart().test(fa)));
            } else {
                out.println(id + "\tX=" + bool(() -> body.isSuccessor().test(fa, fb)));
            }
        }
        out.flush();
    }
}
