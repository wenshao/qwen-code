  // VERIFICATION RIG ONLY (PR #13163 round 5): two overlapping resident passive loads. The first to finish clears
  // mcpRecovering in its finally while the second is still mid-adoption; is a teardown then still refused?
  it('PROBE overlapping passive loads keep the teardown fence', async () => {
    const { server } = await parkToolTurn(true);
    const release = vi.mocked(HostedWorkspaceBroker.prototype.release);
    release.mockClear();
    const status = vi
      .spyOn(HostedWorkspaceBroker.prototype, 'status')
      .mockResolvedValue({ state: 'prepared' });
    let finishA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      finishA = resolve;
    });
    let finishB!: () => void;
    const gateB = new Promise<void>((resolve) => {
      finishB = resolve;
    });
    status.mockImplementationOnce(async () => {
      await gateA;
      return { state: 'prepared' };
    });
    status.mockImplementationOnce(async () => {
      await gateB;
      return { state: 'prepared' };
    });
    const load = () =>
      headers(supertest(server).post(`/session/${SESSION_ID}/load`))
        .send({
          managedSessionStore: store(),
          toolProfile: FILE_PROFILE,
          passiveManagedRuntimeRecovery: true,
        })
        .then((response) => response);
    let a: Promise<supertest.Response> | undefined;
    let b: Promise<supertest.Response> | undefined;
    try {
      a = load();
      await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(1), {
        timeout: 10_000,
      });
      b = load();
      await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(2), {
        timeout: 10_000,
      });
      const fencedWhileBoth = await headers(
        supertest(server).delete(`/session/${SESSION_ID}`),
      );
      finishA();
      const la = await a;
      const closed = await headers(
        supertest(server).delete(`/session/${SESSION_ID}`),
      );
      const releasesAtClose = release.mock.calls.length;
      finishB();
      const lb = await b;
      process.stdout.write(
        `PROBE-RESULT deleteWhileBoth=${fencedWhileBoth.status}/${fencedWhileBoth.body?.code} loadA=${la.status}/${la.body?.code ?? 'ok'} deleteAfterA=${closed.status}/${closed.body?.code ?? ''} releasesAtThatDelete=${releasesAtClose} loadB=${lb.status}/${lb.body?.code ?? 'ok'} releasesTotal=${release.mock.calls.length}\n`,
      );
      expect(fencedWhileBoth.status).toBe(409);
      expect(closed.status).toBe(409);
    } finally {
      finishA();
      finishB();
      await a;
      await b;
    }
  }, 30_000);

