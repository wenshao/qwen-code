package com.alibaba.qwen.code.runtimebroker;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;

class ScaleRepoProbeTest {
    @Test
    void referenceAndResultMatrix() throws Exception {
        DataSource dataSource = ScaleProbeSupport.dataSource();
        JdbcRuntimeBrokerSchema.initialize(dataSource);
        int index = 0;
        for (Map.Entry<String, BigDecimal> entry
                : ScaleProbeSupport.cases().entrySet()) {
            index++;
            referenceSide(dataSource, entry.getKey(), entry.getValue(),
                    "r" + index + "-" + UUID.randomUUID());
            resultSide(dataSource, entry.getKey(), entry.getValue(),
                    "s" + index + "-" + UUID.randomUUID());
        }
    }

    private static ToolExecutionRecord candidate(String id,
            Map<String, Object> reference) {
        return ToolExecutionRecord.prepared(id + "-exec", id + "-key",
                id + "-binding", 1, id + "-harness", id + "-rs",
                id + "-turn", id + "-tool", id + "-digest", reference);
    }

    private static Map<String, Object> reference(String id, Object value) {
        Map<String, Object> reference = new LinkedHashMap<>();
        reference.put("sessionId", id + "-rs");
        reference.put("promptId", id + "-turn");
        reference.put("callId", id + "-tool");
        reference.put("argsDigest", id + "-digest");
        if (value != null) {
            reference.put("value", value);
        }
        return reference;
    }

    private static void referenceSide(DataSource dataSource, String name,
            BigDecimal value, String id) throws Exception {
        String kind = "reference";
        ToolExecutionRecord candidate;
        try {
            candidate = candidate(id, reference(id, value));
            ScaleProbeSupport.emit(kind, name, "1 construct", "OK");
        } catch (RuntimeException error) {
            ScaleProbeSupport.emit(kind, name, "1 construct",
                    ScaleProbeSupport.failure(error));
            ScaleProbeSupport.emit(kind, name, "3 rows persisted",
                    String.valueOf(rows(dataSource, id + "-exec")));
            return;
        }
        try {
            new JdbcToolExecutionRepository(dataSource).findOrCreate(candidate);
            ScaleProbeSupport.emit(kind, name, "2 findOrCreate (write)", "OK committed");
        } catch (RuntimeException error) {
            ScaleProbeSupport.emit(kind, name, "2 findOrCreate (write)",
                    ScaleProbeSupport.failure(error));
        }
        ScaleProbeSupport.emit(kind, name, "3 rows persisted",
                String.valueOf(rows(dataSource, id + "-exec")));
        readBack(dataSource, kind, name, value, id, candidate, true);
    }

    private static void resultSide(DataSource dataSource, String name,
            BigDecimal value, String id) throws Exception {
        String kind = "result";
        ToolExecutionRecord candidate = candidate(id, reference(id, null));
        JdbcToolExecutionRepository repository =
                new JdbcToolExecutionRepository(dataSource);
        repository.findOrCreate(candidate);
        ToolExecutionRecord claimed = repository.claimDispatch(
                id + "-exec", "owner-a", Duration.ofMinutes(30));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("executionStatus", "success");
        result.put("value", value);
        ToolExecutionRecord settled;
        try {
            settled = claimed.withResult(result, 1, Instant.now());
            ScaleProbeSupport.emit(kind, name, "1 construct", "OK");
        } catch (RuntimeException error) {
            ScaleProbeSupport.emit(kind, name, "1 construct",
                    ScaleProbeSupport.failure(error));
            ScaleProbeSupport.emit(kind, name, "3 result_json persisted",
                    resultPersisted(dataSource, id + "-exec"));
            return;
        }
        try {
            repository.compareAndSet(claimed, settled, "owner-a",
                    claimed.getDispatchGeneration());
            ScaleProbeSupport.emit(kind, name, "2 compareAndSet (settle)", "OK committed");
        } catch (RuntimeException error) {
            ScaleProbeSupport.emit(kind, name, "2 compareAndSet (settle)",
                    ScaleProbeSupport.failure(error));
        }
        ScaleProbeSupport.emit(kind, name, "3 result_json persisted",
                resultPersisted(dataSource, id + "-exec"));
        readBack(dataSource, kind, name, value, id, candidate, false);
    }

    private static void readBack(DataSource dataSource, String kind,
            String name, BigDecimal value, String id,
            ToolExecutionRecord candidate, boolean inReference) {
        JdbcToolExecutionRepository reader =
                new JdbcToolExecutionRepository(dataSource);
        try {
            ToolExecutionRecord read = reader.findByExecutionCallId(id + "-exec");
            Object stored = inReference ? read.getReference().get("value")
                    : read.getResult().get("value");
            ScaleProbeSupport.emit(kind, name, "4 findByExecutionCallId",
                    "OK " + ScaleProbeSupport.describe(stored, value));
        } catch (RuntimeException error) {
            ScaleProbeSupport.emit(kind, name, "4 findByExecutionCallId",
                    ScaleProbeSupport.failure(error));
        }
        try {
            reader.findByIdempotencyKey(id + "-key");
            ScaleProbeSupport.emit(kind, name, "5 findByIdempotencyKey", "OK");
        } catch (RuntimeException error) {
            ScaleProbeSupport.emit(kind, name, "5 findByIdempotencyKey",
                    ScaleProbeSupport.failure(error));
        }
        try {
            ToolExecutionRecord again = reader.findOrCreate(candidate);
            ScaleProbeSupport.emit(kind, name, "6 idempotent retry",
                    "OK sameRequest=" + again.sameRequest(candidate));
        } catch (RuntimeException error) {
            ScaleProbeSupport.emit(kind, name, "6 idempotent retry",
                    ScaleProbeSupport.failure(error));
        }
        if (inReference) {
            try {
                ToolExecutionRecord claim = reader.claimDispatch(id + "-exec",
                        "owner-b", Duration.ofMinutes(30));
                ScaleProbeSupport.emit(kind, name, "7 claimDispatch",
                        claim == null ? "OK null" : "OK claimed");
            } catch (RuntimeException error) {
                ScaleProbeSupport.emit(kind, name, "7 claimDispatch",
                        ScaleProbeSupport.failure(error));
            }
        }
    }

    private static long rows(DataSource dataSource, String executionId)
            throws Exception {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement query = connection.prepareStatement(
                        "SELECT COUNT(*) FROM qwen_tool_execution "
                                + "WHERE execution_call_id = ?")) {
            query.setString(1, executionId);
            try (ResultSet result = query.executeQuery()) {
                result.next();
                return result.getLong(1);
            }
        }
    }

    private static String resultPersisted(DataSource dataSource,
            String executionId) throws Exception {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement query = connection.prepareStatement(
                        "SELECT execution_state, result_json FROM qwen_tool_execution "
                                + "WHERE execution_call_id = ?")) {
            query.setString(1, executionId);
            try (ResultSet result = query.executeQuery()) {
                result.next();
                String json = result.getString(2);
                return "state=" + result.getString(1) + " result_json="
                        + (json == null ? "NULL" : json.length() + " chars");
            }
        }
    }
}
