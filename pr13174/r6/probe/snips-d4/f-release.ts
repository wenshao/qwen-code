      60_000,
      replacementHarness,
    );
    dropProxy.release();
    console.log(JSON.stringify({ probe: 'd4-proxy-released', heldRequests: dropProxy.log.filter((e) => e.held).map((e) => `${e.method} ${e.path.replace(/session\/[^/]+/, 'session/:id')}`) }));
