# Narrowing arms, run one after another in the PR worktree. Each arm edits
# only what its comment says and restores it afterwards.
set -u
export SKIP_INSTALL=1
cd "$WT"
restore() { git checkout -- packages/sdk-java; rm -rf .mvn packages/sdk-java/qwencode/src/test/java/com/alibaba/qwen/code/ZzzOrphanIT.java "$SP/java/excludes.txt"; }

# N1: a repository-root .mvn/maven.config keeps one test of every class.
restore; mkdir -p .mvn
printf '%s\n' '-Dit.test=JdbcRuntimeBrokerMySqlIT,ManagedAgentMySqlIT#isolatesTenantsThatDifferOnlyByCase' > .mvn/maven.config
bash "$SP/java/arm.sh" N1-root-mvn-config-method "$SP/java/mariadb-pr.sh"; restore

# N2: activating the unused hosted-workspace-tools profile through MAVEN_ARGS.
EXTRA_MAVEN_ARGS='-Phosted-workspace-tools' bash "$SP/java/arm.sh" N2-hosted-extra-profile "$SP/java/hosted-pr.sh"; restore

# N6: -Dfailsafe.excludesFile dropping one method (9 of 10 still run).
printf '%s\n' 'ManagedAgentMySqlIT#isolatesTenantsThatDifferOnlyByCase' > "$SP/java/excludes.txt"
EXTRA_MAVEN_ARGS="-Dfailsafe.excludesFile=$SP/java/excludes.txt" bash "$SP/java/arm.sh" N6-excludes-file-method "$SP/java/mariadb-pr.sh"; restore

# N4 (deferred D5): `<test >` in the MariaDB profile of the POM.
node -e "
const fs=require('fs');const f='packages/sdk-java/managed-agent-server/pom.xml';let s=fs.readFileSync(f,'utf8');
const a='<exclude>**/Hosted*IT.java</exclude>\n                            </excludes>';
if(!s.includes(a))process.exit(1);
fs.writeFileSync(f,s.replace(a,a+'\n                            <test >ManagedAgentMySqlIT#isolatesTenantsThatDifferOnlyByCase</test >'));"
git diff --stat
( npx vitest run --config ./scripts/tests/vitest.config.ts scripts/tests/hosted-process-ci.test.js 2>&1 | grep -E 'Tests |✓|×|FAIL' ) > "$SP/java/logs/N4-guard.log"
cat "$SP/java/logs/N4-guard.log"
bash "$SP/java/arm.sh" N4-pom-test-with-space "$SP/java/mariadb-pr.sh"; restore

# N3 (deferred D1): database down plus -Dmaven.test.failure.ignore=true.
docker stop pr12864-mariadb >/dev/null
mkdir -p .mvn; printf '%s\n' '-Dmaven.test.failure.ignore=true' > .mvn/maven.config
bash "$SP/java/arm.sh" N3-db-down-failure-ignore "$SP/java/mariadb-pr.sh"; restore
docker start pr12864-mariadb >/dev/null
git status --short
