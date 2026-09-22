import os, shutil, subprocess, sys, re, json
H='/root/verify/pr12458-harness'
R='runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/'
J=R+'JdbcToolExecutionRepository.java'; B=R+'BrokerValues.java'; T=R+'ToolExecutionRecord.java'
# (id, file, old, new, occurrence index (0-based), description)
M=[
('M01',J,'        if (existing != null) {\n            return existing;\n        }\n        try {','        try {',0,'findOrCreate: pre-insert lookup'),
('M02',J,'            if (!JdbcRepositorySupport.isConstraintViolation(failure)) {','            if (true) {',0,'findOrCreate: constraint-violation recovery'),
('M03',J,'            if (winner != null) {\n                return winner;\n            }','',0,'findOrCreate: return concurrent winner'),
('M04',J,'            if (duplicateId != null) {','            if (false) {',0,'findOrCreate: duplicate executionCallId -> IAE'),
('M05',J,'                    if (!key.equals(record.getIdempotencyKey())) {','                    if (false) {',0,'findByIdempotencyKey: full-key re-check'),
('M07',J,'            if (current == null || !current.sameIdentity(expected)\n                    || current.getVersion() != expected.getVersion()\n                    || current.isSettled()','            if (current == null\n                    || current.getVersion() != expected.getVersion()\n                    || current.isSettled()',0,'CAS: sameIdentity'),
('M08',J,'                    || current.getVersion() != expected.getVersion()\n                    || current.isSettled()\n                    || current.getState()\n                            == ToolExecutionRecord.State.UNKNOWN\n                    || !current.sameDispatch','                    || current.isSettled()\n                    || current.getState()\n                            == ToolExecutionRecord.State.UNKNOWN\n                    || !current.sameDispatch',0,'CAS: version fence'),
('M09',J,'                    || current.isSettled()\n                    || current.getState()\n                            == ToolExecutionRecord.State.UNKNOWN\n                    || !current.sameDispatch','                    || current.getState()\n                            == ToolExecutionRecord.State.UNKNOWN\n                    || !current.sameDispatch',0,'CAS: settled is final'),
('M10',J,'                    || current.getState()\n                            == ToolExecutionRecord.State.UNKNOWN\n                    || !current.sameDispatch','                    || !current.sameDispatch',0,'CAS: UNKNOWN refused'),
('M11',J,'                    || !current.sameDispatch(expected)\n','',0,'CAS: sameDispatch'),
('M12',J,'                    || !current.hasLiveDispatchAt(\n                            JdbcRepositorySupport.databaseNow(connection))\n','',0,'CAS: live lease'),
('M13',J,'                    || !current.getDispatchOwner().equals(owner)\n','',0,'CAS: owner fence'),
('M14',J,'                    || current.getDispatchGeneration()\n                            != dispatchGeneration) {\n                return null;','                    ) {\n                return null;',0,'CAS: generation fence'),
('M15',J,'            if (nextState == ToolExecutionRecord.State.PREPARED\n                    || nextState','            if (false\n                    || nextState',0,'CAS: no move back to PREPARED'),
('M16',J,'                    || nextState == ToolExecutionRecord.State.DISPATCHING\n                            && current.getState()\n                                    != ToolExecutionRecord.State.DISPATCHING) {','                    ) {',0,'CAS: no move back to DISPATCHING'),
('M17',J,'            if (current.isCancelRequested()\n                    && !replacement.isCancelRequested()) {','            if (false) {',0,'CAS: cancellation is sticky'),
('M18',J,'            ToolExecutionRecord updated = replacement.withVersion(\n                    expected.getVersion() + 1);','            ToolExecutionRecord updated = replacement.withVersion(\n                    expected.getVersion());',0,'CAS: version increments'),
('M19',J,'            if (current == null || current.isSettled()\n                    || current.getState()\n                            == ToolExecutionRecord.State.UNKNOWN) {\n                return null;\n            }\n            Instant now = JdbcRepositorySupport.databaseNow(connection);\n            if (ownerId.equals','            if (current == null\n                    || current.getState()\n                            == ToolExecutionRecord.State.UNKNOWN) {\n                return null;\n            }\n            Instant now = JdbcRepositorySupport.databaseNow(connection);\n            if (ownerId.equals',0,'claim: settled refused'),
('M20',J,'            if (current == null || current.isSettled()\n                    || current.getState()\n                            == ToolExecutionRecord.State.UNKNOWN) {\n                return null;\n            }\n            Instant now = JdbcRepositorySupport.databaseNow(connection);\n            if (ownerId.equals','            if (current == null || current.isSettled()) {\n                return null;\n            }\n            Instant now = JdbcRepositorySupport.databaseNow(connection);\n            if (ownerId.equals',0,'claim: UNKNOWN refused'),
('M21',J,'            if (ownerId.equals(current.getDispatchOwner())\n                    && current.getDispatchLeaseUntil().isAfter(now)) {\n                return current;\n            }','',0,'claim: same-owner live re-claim is a no-op'),
('M22',J,'            if (current.getDispatchOwner() != null\n                    && current.getDispatchLeaseUntil().isAfter(now)) {\n                return null;\n            }','',0,'claim: foreign live lease refused'),
('M23',J,'            if (current.getState() == ToolExecutionRecord.State.EXECUTING\n                    || current.getState()\n                            == ToolExecutionRecord.State.CANCEL_REQUESTED) {\n                ToolExecutionRecord unknown','            if (false) {\n                ToolExecutionRecord unknown',0,'claim: expired EXECUTING/CANCEL_REQUESTED -> UNKNOWN'),
('M24',J,'            if (current.getState() == ToolExecutionRecord.State.EXECUTING\n                    || current.getState()\n                            == ToolExecutionRecord.State.CANCEL_REQUESTED) {\n                ToolExecutionRecord unknown','            if (current.getState() == ToolExecutionRecord.State.EXECUTING) {\n                ToolExecutionRecord unknown',0,'claim: expired CANCEL_REQUESTED -> UNKNOWN'),
('M25',J,'                    current.getDispatchGeneration() + 1,','                    current.getDispatchGeneration(),',0,'claim: generation increments'),
('M27',J,'            if (!ownerId.equals(current.getDispatchOwner())\n                    || dispatchGeneration','            if (false\n                    || dispatchGeneration',0,'renew: owner fence'),
('M28',J,'                    || dispatchGeneration != current.getDispatchGeneration()\n','',0,'renew: generation fence'),
('M29',J,'                    || !current.getDispatchLeaseUntil().isAfter(now)) {\n                return null;\n            }\n            ToolExecutionRecord renewed','                    ) {\n                return null;\n            }\n            ToolExecutionRecord renewed',0,'renew: expired lease refused'),
('M30',J,'            if (current == null || current.isSettled()\n                    || current.getState()\n                            == ToolExecutionRecord.State.UNKNOWN) {\n                return null;\n            }\n            Instant now = JdbcRepositorySupport.databaseNow(connection);\n            if (!ownerId','            if (current == null || current.isSettled()) {\n                return null;\n            }\n            Instant now = JdbcRepositorySupport.databaseNow(connection);\n            if (!ownerId',0,'renew: UNKNOWN refused'),
('M31',J,'            if (current == null || current.isSettled()\n                    || current.getState()\n                            == ToolExecutionRecord.State.UNKNOWN) {\n                return null;\n            }\n            Instant now = JdbcRepositorySupport.databaseNow(connection);\n            if (!ownerId','            if (current == null\n                    || current.getState()\n                            == ToolExecutionRecord.State.UNKNOWN) {\n                return null;\n            }\n            Instant now = JdbcRepositorySupport.databaseNow(connection);\n            if (!ownerId',0,'renew: settled refused'),
('M32',J,'            if (current == null || current.isSettled()\n                    || current.getVersion() != expectedVersion) {','            if (current == null || current.isSettled()) {',0,'cancel: version fence'),
('M33',J,'            if (current == null || current.isSettled()\n                    || current.getVersion() != expectedVersion) {','            if (current == null\n                    || current.getVersion() != expectedVersion) {',0,'cancel: settled refused'),
('M34',J,'            if (current.isCancelRequested()) {\n                return current;\n            }','',0,'cancel: repeated cancel is a no-op'),
('M35',J,'                    current.getState() == ToolExecutionRecord.State.EXECUTING\n                            ? ToolExecutionRecord.State.CANCEL_REQUESTED\n                            : current.getState(),','                    current.getState(),',0,'cancel: EXECUTING -> CANCEL_REQUESTED'),
('M36',J,'            if (current.getState() == ToolExecutionRecord.State.PREPARED) {\n                requested = requested.withResult(','            if (false) {\n                requested = requested.withResult(',0,'cancel: PREPARED settles immediately'),
('M37',J,'            if (current == null || !current.sameIdentity(expected)\n                    || current.getVersion() != expected.getVersion()\n                    || current.getState()\n                            != ToolExecutionRecord.State.UNKNOWN) {','            if (current == null\n                    || current.getVersion() != expected.getVersion()\n                    || current.getState()\n                            != ToolExecutionRecord.State.UNKNOWN) {',0,'resolveUnknown: sameIdentity'),
('M38',J,'            if (current == null || !current.sameIdentity(expected)\n                    || current.getVersion() != expected.getVersion()\n                    || current.getState()\n                            != ToolExecutionRecord.State.UNKNOWN) {','            if (current == null || !current.sameIdentity(expected)\n                    || current.getState()\n                            != ToolExecutionRecord.State.UNKNOWN) {',0,'resolveUnknown: version fence'),
('M39',J,'                    || current.getState()\n                            != ToolExecutionRecord.State.UNKNOWN) {','                    ) {',0,'resolveUnknown: only UNKNOWN'),
('M40',J,'                    + "AND execution_state <> \'SETTLED\'";','                    ;',0,'hasActive: settled rows excluded'),
('M41',J,'                        if (id.equals(result.getString(\n                                "runtime_session_id"))) {','                        if (true) {',0,'hasActive: full-id re-check'),
('M42',J,'        if (!JdbcRepositorySupport.valueKey(idempotencyKey).equals(\n                result.getString("idempotency_key_hash"))) {','        if (false) {',0,'map: idempotency hash integrity'),
('M43',J,'        if (!JdbcRepositorySupport.valueKey(runtimeSessionId).equals(\n                result.getString("runtime_session_key"))) {','        if (false) {',0,'map: session hash integrity'),
('M44',J,'JSON.toJSONString(value, JSONWriter.Feature.WriteNulls)','JSON.toJSONString(value)',0,'toJson: WriteNulls'),
('M45',J,'                || candidate.getState()\n                        != ToolExecutionRecord.State.PREPARED\n','',0,'requireCandidate: PREPARED only'),
('M46',J,'                || !expected.sameIdentity(replacement)\n','',0,'requireReplacement: identity'),
('M47',J,'                || !expected.sameDispatch(replacement)\n','',0,'requireReplacement: claim preserved'),
('M48',J,'                || replacement.getVersion() != expected.getVersion()\n','',0,'requireReplacement: version'),
('M49',J,'                || replacement.getLastSequence()\n                        < expected.getLastSequence()) {','                ) {',0,'requireReplacement: sequence monotonic'),
('M50',J,'+ (forUpdate ? " FOR UPDATE" : "");','+ "";',0,'row lock (FOR UPDATE)'),
('M51',J,'            if (statement.executeUpdate() != 1) {','            if (statement.executeUpdate() < 0) {',0,'update: exactly one row'),
('M52',B,'        if ((value instanceof Double doubleValue\n                && !Double.isFinite(doubleValue))\n                || (value instanceof Float floatValue\n                        && !Float.isFinite(floatValue))) {','        if (false) {',0,'BrokerValues: non-finite rejected'),
('M53',B,'        if (first == null || second == null\n                || first.size() != second.size()) {\n            return false;\n        }\n        for (Map.Entry','        if (first == null || second == null) {\n            return false;\n        }\n        for (Map.Entry',0,'sameJsonMap: size'),
('M54',B,'            if (!second.containsKey(entry.getKey())\n                    || !sameJsonValue','            if (false\n                    || !sameJsonValue',0,'sameJsonMap: containsKey (null vs missing)'),
('M55',B,'            return sameJsonNumber(left, right);','            return left.equals(right);',0,'sameJsonValue: numbers by value'),
('M56',B,'            return sameJsonMap(left, right);\n        }\n        if (first instanceof List','            return left.equals(right);\n        }\n        if (first instanceof List',0,'sameJsonValue: nested maps canonical'),
('M57',B,'                if (!sameJsonValue(left.get(index), right.get(index))) {','                if (!left.get(index).equals(right.get(index))) {',0,'sameJsonValue: list items canonical'),
('M58',B,'            if (left.size() != right.size()) {\n                return false;\n            }\n            for (int index','            for (int index',0,'sameJsonValue: list size'),
('M59',T,'                && BrokerValues.sameJsonMap(reference, other.reference);\n    }\n\n    boolean sameDispatch','                ;\n    }\n\n    boolean sameDispatch',0,'sameIdentity: reference'),
('M60',T,'                && BrokerValues.sameJsonMap(reference, other.reference);\n    }\n\n    private','                ;\n    }\n\n    private',0,'sameRequest: reference'),
]
def build(arm_src, out_root):
    os.makedirs(out_root, exist_ok=True)
    for mid, f, old, new, occ, desc in M:
        d = f'{out_root}/{mid}'
        if os.path.exists(d): shutil.rmtree(d)
        shutil.copytree(f'{arm_src}/runtime-broker', f'{d}/runtime-broker', ignore=shutil.ignore_patterns('target'))
        p = f'{d}/{f}'
        s = open(p).read()
        n = s.count(old)
        assert n > occ, (mid, 'pattern count', n)
        idx = -1
        for _ in range(occ + 1): idx = s.index(old, idx + 1)
        s = s[:idx] + new + s[idx + len(old):]
        open(p, 'w').write(s)
if __name__ == '__main__':
    build(sys.argv[1], sys.argv[2])
    json.dump([[m[0], m[5]] for m in M], open(sys.argv[2] + '/index.json', 'w'))
    print(len(M), 'mutants built in', sys.argv[2])
