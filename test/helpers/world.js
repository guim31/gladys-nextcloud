// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Nextcloud behind the
// HTTP seam, a temporary /data and a manual clock, with the integration wired
// on top through registerHandlers. No timer runs unless `timers: true` (with
// node:test mock timers): the tests read the instance with `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import {
  ADMIN,
  APP_PASSWORD,
  FakeNextcloud,
  HOST,
  TOKEN,
  USER,
  USER_PASSWORD,
} from './fakeNextcloud.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

/** A manual clock, shared by the hub and the tests. */
export function createClock(start = Date.UTC(2026, 9, 14, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const CONFIG = Object.freeze({ url: HOST, token: TOKEN, language: 'en' });
export const ACCOUNT_CONFIG = Object.freeze({
  url: HOST,
  username: ADMIN,
  app_password: APP_PASSWORD,
  language: 'en',
});

/**
 * @param {object} [options]
 * @param {FakeNextcloud} [options.nextcloud]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 */
export async function createWorld({
  clock = createClock(),
  nextcloud = new FakeNextcloud(),
  config = CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-nextcloud-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config: { ...config }, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: nextcloud.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, nextcloud, app, hub: app.hub, clock, dataDir };
}

/** External ids of the device of the instance. */
export const deviceId = (gladys) => gladys.externalIds('instance', '1').device;
export const featureId = (gladys, feature) => gladys.externalIds('instance', '1').feature(feature);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export { ADMIN, APP_PASSWORD, FakeNextcloud, HOST, TOKEN, USER, USER_PASSWORD };
