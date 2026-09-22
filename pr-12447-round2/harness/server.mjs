// Real TCP server built exactly like the PR's test: createServer(gate(expressApp)).
import fs from 'node:fs';
import { createServer } from 'node:http';
import express from 'express';
import {
  ownedManagedRuntimeRouteGate,
  registerManagedRuntimeAttestationRoute,
} from './contract.mjs';

const fixtures = JSON.parse(fs.readFileSync(process.env.FIXTURES, 'utf8'));
const identity = { ...fixtures.identity, ...JSON.parse(process.env.IDENTITY_JSON || '{}') };
const app = express();
registerManagedRuntimeAttestationRoute(app, identity);
const server = createServer(ownedManagedRuntimeRouteGate(app));
server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => {
  console.log(JSON.stringify({ port: server.address().port, pid: process.pid, nodeEnv: process.env.NODE_ENV ?? null }));
});
