    // ---- rig probes (PR #13654 report round 4): failed-finish objects, handler isolation, grant-only expiry ----
    private static com.aliyun.oss.OSSException denied() {
        return new com.aliyun.oss.OSSException("rig storage message", "AccessDenied",
                "rig-request", "rig-host", "rig-bucket", "rig-key", "rig-resource");
    }

    private String scan() {
        try {
            return "scan_returned=" + data.verifyNextOperation();
        } catch (RuntimeException error) {
            return "scan_escaped=" + error.getClass().getSimpleName() + "(" + error.getMessage() + ")";
        }
    }

    private String submitFinish(String operation, byte[] body) {
        try {
            return data.finish(key, "pub-1", PUBLICATION_TOKEN, operation, body, true).path("state").asText();
        } catch (RuntimeException error) {
            return "<" + refusal(error) + ">";
        }
    }

    private String terminalState(String objectKey, byte[] expected) {
        long rows = fixture.jdbc.queryForObject(
                "SELECT COUNT(*) FROM qwen_tool_publication_object WHERE object_key = ?", Long.class, objectKey);
        var pub = fixture.jdbc.queryForMap("SELECT producer_used_bytes,"
                + " CASE WHEN quarantined THEN 1 ELSE 0 END AS q FROM qwen_tool_publication");
        long nonVerified = fixture.jdbc.queryForObject(
                "SELECT COUNT(*) FROM qwen_tool_publication_object WHERE state <> 'VERIFIED'", Long.class);
        byte[] stored = bucket.objects.get(objectKey);
        String content = stored == null ? "absent" : expected != null && java.util.Arrays.equals(stored, expected)
                ? "matches_this_finish" : "other_bytes(" + stored.length + ")";
        return " | bucket_object=" + content + " db_rows_referencing_object=" + rows
                + " producer_used_bytes=" + pub.get("producer_used_bytes") + " quarantined=" + pub.get("q")
                + " non_verified_rows=" + nonVerified + " deletes=" + bucket.deletes.get()
                + " deletes_inside_tx=" + bucket.deletesInTx.get();
    }

    private String finishedResult() {
        try {
            return "finished_result=" + data.finished(key, "pub-1", WRITER_TOKEN).path("result")
                    .path("responseParts").path(0).asText().length() + "chars";
        } catch (RuntimeException error) {
            return "finished_result=<" + refusal(error) + ">";
        }
    }

    private String acceptObjectFinish(byte[] body) {
        publish("segment", 0, "bytes");
        data.verifyNextOperation();
        String accepted = submitFinish("finish", body);
        return accepted;
    }

    private String objectKey() {
        return fixture.jdbc.queryForObject(
                "SELECT object_key FROM qwen_tool_publication_object WHERE slot_key = 'terminal'", String.class);
    }

    @Test
    void probeJ_failedObjectFinishReleasesRowAndObject() {
        byte[] body = terminal(70_000);
        String accepted = acceptObjectFinish(body);
        String objectKey = objectKey();
        long used = fixture.jdbc.queryForObject("SELECT producer_used_bytes FROM qwen_tool_publication", Long.class);
        bucket.readFailure = denied();
        String scanned = scan();
        record("J1 object terminal (" + body.length + " B, accepted=" + accepted + ", producer_used_bytes before="
                + used + ") read-back AccessDenied -> scan", scanned + " " + describe("finish") + terminalState(objectKey, body));
        String second = submitFinish("finish-2", body);
        String again = scan();
        record("J2 later finish-2 with the same bytes (accepted=" + second + ") -> scan",
                again + " " + describe("finish-2") + terminalState(objectKey, body) + " " + finishedResult());
    }

    @Test
    void probeK_deleteFailsAfterFailedFinishThenDifferentBytes() {
        byte[] body = terminal(70_000);
        String accepted = acceptObjectFinish(body);
        String objectKey = objectKey();
        bucket.readFailure = denied();
        bucket.deleteFailure = denied();
        String scanned = scan();
        record("K1 object terminal accepted=" + accepted + "; read-back AccessDenied and object DELETE AccessDenied -> scan",
                scanned + " " + describe("finish") + terminalState(objectKey, body));
        byte[] other = terminal(70_001);
        String second = submitFinish("finish-2", other);
        String again = scan();
        record("K2 later finish-2 with DIFFERENT bytes (accepted=" + second + ") -> scan",
                again + " " + describe("finish-2") + terminalState(objectKey, other) + " " + finishedResult());
    }

    @Test
    void probeL_deleteFailsAfterFailedFinishThenSameBytes() {
        byte[] body = terminal(70_000);
        String accepted = acceptObjectFinish(body);
        String objectKey = objectKey();
        bucket.readFailure = denied();
        bucket.deleteFailure = denied();
        String scanned = scan();
        record("L1 object terminal accepted=" + accepted + "; read-back AccessDenied and object DELETE AccessDenied -> scan",
                scanned + " " + describe("finish") + terminalState(objectKey, body));
        String second = submitFinish("finish-2", body);
        String again = scan();
        record("L2 later finish-2 with the SAME bytes (accepted=" + second + ") -> scan",
                again + " " + describe("finish-2") + terminalState(objectKey, body) + " " + finishedResult());
    }

    private String opRow(String operation) {
        var row = fixture.jdbc.queryForMap("SELECT state, claim_epoch"
                + " FROM qwen_tool_publication_operation WHERE operation_id = ?", operation);
        // Timestamp.class: the MySQL driver returns LocalDateTime from queryForMap.
        Timestamp next = fixture.jdbc.queryForObject("SELECT verification_next_at"
                + " FROM qwen_tool_publication_operation WHERE operation_id = ?", Timestamp.class, operation);
        String due = next == null ? "null" : next.getTime() > System.currentTimeMillis() - 60_000
                ? "pushed_to_now+" + (next.getTime() - System.currentTimeMillis()) + "ms" : "unchanged(" + next + ")";
        return operation + "{state=" + row.get("state") + " claim_epoch=" + row.get("claim_epoch") + " next_at=" + due + "}";
    }

    @Test
    void probeM_handlerFailureOnFirstCandidateDoesNotAbortThePage() {
        publish("a-poison", 0, "bytes");
        data.finish(key, "pub-1", PUBLICATION_TOKEN, "z-finish", terminal(10), true);
        fixture.jdbc.update("UPDATE qwen_tool_publication_operation SET verification_next_at = ? WHERE operation_id = ?",
                Timestamp.valueOf("2001-01-01 00:00:00"), "a-poison");
        fixture.jdbc.update("UPDATE qwen_tool_publication_operation SET verification_next_at = ? WHERE operation_id = ?",
                Timestamp.valueOf("2001-01-01 00:00:01"), "z-finish");
        var armed = new java.util.concurrent.atomic.AtomicBoolean();
        var failedTransactions = new AtomicInteger();
        PlatformTransactionManager flaky = new PlatformTransactionManager() {
            @Override
            public TransactionStatus getTransaction(TransactionDefinition definition) {
                if (armed.getAndSet(false)) {
                    failedTransactions.incrementAndGet();
                    throw new org.springframework.transaction.CannotCreateTransactionException("rig: connection lost");
                }
                return fixture.manager.getTransaction(definition);
            }

            @Override
            public void commit(TransactionStatus status) {
                fixture.manager.commit(status);
            }

            @Override
            public void rollback(TransactionStatus status) {
                fixture.manager.rollback(status);
            }
        };
        var grants = spy(fixture.store);
        org.mockito.Mockito.doAnswer(invocation -> {
            armed.set(true);
            throw new ApiException(HttpStatus.CONFLICT, "managed_tool_publication_busy", "rig contention");
        }).doCallRealMethod().when(grants)
                .producerVerificationBindingLocked(anyString(), anyString(), anyString(), anyString());
        data = new ToolPublicationDataStore(fixture.jdbc, flaky, grants, fixture.sessions, bucket,
                Duration.ofSeconds(10), Duration.ofSeconds(2),
                new ToolPublicationDataStore.VerificationBudget(16 * 1024 * 1024, Duration.ofMinutes(25)));
        String scanned = scan();
        record("M candidate 1 claim -> 409 busy, then its failure-handler transaction cannot start; candidate 2 queued behind it",
                scanned + " handler_tx_failures=" + failedTransactions.get() + " " + opRow("a-poison") + " " + opRow("z-finish"));
    }

    @Test
    void probeN_grantOnlyExpiryWithLiveWriterAndCurrentActivation() {
        publish("grant", 0, "bytes");
        Number grant = fixture.jdbc.queryForObject("SELECT expires_at FROM qwen_tool_publication", Number.class);
        fixture.jdbc.update("UPDATE qwen_tool_publication SET expires_at = ?", 1L);
        String scanned = scan();
        record("N1 accepted segment; publication grant expired, writer lease live, activation current -> scan",
                scanned + " " + describe("grant") + " " + opRow("grant"));
        fixture.jdbc.update("UPDATE qwen_tool_publication SET expires_at = ?", grant.longValue());
        due("grant");
        String again = scan();
        record("N2 grant renewed -> scan", again + " " + describe("grant") + " " + opRow("grant"));
    }

