  // VERIFICATION RIG ONLY (PR #13163 round 5): two overlapping resident passive loads. The first to finish clears
  // mcpRecovering in its finally while the second is still mid-adoption; is a teardown then still refused?
  it('PROBE2 a second passive load is refused while the first adopts', async () => {
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
      const lb = await load();
      const closedDuring = await headers(
        supertest(server).delete(`/session/${SESSION_ID}`),
      );
      finishA();
      const la = await a;
      process.stdout.write(
        `PROBE2-RESULT loadB=${lb.status}/${lb.body?.code ?? 'ok'} deleteWhileA=${closedDuring.status}/${closedDuring.body?.code ?? ''} loadA=${la.status}/${la.body?.code ?? 'ok'} releases=${release.mock.calls.length}\n`,
      );
      expect(lb.status).toBe(409);
      expect(closedDuring.status).toBe(409);
      expect(la.status).toBe(200);
      expect(release).not.toHaveBeenCalled();
    } finally {
      finishA();
      finishB();
      await a;
    }
  }, 30_000);

