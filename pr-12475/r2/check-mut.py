# Adjudicates the round-2 mutation matrix against expectations.
# Killed-expected: mutants pinned by tests (PR-listed M01/M02, validation M07/M13-M19,
# autofix-pinned M04, new-guard probes M20-M23). Survived-expected: the sites the
# autofix explicitly deferred (R1-10/R1-14/R1-15 remainder) plus near-equivalent M03.
# A flip in either direction is a FAIL. Controls must be green.
import json, os, sys

LOGS = '/root/git/qwen-code-x3/tmp/pr12475-verify-20260923-071935/logs'
EXPECT_KILLED = ['M01','M02','M04','M07','M13','M14','M15','M16','M17','M18','M19','M20','M21','M22','M23']
EXPECT_SURVIVED = {
 'M03': 'near-equivalent: defer-pairing guard (round-1 classification stands)',
 'M05': 'deferred R1-15: group-history record filter',
 'M06': 'deferred R1-15: group-history replay filter',
 'M08': 'deferred R1-15: explicit inherit construction',
 'M09': 'deferred R1-15: GitHub directed lane',
 'M10': 'deferred R1-10/R1-15: GitHub aggregate lane',
 'M11': 'deferred R1-15: DWS redelivery eligibility',
 'M12': 'deferred R1-14: DWS unknown-classification under DM pairing',
}

def outcome(logdir, mid):
    j = json.load(open(os.path.join(logdir, f'{mid}.json')))
    killed = j['numFailedTests'] > 0
    return killed, j['numPassedTests'], j['numFailedTests']

pass_n = fail_n = 0
def rep(ok, line):
    global pass_n, fail_n
    print(('PASS ' if ok else 'FAIL ') + line)
    pass_n += ok; fail_n += (not ok)

for mid in EXPECT_KILLED:
    logdir = LOGS + ('/mut-r2' if mid in ('M20','M21','M22','M23') else '/mut')
    killed, p, f = outcome(logdir, mid)
    rep(killed, f'{mid} killed ({f} test failures) — pinned')
for mid, why in EXPECT_SURVIVED.items():
    killed, p, f = outcome(LOGS + '/mut', mid)
    rep(not killed, f'{mid} survived as classified — {why}')
for ctrl, logdir in [
    ('control-packages_channels_base_.json','/mut'),
    ('control-packages_channels_dws_.json','/mut'),
    ('control-packages_channels_github_.json','/mut'),
    ('control-packages_cli_src_commands_channel_.json','/mut'),
    ('control-packages_cli_src_serve_channel_settings_store_test_ts_src_serve_channel_management_service_test_ts.json','/mut'),
    ('control-packages_channels_base_src_ChannelBase_test_ts.json','/mut-r2'),
    ('control-packages_channels_github_src_GithubAdapter_test_ts.json','/mut-r2'),
    ('control-packages_channels_gitlab_src_GitlabAdapter_test_ts.json','/mut-r2'),
]:
    j = json.load(open(LOGS + logdir + '/' + ctrl)) if False else None
for ctrl_path in [os.path.join(LOGS,'mut',c) for c in os.listdir(LOGS+'/mut') if c.startswith('control-')] + \
                  [os.path.join(LOGS,'mut-r2',c) for c in os.listdir(LOGS+'/mut-r2') if c.startswith('control-')]:
    j = json.load(open(ctrl_path))
    rep(j['numFailedTests'] == 0, f"control green: {os.path.basename(ctrl_path)} ({j['numPassedTests']} passed)")

print(f'\nTOTAL pass={pass_n} fail={fail_n}')
json.dump({'pass': pass_n, 'fail': fail_n}, open(LOGS + '/mut-assertions.json','w'))
sys.exit(1 if fail_n else 0)
