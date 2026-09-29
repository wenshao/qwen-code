// PR #12868 round 7, head 50fb28301e: mutants of the lines commit 50fb28301e
// adds ("keep main's input rules on the provider path").
const BROKER = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker';
const PROTOCOL = `${BROKER}/ProviderRuntimeProtocol.java`;
const TRANSPORT = `${BROKER}/HttpRuntimeTransport.java`;
const WORKER = 'packages/cli/src/serve/managed-runtime-provider-worker.ts';
const CHECK = `        if (!BrokerValues.isWellFormedJson(operation)) {
            throw invalid();
        }
`;
const SEQUENCE = `        Long sequence = BrokerValues.exactLong(value);
        return sequence != null && sequence >= 0 && sequence <= 9007199254740991L;`;
const DIRECTORY = `              !value.config
                .getWorkspaceContext()
                .isPathWithinWorkspace(directory)`;

export const superseded7c = new Set();
export const reanchored7c = {
  // the commit moved the background check one level in
  T9: { find: "            if (normalized['is_background'] === true)", replace: '            if (false)' },
};
export const round7c = [
  { id: 'P1', suite: 'broker', file: PROTOCOL, what: 'a provider operation is not checked for well-formed text',
    find: CHECK, replace: '' },
  { id: 'P2', suite: 'broker', file: PROTOCOL, what: 'only prepare is checked for well-formed text',
    find: '        if (!BrokerValues.isWellFormedJson(operation)) {\n', replace: '        if ("prepare".equals(operation.get("kind")) && !BrokerValues.isWellFormedJson(operation)) {\n' },
  { id: 'P3', suite: 'broker', file: PROTOCOL, what: 'only the tool input is checked for well-formed text',
    find: '        if (!BrokerValues.isWellFormedJson(operation)) {\n', replace: '        if (!BrokerValues.isWellFormedJson(operation.get("input"))) {\n' },
  { id: 'P4', suite: 'broker', file: TRANSPORT, what: 'a negative status cursor is accepted',
    find: SEQUENCE, replace: `        Long sequence = BrokerValues.exactLong(value);
        return sequence != null && sequence <= 9007199254740991L;` },
  { id: 'P5', suite: 'broker', file: TRANSPORT, what: 'a status cursor beyond 2^53 - 1 is accepted',
    find: SEQUENCE, replace: `        Long sequence = BrokerValues.exactLong(value);
        return sequence != null && sequence >= 0;` },
  { id: 'P6', suite: 'broker', file: TRANSPORT, what: 'a status cursor is read from the number the parser made of it, as before',
    find: SEQUENCE, replace: `        if (!(value instanceof Number number)) {
            return false;
        }
        java.math.BigDecimal sequence = new java.math.BigDecimal(number.toString());
        return sequence.signum() >= 0 && sequence.stripTrailingZeros().scale() <= 0
                && sequence.compareTo(java.math.BigDecimal.valueOf(9007199254740991L)) <= 0;` },
  { id: 'P7', suite: 'ts', file: WORKER, what: 'a Shell call may name a directory outside the workspace',
    find: DIRECTORY, replace: '              false' },
  { id: 'P8', suite: 'ts', file: WORKER, what: 'a Shell call with an empty directory is refused',
    find: "              directory !== '' &&\n", replace: '' },
  { id: 'P9', suite: 'ts', file: WORKER, what: 'a Shell call inside the workspace is refused as well',
    find: DIRECTORY, replace: `              value.config
                .getWorkspaceContext()
                .isPathWithinWorkspace(directory)` },
];
