// VERIFY-18177 probe: the PR's own background-notification fixture uses a
  // `kind: 'user'` block, but the transcript reducer produces background
  // notifications as `kind: 'assistant'` with meta.source set
  // (see getBackgroundAgentNotificationKey in hooks/useMessages.ts). This case
  // drives the real shape against the PR's auto-clear clause.
  it('VERIFY-18177 background-notification assistant block must not clear the resend indicator', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sendPrompt.mockImplementationOnce(async (_text, options) => {
      blocksState = [{ id: 'u-verify-bg', kind: 'user', text: 'hi' }];
      options?.onAdmissionStarted?.();
      throw new Error('response lost');
    });
    render();

    await act(async () => {
      latestOnSubmit!('hi');
      await Promise.resolve();
    });
    expect(testid('pane-failed-prompt-retry')).not.toBeNull();

    blocksState = [
      { id: 'u-verify-bg', kind: 'user', text: 'hi' },
      {
        id: 'bg-agent-1',
        kind: 'assistant',
        text: 'Background task completed',
        meta: {
          source: 'background_notification',
          backgroundTask: { kind: 'agent', status: 'completed' },
        },
      },
    ];
    rerender();
    const indicator = testid('pane-failed-prompt-retry');
    console.log(
      `[VERIFY-18177] indicator-after-background-assistant=${
        indicator ? 'shown' : 'CLEARED'
      }`,
    );
    expect(indicator).not.toBeNull();
    warn.mockRestore();
  });