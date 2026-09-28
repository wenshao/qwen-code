#!/bin/bash
# Round 4 Java gate: the PR's publication suites on H2 (baseline), then the
# round-1 B2/B4 fixes reverted to re-measure whether any test now pins them.
A=/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039
export JAVA_HOME=/root/Install/jdk21
export PATH=/root/Install/jdk21/bin:$PATH
MVN=/root/Install/maven/bin/mvn
cd "$A/head/packages/sdk-java/managed-agent-server" || exit 9
echo "=== BASELINE: ToolPublication* + ApiExceptionHandler + WorkspaceRuntime (H2)"
$MVN -B test -Dtest='ToolPublicationContractTest,ToolPublicationStoreTest,ToolPublicationControllerTest,ApiExceptionHandlerTest,WorkspaceRuntimeTest' -DfailIfNoSpecifiedTests=false 2>&1 | tail -25
