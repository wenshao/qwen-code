mkdir: cannot create directory ‘/root’: Permission denied
Can not write to /root/.m2/copy_reference_file.log. Wrong volume permissions? Carrying on ...
whoami: 501:1000  machine-id=f03cd9a6530b4a84b59095456b085bfb  openjdk version "21.0.9" 2025-10-21 LTS  Apache Maven 3.9.11 (3e54c93a704957b63ee3494413a2b544fd3d825b)
sibling SDK install: exit=0
sibling Runtime Broker install: exit=0

$ mvn -q -DskipTests compile exec:java -Dexec.mainClass=...WorkspaceStorageRegistrationMain -Dexec.args='inspect t-w1a st-d /srv/w1a/d'
exit=0 after 102 s; output lines=1
unverified

$ mvn -q -DskipTests compile exec:java -Dexec.mainClass=...WorkspaceStorageRegistrationMain -Dexec.args='register t-w1a st-d /srv/w1a/d 49c5c714-de42-4c98-a1df-f5cb58dbb313 --offline-confirmed'
exit=0 after 17 s; output lines=1
Workspace storage maintenance operation verified.

$ mvn -q -DskipTests compile exec:java -Dexec.mainClass=...WorkspaceStorageRegistrationMain -Dexec.args='inspect t-w1a st-d /srv/w1a/d'
exit=0 after 17 s; output lines=1
state=ready revision=1 operation=null completed=49c5c714-de42-4c98-a1df-f5cb58dbb313 holder=false identity=match marker=match registration=valid

$ mvn -q -DskipTests compile exec:java -Dexec.mainClass=...WorkspaceStorageRegistrationMain -Dexec.args='register t-w1a st-d /srv/w1a/d 49c5c714-de42-4c98-a1df-f5cb58dbb313 --offline-confirmed'
exit=0 after 17 s; output lines=1
Workspace storage maintenance operation verified.

$ mvn -q -DskipTests compile exec:java -Dexec.mainClass=...WorkspaceStorageRegistrationMain -Dexec.args='register t-w1a st-d /srv/w1a/d 094c714d-24b5-499e-965c-30d4aae5a526 --offline-confirmed'
exit=1 after 16 s; output lines=7
[ERROR] Failed to execute goal org.codehaus.mojo:exec-maven-plugin:3.6.4:java (default-cli) on project qwen-managed-agent-server: An exception occurred while executing the Java class. Workspace execution authority is unavailable. 
[ERROR] 
[ERROR] To see the full stack trace of the errors, re-run Maven with the -e switch.
[ERROR] Re-run Maven using the -X switch to enable full debug logging.
[ERROR] 
[ERROR] For more information about the errors and possible solutions, please read the following articles:
[ERROR] [Help 1] http://cwiki.apache.org/confluence/display/MAVEN/MojoExecutionException

$ mvn -q -DskipTests compile exec:java -Dexec.mainClass=...WorkspaceStorageRegistrationMain -Dexec.args='fence t-w1a st-d /srv/w1a/d 1 49c5c714-de42-4c98-a1df-f5cb58dbb313 --offline-confirmed'
exit=0 after 17 s; output lines=1
Workspace storage maintenance operation verified.

$ mvn -q -DskipTests compile exec:java -Dexec.mainClass=...WorkspaceStorageRegistrationMain -Dexec.args='restore-original t-w1a st-d /srv/w1a/d 1 49c5c714-de42-4c98-a1df-f5cb58dbb313 --offline-confirmed'
exit=0 after 17 s; output lines=1
Workspace storage maintenance operation verified.

$ mvn -q -DskipTests compile exec:java -Dexec.mainClass=...WorkspaceStorageRegistrationMain -Dexec.args='inspect t-w1a st-d /srv/w1a/d'
exit=0 after 16 s; output lines=1
state=ready revision=2 operation=null completed=49c5c714-de42-4c98-a1df-f5cb58dbb313 holder=false identity=match marker=match registration=valid
   total 16
   drwxrwxr-x 3 501 ubuntu 4096 Sep 30 09:49 .
   drwxr-xr-x 6 501 ubuntu 4096 Sep 30 09:46 ..
   drwxrwxr-x 2 501 ubuntu 4096 Sep 30 09:46 project
   -rw-r--r-- 1 501 ubuntu  205 Sep 30 09:49 .qwen-managed-storage.json
S10-DONE
