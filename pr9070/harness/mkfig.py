import json, html, os
S = "/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/f2c3a786-e710-4e2e-82cb-ad3e54c89919/scratchpad"
FIG = os.path.join(S, "fig")
os.makedirs(FIG, exist_ok=True)

CSS = """
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial}
.card{width:1280px;margin:0;padding:26px 30px 24px}
h1{font-size:20px;margin:0 0 4px;letter-spacing:.2px}
.sub{color:#8b949e;font-size:13px;margin:0 0 18px}
.sec{margin:0 0 16px}
.sec h2{font-size:13px;text-transform:uppercase;letter-spacing:.8px;color:#8b949e;margin:0 0 8px;font-weight:600}
pre{white-space:pre;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px 14px;margin:0;overflow:hidden}
table{border-collapse:collapse;width:100%;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
th,td{border:1px solid #30363d;padding:7px 10px;text-align:left;vertical-align:top}
th{background:#161b22;color:#8b949e;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.6px}
td.arm{white-space:pre-wrap;word-break:break-word}
.ok{color:#3fb950}.bad{color:#f85149}.warn{color:#d29922}.dim{color:#8b949e}
.note{border-left:3px solid #58a6ff;padding:8px 0 8px 14px;margin-top:16px;color:#c9d1d9;font-size:13px}
.note b{color:#e6edf3}
.tag{display:inline-block;padding:1px 7px;border-radius:20px;font-size:11px;font-weight:600;letter-spacing:.3px}
.tag.head{background:#132e1a;color:#3fb950;border:1px solid #238636}
.tag.main{background:#2d1a1a;color:#f85149;border:1px solid #8b2c2c}
.tag.same{background:#1c2333;color:#8b949e;border:1px solid #30363d}
"""

