import json, sys
d = json.load(sys.stdin)
p = None
for ctx in d["contexts"].values():
    for b in ctx["beans"].values():
        if b.get("prefix") == "qwen.managed-agent":
            p = b["properties"]
want = {
    "harness": ["approvalTimeout", "turnDeadline"],
    "sessionStore": ["writerLeaseDuration"],
    "dispatch": ["leaseDuration", "leaseRenewInterval", "scanDelay"],
    "events": ["materializeInterval", "batchInterval"],
    "auth": ["allowedDrift"],
    "toolPublication": ["deletionGrace"],
    "runtimeBroker": ["v3ResultWindow", "provisioner", "cliEntry"],
}
for group, keys in want.items():
    g = p.get(group, {})
    for k in keys:
        print(f"BOUND {group}.{k} = {g.get(k, '<absent>')}")
k8s = sorted(k for k in p.get("runtimeBroker", {}) if k.startswith("kubernetes"))
print("BOUND runtimeBroker.kubernetes* = " + (
    ", ".join(f"{k}={p['runtimeBroker'][k]}" for k in k8s) if k8s else "<absent>"))
tp = p.get("toolPublication", {})
for k in ("operationTimeout", "claimTimeout", "maxVerificationTimeout"):
    print(f"BOUND toolPublication.{k} = {tp.get(k, '<absent>')}")
