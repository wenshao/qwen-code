#!/bin/bash
# Round 4 on the real host 192.168.0.75 (kernel 6.6, cgroup v2).
R=/root/pr13265-rig/r4; ROOT=/sys/fs/cgroup/qwen-h3-pr13265; O=$R/out; mkdir -p $O
mkdir -p $ROOT
clean() { for d in $ROOT/qwen-*; do [ -d "$d" ] && { echo 1 > $d/cgroup.kill 2>/dev/null; sleep 0.2; rmdir $d 2>/dev/null; }; done; true; }
run() { local arm=$1 probe=$2 tag=$3; shift 3; clean; (cd /tmp && env DIST=$R/$arm CGROUP_ROOT=$ROOT "$@" timeout 600 node $R/probe/$probe > $O/$tag.log 2>&1; echo "exit=$?" >> $O/$tag.log); echo "== $tag: $(grep -c . $O/$tag.log) lines, $(tail -1 $O/$tag.log)"; }
# head: named units and supervisor start
clean; (cd /tmp && timeout 120 node --input-type=module -e "
const { HookCommandCgroup } = await import('$R/head/core/hooks/hook-command-cgroup.js');
const { ManagedChildRunSupervisor } = await import('$R/head/core/managed-runtime/managed-child-run-supervisor.js');
const r = {};
try { const u = HookCommandCgroup.create('$ROOT'); r.unnamedCreate = 'ok'; u.remove(); } catch (e) { r.unnamedCreate = e.name; }
for (const n of ['qwen-bg-call-1', 'x']) { try { const u = HookCommandCgroup.create('$ROOT', n); r['named:'+n] = 'created'; u.remove(); } catch (e) { r['named:'+n] = e.name; } }
const sup = ManagedChildRunSupervisor.create({ cgroupRoot: '$ROOT' });
try { await sup.start({ unitName: 'qwen-bg-call-1', executable: '/bin/sh', args: ['-c','touch /tmp/l12-75-marker'], env: { PATH: process.env.PATH }, cwd: '/tmp', onOutput: () => {} }); r.supervisorStart = 'started'; } catch (e) { r.supervisorStart = e.name; }
await new Promise((x) => setTimeout(x, 300));
r.markerWritten = (await import('node:fs')).existsSync('/tmp/l12-75-marker');
console.log('[RESULT] ' + JSON.stringify(r));" > $O/l12-head.log 2>&1; rm -f /tmp/l12-75-marker); echo "== l12-head: $(tail -1 $O/l12-head.log)"
run nulonly l13-fast-start.mjs l13-nulonly N=30
run nulonly l14-terminate-race.mjs l14-nulonly N=20
run nulonly l16-shell-route.mjs l16-nulonly
run cand l1-supervisor.mjs l1-cand
run cand l13-fast-start.mjs l13-cand N=30
run cand l14-terminate-race.mjs l14-cand N=20
run cand l16-shell-route.mjs l16-cand
run cand l9-backpressure-r3.mjs l9-cand-wired ARM=as-wired MIB=256 STORE_MIB_PER_S=20
run cand l9-backpressure-r3.mjs l9-cand-paused ARM=paused MIB=256 STORE_MIB_PER_S=20
run cand l10-visibility-r3.mjs l10-cand
clean; ls $ROOT | grep -c qwen-
