  const brokerPort = await freePort();
  const dropProxy = await startDropProxy(harnessPort);
