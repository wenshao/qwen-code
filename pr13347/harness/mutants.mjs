// Mutants for #13347: each is the mutation R3-6 (or a /review R1 finding)
// names as the proof of an added assertion. Edits are exact-string
// replacements; an arm whose source lacks the anchor reports "n/a".
const S = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/';
const T = 'packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/';
const STORE = S + 'store/ManagedExtensionRecordStore.java';
const SESSION_STORE = S + 'store/ManagedSessionStore.java';
const AGENT_STORE = S + 'store/ManagedAgentStore.java';
const TASKS = S + 'service/ManagedTaskService.java';
const AGENTS = S + 'service/ManagedAgentService.java';
const RST = T + 'ManagedExtensionRecordStoreTest.java';
const JOURNAL = T + 'ExtensionRecordJournal.java';

export const MUTANTS = [
  {
    id: 'M1', name: 'noRollback', src: 'R3-6 journal_tx leg / R1-2',
    what: '@Transactional(noRollbackFor = ApiException.class) on ManagedSessionStore.commit',
    edits: [[SESSION_STORE, '    @Transactional\n    public CommitReceipt commit(',
      '    @Transactional(noRollbackFor = com.alibaba.qwen.code.managedagent.api.ApiException.class)\n    public CommitReceipt commit(']],
  },
  {
    id: 'M1b', name: 'noRollback+noRefLeg', src: 'R1-2 arm 2',
    what: 'M1 plus the resource_ref leg of assertRefused removed, so control reaches the resend leg',
    edits: [[SESSION_STORE, '    @Transactional\n    public CommitReceipt commit(',
      '    @Transactional(noRollbackFor = com.alibaba.qwen.code.managedagent.api.ApiException.class)\n    public CommitReceipt commit('],
      [RST, '        assertThat(rows("qwen_managed_session_resource_ref", sessionId))\n                .as(label).isEqualTo(references);\n', '']],
  },
  {
    id: 'M2', name: 'revisionFrozen', src: 'R3-6 MySQL projection',
    what: 'drop `revision = ?` from the record UPDATE (row freezes at revision 1)',
    edits: [[STORE, '                            + " revision = ?, record_resource_id = ?,"', '                            + " record_resource_id = ?,"'],
      [STORE, '                    revision, resourceId, body.taskKind() == null', '                    resourceId, body.taskKind() == null']],
  },
  {
    id: 'M3', name: 'openingDomain', src: 'R3-6 EXPLAIN',
    what: 'opening-command query gains `AND domain = ?` (prefix scan)',
    edits: [[STORE, '" session_scope_key = ? AND operation_hash = ?"', '" session_scope_key = ? AND operation_hash = ? AND domain = ?"'],
      [STORE, 'Integer.class, scopeKey, operationHash);', 'Integer.class, scopeKey, operationHash, domain);']],
  },
  {
    id: 'M3b', name: 'openingConcat', src: 'rig (2-placeholder degrade)',
    what: 'opening-command query compares CONCAT(operation_hash, \'\') = ? (same arity, index column unusable)',
    edits: [[STORE, '" session_scope_key = ? AND operation_hash = ?"', '" session_scope_key = ? AND CONCAT(operation_hash, \'\') = ?"']],
  },
  {
    id: 'M4', name: 'recordLine1', src: 'R3-6 line diagnostic',
    what: 'hard-code "Record line 1" in the unparsable-line answer',
    edits: [[STORE, '"Record line " + (index + 1) + " is not', '"Record line " + 1 + " is not']],
  },
  {
    id: 'M5', name: 'findTaskUnscoped', src: 'R3-6 findTask scope',
    what: 'findTask matches record_key alone (drops session_scope_key = ?)',
    edits: [[STORE, '                        + " session_scope_key = ? AND record_key = ? AND task_kind IS NOT NULL",\n                (result, row) -> taskRow(result, tenantId, sessionId),\n                ManagedSessionStore.sessionScopeKey(tenantId, sessionId),\n                recordKey)',
      '                        + " record_key = ? AND task_kind IS NOT NULL",\n                (result, row) -> taskRow(result, tenantId, sessionId),\n                recordKey)']],
  },
  {
    id: 'M6', name: 'noHasMoreGuard', src: 'R3-6 empty list',
    what: 'remove the hasMore guard in nextCursor (empty list throws)',
    edits: [[TASKS, '        if (!page.hasMore()) {\n            return null;\n        }\n        TaskRow last', '        TaskRow last']],
  },
  {
    id: 'M7', name: 'timeSwap', src: 'R3-6 task bodies',
    what: 'swap startedAt/settledAt in both task mappers',
    edits: [[TASKS, 'view.runtimeState(), view.createdAt(), view.startedAt(),\n                view.settledAt(), NO_ARTIFACTS', 'view.runtimeState(), view.createdAt(), view.settledAt(),\n                view.startedAt(), NO_ARTIFACTS'],
      [TASKS, 'view.createdAt(), view.startedAt(), view.settledAt(),\n                NO_ARTIFACTS', 'view.createdAt(), view.settledAt(), view.startedAt(),\n                NO_ARTIFACTS']],
  },
  {
    id: 'M8', name: 'noDeletingGuard', src: 'R3-6 DELETING',
    what: 'drop the DELETING disjunct of appendLiveSessionEventIfAbsent',
    edits: [[AGENT_STORE, 'if (session.isEmpty() || "DELETING".equals(session.get().status())\n                || "DELETED"', 'if (session.isEmpty()\n                || "DELETED"']],
  },
  {
    id: 'M9', name: 'announceOff', src: 'R3-6 announcement',
    what: 'appendLiveSessionEventIfAbsent never appends',
    edits: [[AGENT_STORE, 'if (session.isEmpty() || "DELETING".equals(session.get().status())', 'if (true || "DELETING".equals(session.get().status())']],
  },
  {
    id: 'M10', name: 'announceEarlyNewTx', src: 'R1-1',
    what: 'every Stage H revision announces task.updated in its own transaction before any rule check',
    edits: [[STORE, '            if (body != null) {\n                require(index < eventCount,',
      '            if (body != null) {\n                if (sessions != null) {\n                    org.springframework.transaction.support.TransactionTemplate own = new org.springframework.transaction.support.TransactionTemplate(new org.springframework.jdbc.datasource.DataSourceTransactionManager(jdbc.getDataSource()));\n                    own.setPropagationBehavior(org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW);\n                    final int at = index;\n                    own.executeWithoutResult(status -> sessions.appendLiveSessionEventIfAbsent(tenantId, sessionId, "task.updated", java.util.Map.of("taskId", "task_early", "state", "pending"), "early:" + firstSequence + ":" + at + ":" + java.util.UUID.randomUUID()));\n                }\n                require(index < eventCount,']],
  },
  {
    id: 'M10b', name: 'announceOnRefusal', src: 'R1-1 (isolated)',
    what: 'a refused Stage H revision leaves a task.updated behind (appended in its own transaction); accepted commits unchanged',
    edits: [[STORE, '                applyRevision(tenantId, workspaceId, sessionId, domain, body,\n                        payload.get("operationId").textValue(),\n                        payload.get("recordRef"),\n                        firstSequence + index, occurredAt, resources);\n                applied = true;',
      '                try {\n                    applyRevision(tenantId, workspaceId, sessionId, domain, body,\n                            payload.get("operationId").textValue(),\n                            payload.get("recordRef"),\n                            firstSequence + index, occurredAt, resources);\n                } catch (ApiException refused) {\n                    if (sessions != null) {\n                        org.springframework.transaction.support.TransactionTemplate own = new org.springframework.transaction.support.TransactionTemplate(new org.springframework.jdbc.datasource.DataSourceTransactionManager(jdbc.getDataSource()));\n                        own.setPropagationBehavior(org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW);\n                        own.executeWithoutResult(status -> sessions.appendLiveSessionEventIfAbsent(tenantId, sessionId, "task.updated", java.util.Map.of("taskId", "task_leaked", "state", "pending"), "leak:" + java.util.UUID.randomUUID()));\n                    }\n                    throw refused;\n                }\n                applied = true;']],
  },
  {
    id: 'M11', name: 'noTenantConjunct', src: 'R3-6 session identity',
    what: 'session-key check ignores tenantId',
    edits: [[STORE, 'require(tenantId.equals(key.get("tenantId").textValue())\n                && workspaceId', 'require(true\n                && workspaceId']],
  },
  {
    id: 'M12', name: 'noSessionConjunct', src: 'R3-6 session identity',
    what: 'session-key check ignores sessionId',
    edits: [[STORE, '\n                && sessionId.equals(key.get("sessionId").textValue()),\n                "The Stage H record names another Session.");', ',\n                "The Stage H record names another Session.");']],
  },
  {
    id: 'M13', name: 'missingAsMismatch', src: 'R3-6 recordRef fifth field',
    what: 'a recordRef naming an absent resource answers the mismatch (409 rejected) instead of resource_missing',
    edits: [[STORE, '        StoredResource resource = resources.apply(resourceId);\n        require(resource.kind().equals(recordRef.get("kind").textValue())',
      '        StoredResource resource;\n        try {\n            resource = resources.apply(resourceId);\n        } catch (ApiException missing) {\n            throw rejected("The Stage H record does not match its resource.");\n        }\n        require(resource.kind().equals(recordRef.get("kind").textValue())']],
  },
  {
    id: 'M14', name: 'noDigestCheck', src: 'R3-6 resource refusals (corrupt)',
    what: 'storedResource skips verifyStoredResource',
    edits: [[SESSION_STORE, '        verifyStoredResource(resource);\n        return new StoredResource(', '        return new StoredResource(']],
  },
  {
    id: 'M15', name: 'noResourceScope', src: 'R3-6 resource refusals (foreign)',
    what: 'storedResource skips requireResourceScope',
    edits: [[SESSION_STORE, '        requireResourceScope(resource, tenantId, workspaceId, sessionId,\n                resourceId);\n        if (!"REFERENCED".equals(resource.state())) {\n            throw conflict(ManagedSessionStoreModels.ERROR_RESOURCE_MISSING,',
      '        if (!"REFERENCED".equals(resource.state())) {\n            throw conflict(ManagedSessionStoreModels.ERROR_RESOURCE_MISSING,']],
  },
  {
    id: 'M16', name: 'missingCode', src: 'R3-6 resource refusals (missing)',
    what: 'an absent referenced resource answers another 409 code (managed_session_resource_unknown)',
    edits: [[SESSION_STORE, '        ResourceRow resource = findResource(scopeKey, resourceId);\n        if (resource == null) {\n            throw conflict(ManagedSessionStoreModels.ERROR_RESOURCE_MISSING,',
      '        ResourceRow resource = findResource(scopeKey, resourceId);\n        if (resource == null) {\n            throw conflict("managed_session_resource_unknown",']],
  },
  {
    id: 'M17', name: 'noCapabilities', src: 'R3-11 required capabilities',
    what: 'WebShellSession is served without its capabilities object',
    edits: [[AGENTS, '                new WebShellSessionCapabilities(true, hasArtifacts(session), hasActions(session),\n                        maySubmitWorkspaceTurn(session, actorId), supportsClose(session),\n                        retention, retention, retention));',
      '                null);']],
  },
  {
    id: 'D1', name: 'anchorDrift', src: 'R3-6 depth probe (fixture drift, not a product mutant)',
    what: 'the journal helper writes parentUuid before uuid, so the `{"uuid"` anchor stops matching',
    edits: [[JOURNAL, '                .put("uuid", UUID.randomUUID().toString())\n                .putNull("parentUuid")', '                .putNull("parentUuid")\n                .put("uuid", UUID.randomUUID().toString())']],
  },
];
