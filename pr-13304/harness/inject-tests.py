import sys
path = sys.argv[1]
src = open(path).read()

T1 = r'''
  it('VERIFY-T1 clears availability on managed-runtime continue when tool-turn cleanup never settles', async () => {
    await parkToolTurn();
    vi.spyOn(HostedWorkspaceBroker.prototype, 'execute').mockResolvedValue({
      executionStatus: 'success',
      responseParts: [{ text: 'written' }],
    } as never);
    vi.spyOn(HostedWorkspaceBroker.prototype, 'release').mockResolvedValue();
    const { server, loaded } = await loadReplacement();
    expect(loaded.status).toBe(200);
    const recovery = loaded.body._meta?.[
      'qwen.daemon.managedRuntimeRecovery'
    ] as { checkpointId: string; activationId: string };
    const clientId = loaded.body.clientId as string;
    // Park every later tool-turn drain, the way a stalled Session Store would.
    const close = vi
      .spyOn(HostedWorkspaceToolTurn.prototype, 'close')
      .mockReturnValue(new Promise(() => {}));
    const continued = await replacementHeaders(
      supertest(server).post(`/session/${SESSION_ID}/managed-runtime/continue`),
    )
      .set('X-Qwen-Client-Id', clientId)
      .send({
        promptId: PROMPT_ID,
        checkpointId: recovery.checkpointId,
        activationId: recovery.activationId,
      });
    expect(continued.status).toBe(200);
    await vi.waitFor(
      async () => {
        const status = await replacementHeaders(
          supertest(server).get(`/session/${SESSION_ID}/status`),
        ).set('X-Qwen-Client-Id', clientId);
        expect(status.body.hasActivePrompt).toBe(false);
      },
      { timeout: 8_000 },
    );
    expect(close).toHaveBeenCalled();
    const deleted = await replacementHeaders(
      supertest(server).delete(`/session/${SESSION_ID}`),
    ).set('X-Qwen-Client-Id', clientId);
    expect(deleted.status).toBe(204);
  });
'''

T2 = r'''
  it('VERIFY-T2 still blocks admission when the backgrounded cleanup of a successful turn fails', async () => {
    vi.spyOn(HostedWorkspaceBroker.prototype, 'warm').mockResolvedValue();
    let failCleanup!: (cause: Error) => void;
    vi.spyOn(HostedWorkspaceToolTurn.prototype, 'close').mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        failCleanup = reject;
      }),
    );
    const server = await app(true);
    const created = await headers(supertest(server).post('/session')).send({
      sessionId: SESSION_ID,
      sessionScope: 'thread',
      managedSessionStore: store(),
      toolProfile: 'hosted-workspace-shell/1',
    });
    expect(created.status).toBe(200);
    const clientId = created.body.clientId as string;
    const prompt = [{ type: 'text', text: 'say hi' }];
    await headers(supertest(server).post(`/session/${SESSION_ID}/prompt`))
      .set('X-Qwen-Client-Id', clientId)
      .send({
        prompt,
        promptId: PROMPT_ID,
        payloadDigest: `sha256:${createHash('sha256').update(JSON.stringify(prompt)).digest('hex')}`,
      })
      .expect(202);
    const status = async () =>
      (
        await headers(
          supertest(server).get(`/session/${SESSION_ID}/status`),
        ).set('X-Qwen-Client-Id', clientId)
      ).body as { hasActivePrompt: boolean; recoveryBlocked: boolean };
    // Head: availability first. Base: the turn stays active until cleanup settles.
    const early = await vi
      .waitFor(
        async () => {
          expect((await status()).hasActivePrompt).toBe(false);
        },
        { timeout: 3_000 },
      )
      .then(
        () => 'available-before-cleanup',
        () => 'active-until-cleanup',
      );
    failCleanup(new Error('injected publisher cleanup failure'));
    await vi.waitFor(async () => {
      const current = await status();
      expect(current.hasActivePrompt).toBe(false);
      expect(current.recoveryBlocked).toBe(true);
    });
    const second = [{ type: 'text', text: 'again' }];
    const refused = await headers(
      supertest(server).post(`/session/${SESSION_ID}/prompt`),
    )
      .set('X-Qwen-Client-Id', clientId)
      .send({
        prompt: second,
        promptId: randomUUID(),
        payloadDigest: `sha256:${createHash('sha256').update(JSON.stringify(second)).digest('hex')}`,
      });
    expect(refused.status).toBe(409);
    expect(refused.body.error ?? refused.body.code).toBe(
      'hosted_turn_recovery_required',
    );
    process.stdout.write(`VERIFY-T2 ordering=${early}\n`);
    await headers(supertest(server).delete(`/session/${SESSION_ID}`)).set(
      'X-Qwen-Client-Id',
      clientId,
    );
  });
'''

anchor1 = "  it('reports a parked execution passively and cancels the turn', async () => {"
anchor2 = "  it('distinguishes strict create and load outcomes', async () => {"
assert src.count(anchor1) == 1 and src.count(anchor2) == 1
src = src.replace(anchor1, T1.lstrip('\n') + '\n' + anchor1)
src = src.replace(anchor2, T2.lstrip('\n') + '\n' + anchor2)
open(path, 'w').write(src)
print('injected')
