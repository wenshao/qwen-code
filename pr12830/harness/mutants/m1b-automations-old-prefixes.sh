bash $SCRATCH/mut/m1-automations-get.sh $1
sed -i '' '/"\/v1\/agent-automations", "\/v1\/agent-channels",/d' $1/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/ManagedAgentApiContractTest.java
grep -n -A2 'API_PREFIXES = ' $1/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/ManagedAgentApiContractTest.java
