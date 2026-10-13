(cd packages/cli && npx vitest run \
  src/serve/local-process-runtime-activator.test.ts \
  src/serve/managed-runtime-provider.test.ts \
  src/serve/broker-managed-runtime-provider.test.ts)
(cd packages/core && npx vitest run \
  src/tools/managed-tool-runtime.test.ts \
  src/tools/managed-tool-file-history-protocol.test.ts)
(cd packages/acp-bridge && npx vitest run src/bridgeTypes.test.ts)
(cd packages/sdk-java/runtime-broker && mvn test)  # JDK 21
