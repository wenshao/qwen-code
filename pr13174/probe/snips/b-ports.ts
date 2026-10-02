  const brokerPort = await freePort();
  storeProxyTarget = springPort;
  const storeProxy = probeStoreProxy ? await startStoreProxy() : undefined;
  console.log(JSON.stringify({ probe: 'config', probeStoreProxy, probeWakeMs, controlNoWake: process.env['PROBE_CONTROL_NO_WAKE'] === '1', storeProxyPort: storeProxy?.port, springPort }));