def page(title, sub, body, note=None):
    n = f'<div class="note">{note}</div>' if note else ""
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head>
<body><div class="card"><h1>{title}</h1><p class="sub">{sub}</p>{body}{n}</div></body></html>"""

def esc(s): return html.escape(s)

# ---------- Figure 1: A/B wire evidence ----------
rows = json.load(open(os.path.join(S, "out", "ab-summary.json")))
extra = []
for label, dirs in [("S5 SDK host DENIES with a message (control)", ("AUQdeny-A", "AUQdeny-B"))]:
    out = {}
    for arm, d in zip(("A", "B"), dirs):
        tr = json.load(open(os.path.join(S, "out", d, "tool-results.json")))
        probe = [t for t in tr if "call_probe" in str(t["tool_call_id"])]
        out[arm] = probe[0]["content"] if probe else "<none>"
    extra.append({"scenario": label, "head": out["A"], "main": out["B"], "same": out["A"] == out["B"]})
rows = rows + extra

trs = []
for r in rows:
    tag = '<span class="tag same">identical</span>' if r["same"] else '<span class="tag head">differs</span>'
    trs.append(
        f"<tr><td>{esc(r['scenario'])}<br>{tag}</td>"
        f"<td class='arm bad'>{esc(r['main'])}</td>"
        f"<td class='arm ok'>{esc(r['head'])}</td></tr>"
    )
body1 = (
    '<div class="sec"><h2>What the blocked agent actually receives (captured from the provider wire, role:"tool")</h2>'
    "<table><tr><th style='width:24%'>Scenario</th>"
    "<th style='width:34%'>main 7567824d4c</th>"
    "<th style='width:42%'>PR #9070 merge tree e3414c7d81</th></tr>"
    + "".join(trs) + "</table></div>"
)
note1 = ("<b>S1–S3 are the PR's payload.</b> Every host-side approval failure used to reach the model as "
         "<code>User did not allow tool call</code> — a sentence that reads like a human decision. "
         "S4/S5 are controls: the allow-with-answers and host-deny channels were already faithful on main and are byte-identical across arms.")
open(os.path.join(FIG, "01.html"), "w").write(
    page("PR #9070 — teammate approval cancellations, real-stack A/B",
         "qwen 0.23.0 bundles built from both trees · fake OpenAI provider · real TeamManager teammate · macOS 26.6.2 / Node 24.18.1",
         body1, note1))

# ---------- Figure 2: inert hook ----------
snippet = """packages/cli/src/nonInteractive/control/controllers/permissionController.ts:588
        if (
          requiresUserInteraction &&
          toolCall.request.name === ToolNames.EXIT_PLAN_MODE &&   // <- already excludes ask_user_question
          toolCall.invocation?.canAutoApproveOnAllow?.() !== false // <- added by this PR
        ) {

grep -rn "canAutoApproveOnAllow" packages/            (merge tree, production files only)
  packages/core/src/tools/askUserQuestion.ts:160   override canAutoApproveOnAllow(): boolean { return false; }
  packages/core/src/tools/tools.ts:70              canAutoApproveOnAllow?(): boolean;
  packages/core/src/tools/tools.ts:125             canAutoApproveOnAllow(): boolean { return true; }
  .../permissionController.ts:592                  the single read site shown above

ExitPlanModeToolInvocation  ->  no override, inherits the base default `true`
AskUserQuestionToolInvocation -> returns false, but its name never reaches the read site"""

tbl2 = """<table>
<tr><th style='width:46%'>Probe</th><th style='width:27%'>Result</th><th style='width:27%'>Reading</th></tr>
<tr><td>M6 — delete the added conjunct from the merge tree, run all four suites the PR touches</td><td class='bad'>SURVIVES (159 tests green)</td><td>no test constrains it</td></tr>
<tr><td>PR's new test <code>forwards host input for any interaction that opts out of bare auto-approval</code>, run against <b>main's</b> production file</td><td class='bad'>PASSES</td><td>tautological — the tool name alone already routes it</td></tr>
<tr><td>S4 live: SDK host allows <code>ask_user_question</code> with <code>updatedInput.answers</code></td><td class='same'>identical on both arms</td><td>no runtime difference</td></tr>
<tr><td>M8 — flip the new base default <code>true</code> → <code>false</code></td><td class='bad'>SURVIVES</td><td>a real <code>exit_plan_mode</code> behaviour change, unpinned</td></tr>
</table>"""
body2 = ('<div class="sec"><h2>The only production read site</h2><pre>' + esc(snippet) + "</pre></div>"
         '<div class="sec"><h2>Four independent probes</h2>' + tbl2 + "</div>")
note2 = ("<b>F2 (confirms the bot's standing R3-1).</b> The <code>canAutoApproveOnAllow()</code> hook cannot be false at its only "
         "read site, so it changes no behaviour today. It is not harmful, but it ships an interface plus a base default that "
         "nothing exercises — and the base default is itself load-bearing for <code>exit_plan_mode</code> if it is ever wrong.")
open(os.path.join(FIG, "02.html"), "w").write(
    page("PR #9070 — the new canAutoApproveOnAllow() hook is inert",
         "static reachability + counterfactual mutation + cross-arm test + live run, all on the merge tree",
         body2, note2))

# ---------- Figure 3: mutation matrix ----------
MUT = {
 'M1-teammate-abort': ('handleTeammateApproval, aborted guard — drop cancelMessage', 'permissionController.ts:331'),
 'M2-teammate-nonstreamjson': ('handleTeammateApproval, non-stream-json guard — drop cancelMessage', 'permissionController.ts:341'),
 'M3-teammate-nonsuccess': ('handleTeammateApproval, non-success response — drop cancelMessage', 'permissionController.ts:365'),
 'M4-teammate-catch': ('handleTeammateApproval, catch — drop cancelMessage', 'permissionController.ts:416'),
 'M5-headless-reason': ('headless teammate listener — drop cancelMessage', 'nonInteractiveCli.ts:1026'),
 'M6-drop-conjunct': ('remove the added canAutoApproveOnAllow conjunct', 'permissionController.ts:592'),
 'M7-auq-true': ('AskUserQuestionToolInvocation.canAutoApproveOnAllow -> true', 'askUserQuestion.ts:160'),
 'M8-base-false': ('BaseToolInvocation.canAutoApproveOnAllow -> false', 'tools.ts:125'),
 'M9-message-text': ('rewrite getInteractionUnavailableMessage() text', 'permissionController.ts:679'),
}
lines = [l.split() for l in open(os.path.join(S, "out", "mut", "summary.txt")).read().strip().split("\n")]
trs = []
for parts in lines:
    name = parts[0]
    verdicts = {p.split(":")[0]: p.split(":")[1] for p in parts[1:]}
    killed = any(v == "FAIL" for v in verdicts.values())
    by = ", ".join(k for k, v in verdicts.items() if v == "FAIL") or "—"
    desc, site = MUT[name]
    cls = "ok" if killed else "bad"
    verdict = "KILLED" if killed else "SURVIVED"
    trs.append(f"<tr><td>{esc(name)}</td><td>{esc(desc)}<br><span class='dim'>{esc(site)}</span></td>"
               f"<td class='{cls}'>{verdict}</td><td class='dim'>{esc(by)}</td></tr>")
body3 = ('<div class="sec"><h2>9 mutants × 4 suites the PR touches (askUserQuestion, coreToolScheduler[plan-mode block], permissionController, nonInteractiveCli — 212 tests)</h2>'
         "<table><tr><th style='width:20%'>Mutant</th><th style='width:46%'>What it breaks</th><th style='width:14%'>Verdict</th><th style='width:20%'>Killed by</th></tr>"
         + "".join(trs) + "</table></div>")
note3 = ("<b>6 killed / 3 survived.</b> The three cancellation paths that production can actually reach (M1, M4, M5) are pinned, "
         "and the message text itself is pinned (M9). The survivors are the inert hook (M6), its unpinned base default (M8), "
         "and the non-stream-json teammate guard (M2) — which the PR's own comment marks as unreachable under the current wiring.")
open(os.path.join(FIG, "03.html"), "w").write(
    page("PR #9070 — mutation matrix on the merge tree",
         "each mutant applied to the merge tree, the four affected suites re-run, then reverted",
         body3, note3))
print("wrote", os.listdir(FIG))
