import os, re, shutil, sys
H = '/root/verify/pr13311/head-mut/packages/core/src/managed-runtime'
M = H + '/__mut__'
rec = open(H + '/managed-session-records.ts').read()
rtest = open(H + '/managed-session-records.test.ts').read()
inbox = open(H + '/managed-session-inbox.ts').read()
itest = open(H + '/managed-session-inbox.test.ts').read()
REC = [
 ('m00', 'control (unmutated)', None, None),
 ('m01', 'F2: primitive child charged one level (?? 0 -> ?? 1)', "height = Math.max(height, (shape?.height ?? 0) + 1);", "height = Math.max(height, (shape?.height ?? 1) + 1);"),
 ('m02', 'F2: memo depth check > -> >=', "if (depth + seen.height - 1 > MANAGED_SESSION_LIMITS.maxJsonDepth) {", "if (depth + seen.height - 1 >= MANAGED_SESSION_LIMITS.maxJsonDepth) {"),
 ('m03', 'F1: drop the expansion bound', "if (shared && bytes > MANAGED_SESSION_LIMITS.maxTransactionBytes) {", "if (false) {"),
 ('m04', 'R2-2: drop the `shared &&` exemption', "if (shared && bytes > MANAGED_SESSION_LIMITS.maxTransactionBytes) {", "if (bytes > MANAGED_SESSION_LIMITS.maxTransactionBytes) {"),
 ('m05', 'R2-1: drop `|| shape?.shared === true`', "shared = shared || reached || shape?.shared === true;", "shared = shared || reached;"),
 ('m06', 'R2-1: string leaf charged 1', "(typeof child === 'string' ? child.length + 2 : 1)", "(typeof child === 'string' ? 1 : 1)"),
 ('m07', 'R2-1: key bytes charged 0', "visit(descriptor.value, keyLabel, key.length + 3);", "visit(descriptor.value, keyLabel, 0);"),
 ('m08', 'R1-4: array branch forgets its shape', "        visit(descriptors[String(index)].value, `${label}[${index}]`, 0);\n      }\n      shapes.set(value, { height, bytes, shared });", "        visit(descriptors[String(index)].value, `${label}[${index}]`, 0);\n      }"),
 ('m09', 'R1-11: drop the turn-subject refusal', "if (subject['type'] === 'turn') {", "if (false) {"),
 ('m10', 'R1-11 overshoot: refuse hook_operation too', "if (subject['type'] === 'turn') {", "if (subject['type'] !== 'activation') {"),
 ('m11', 'R1-9: drop the sourceEventId self-reference guard', "payload['sourceEventId'] === record['eventId']", "false"),
 ('m12', 'R1-5: hook_operation branch -> return true', "      return (\n        left.operationId === other.operationId &&\n        left.occurrenceId === other.occurrenceId\n      );", "      return true;"),
 ('m13', 'R1-5: activation drops scopeId', "        left.scopeId === other.scopeId &&\n", ""),
 ('m14', 'R1-5: activation drops activationId', "        left.activationId === other.activationId &&\n", ""),
 ('m15', 'R1-5: activation drops epoch', "        left.activationId === other.activationId &&\n        left.epoch === other.epoch", "        left.activationId === other.activationId"),
 ('m16', 'R1-3/R1-7: envelope cross-check never runs', "    payloadSubject !== undefined &&\n    !subjectsEqual(subject, payloadSubject)", "    false"),
 ('m17', 'R1-3: schema loop keeps the first subject only (no capture)', "if (parsed !== undefined) payloadSubject = parsed;", "void parsed;"),
]
os.makedirs(M, exist_ok=True)
for mid, desc, a, b in REC:
    src = rec
    if a is not None:
        n = src.count(a)
        if n != 1: sys.exit(f'{mid}: anchor count {n}')
        src = src.replace(a, b)
    src = src.replace("from '../", "from '../../../")
    d = f'{M}/{mid}'; os.makedirs(d)
    open(d + '/managed-session-records.ts', 'w').write(src)
    open(d + '/managed-session-records.test.ts', 'w').write(rtest)
    open(d + '/MUTANT.txt', 'w').write(desc + '\n')
# inbox mutants
INB = [
 ('i00', 'inbox control (unmutated)', None, None),
 ('i01', 'R1-4: inbox private depth copy at 65', "if (depth > MANAGED_SESSION_LIMITS.maxJsonDepth) {", "if (depth > 65) {"),
 ('i02', 'R1-4: inbox private depth copy at 63', "if (depth > MANAGED_SESSION_LIMITS.maxJsonDepth) {", "if (depth > 63) {"),
]
for mid, desc, a, b in INB:
    src = inbox
    if a is not None:
        n = src.count(a)
        if n != 1: sys.exit(f'{mid}: anchor count {n}')
        src = src.replace(a, b)
    src = src.replace("from './managed-activation-store.js'", "from '../../managed-activation-store.js'").replace("from './managed-session-records.js'", "from '../../managed-session-records.js'")
    t = itest.replace("from './managed-activation-store.js'", "from '../../managed-activation-store.js'").replace("from './managed-session-records.js'", "from '../../managed-session-records.js'")
    d = f'{M}/{mid}'; os.makedirs(d)
    open(d + '/managed-session-inbox.ts', 'w').write(src)
    open(d + '/managed-session-inbox.test.ts', 'w').write(t)
    open(d + '/MUTANT.txt', 'w').write(desc + '\n')
print('ok', len(REC) + len(INB))
