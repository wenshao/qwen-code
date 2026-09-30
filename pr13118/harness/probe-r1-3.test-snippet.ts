  it('PROBE R1-3: early vs late refusal and a prepared invocation', async () => {
    const out: string[] = [];
    // EARLY: a history read is already pending when release arrives (the PR's first test).
    await begin();
    const early = reference(
      await prepare('read_file', { file_path: path.join(workspace, 'input.txt') }),
    );
    let drain = hold(ManagedToolFileHistory.prototype, 'drain');
    let observed = control({ kind: 'history' });
    await drain.entered();
    const r1 = await post({ kind: 'release' });
    out.push(`EARLY release -> ${r1.status} ${JSON.stringify(await r1.json())}`);
    out.push(`EARLY prepared after refusal -> ${JSON.stringify(await control({ kind: 'status', reference: early }))}`);
    drain.release();
    await observed;
    out.push(`EARLY preflight+execute prepared -> ${JSON.stringify(await execute(early).then((v) => (v as { executionStatus: string }).executionStatus, (e) => String(e)))}`);
    // LATE: the history read arrives while release preparation is waiting (the PR's second test),
    // with a prepared invocation in the Session this time.
    const late = reference(
      await prepare('read_file', { file_path: path.join(workspace, 'input.txt') }, 'call-late'),
    );
    out.push(`LATE prepared before release -> ${JSON.stringify(await control({ kind: 'status', reference: late }))}`);
    const preparedRelease = hold(ManagedToolRuntime.prototype, 'releasePrepared');
    const releasing = post({ kind: 'release' });
    await preparedRelease.entered();
    drain = hold(ManagedToolFileHistory.prototype, 'drain');
    observed = control({ kind: 'history' });
    await drain.entered();
    preparedRelease.release();
    const r2 = await releasing;
    out.push(`LATE release -> ${r2.status} ${JSON.stringify(await r2.json())}`);
    out.push(`LATE prepared after refusal -> ${JSON.stringify(await control({ kind: 'status', reference: late }))}`);
    drain.release();
    await observed;
    const pf = await post({ kind: 'preflight', reference: late });
    out.push(`LATE preflight prepared -> ${pf.status} ${JSON.stringify(await pf.json()).slice(0, 200)}`);
    const ex = await post({ kind: 'execute', reference: late });
    out.push(`LATE execute prepared -> ${ex.status} ${JSON.stringify(await ex.json()).slice(0, 300)}`);
    out.push(`LATE manifest still answered -> ${JSON.stringify(Object.keys(await control({ kind: 'manifest' }) as object))}`);
    fs.writeFileSync(process.env.PROBE_OUT!, out.join('\n') + '\n');
  });

