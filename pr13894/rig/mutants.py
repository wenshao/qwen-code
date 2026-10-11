#!/usr/bin/env python3
"""Apply one named mutant to the #13894 mutation worktree (or revert all)."""
import subprocess
import sys

ROOT = "/Users/wenshao/git/qwen-code-pr13894-mut/packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/"
ADM = ROOT + "ToolPublicationAdmissionStore.java"
DATA = ROOT + "ToolPublicationDataStore.java"
STORE = ROOT + "ToolPublicationStore.java"

MUTANTS = {
    # Ambient receipt preflight no longer takes placement first.
    "M1-receipt-no-staged-placement": [(ADM,
        "        data.lockStagedPlacement(key, publicationId);\n", "")],
    # Ambient admission preflight no longer takes placement first.
    "M2-prepare-no-staged-placement": [(DATA,
        "        grants.lockStagedPlacement(key, publicationId);\n        JsonNode original = finished(",
        "        JsonNode original = finished(")],
    # R1-4 shape: choose placement before qualifying the target.
    "M3-placement-before-validation": [(STORE,
        "        RuntimeBindingRecord runtime = publicationRuntime(binding);\n"
        "        WorkspaceLifecycleStore.lockPlacement(jdbc, text(key, \"tenantId\"));\n",
        "        RuntimeBindingRecord runtime = publicationRuntime(binding);\n"),
        (STORE,
        "    private PublicationTarget lockPublicationPlacement(JsonNode key, String publicationId, JsonNode candidate) {\n",
        "    private PublicationTarget lockPublicationPlacement(JsonNode key, String publicationId, JsonNode candidate) {\n"
        "        WorkspaceLifecycleStore.lockPlacement(jdbc, text(key, \"tenantId\"));\n")],
    # Publication mutation retains the tenant before placement (the pre-PR order plus placement).
    "M4-apply-retention-first": [(STORE,
        "        PublicationTarget target = lockPublicationPlacement(key, id, candidate);\n",
        "        lockTenant(tenant);\n        PublicationTarget target = lockPublicationPlacement(key, id, candidate);\n")],
    # Standalone receipt transaction retains the tenant before placement.
    "M5-receipt-tx-retention-first": [(ADM,
        "            data.lockOriginalSettledResult(key, publicationId, finished);\n            lockTenant(key);\n",
        "            lockTenant(key);\n            data.lockOriginalSettledResult(key, publicationId, finished);\n")],
    # Standalone admission transaction retains the tenant before placement.
    "M6-prepare-tx-retention-first": [(DATA,
        "            lockOriginalSettledResult(key, publicationId, original);\n            lockTenant(key);\n",
        "            lockTenant(key);\n            lockOriginalSettledResult(key, publicationId, original);\n")],
}


def revert():
    subprocess.run(["git", "-C", ROOT, "checkout", "--", ADM, DATA, STORE], check=True)


def apply(name):
    revert()
    for path, old, new in MUTANTS[name]:
        text = open(path).read()
        count = text.count(old)
        if count < 1:
            sys.exit(f"{name}: anchor not found in {path}")
        open(path, "w").write(text.replace(old, new, 1))
    diff = subprocess.run(["git", "-C", ROOT, "diff", "--stat"], capture_output=True, text=True).stdout
    print(f"{name} applied:\n{diff}")


if __name__ == "__main__":
    if sys.argv[1] == "revert":
        revert()
    elif sys.argv[1] == "list":
        print(" ".join(MUTANTS))
    else:
        apply(sys.argv[1])
