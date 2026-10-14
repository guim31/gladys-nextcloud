// -----------------------------------------------------------------------------
// The logs the Gladys supervisor keeps: at the info level, only the life
// cycle. A normal reading cycle (reads, states, scene events) writes nothing;
// a failure that repeats at every read writes one line, then one when it
// heals. And no secret of the configuration ever appears, at any level.
// The SDK logger writes debug/info with console.log, warn/error with
// console.error, at the level of LOG_LEVEL read on every line.
// (Adapted from guim31/gladys-unraid.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_CONFIG,
  APP_PASSWORD,
  CONFIG,
  FakeNextcloud,
  TOKEN,
  USER,
  USER_PASSWORD,
  createAll,
  createWorld,
} from './helpers/world.js';

/** The lines written at `level` from now on. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  for (const stream of ['log', 'error', 'warn', 'info', 'debug']) {
    t.mock.method(console, stream, (...args) =>
      lines.push(args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' ')),
    );
  }
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}

test('a normal cycle writes nothing: reads, states, scene events, widget', async (t) => {
  const nextcloud = new FakeNextcloud({ fixture: 'real/info-up-to-date.json' });
  const world = await createWorld({ nextcloud });
  t.after(() => world.app.stop());
  const lines = captureLogs(t);
  await createAll(world);
  for (let read = 0; read < 5; read += 1) {
    world.clock.advance(61_000);
    nextcloud.data.activeUsers.last5minutes = read;
    nextcloud.system.cpuload = [read / 2, 0.5, 0.4];
    if (read === 2) {
      nextcloud.setAppUpdates({ calendar: '5.5.4' });
    }
    await world.hub.pollAll();
  }
  await world.hub.rediscover();
  await world.fake.widgetGet('nextcloud', { settings: {}, language: 'fr' });
  await world.fake.poll(world.fake.discoveredDevices[0]);
  assert.ok(world.fake.states.length > 16, 'states published');
  assert.equal(world.fake.sceneEvents.length, 1, 'scene event fired');
  assert.deepEqual(lines, []);
});

test('Nextcloud off for several reads: one line, then one when it answers again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const lines = captureLogs(t);
  world.nextcloud.failure = 'down';
  for (let read = 0; read < 4; read += 1) {
    await world.hub.pollAll();
  }
  world.nextcloud.failure = null;
  await world.hub.pollAll();
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /ECONNREFUSED/);
  assert.match(lines[1], /answers again/);
});

test('one line per action of the user', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const lines = captureLogs(t);
  await world.fake.action('test_connection', {});
  await world.fake.widgetAction('nextcloud', 'refresh', {}, { settings: {} });
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /Test the connection/);
  assert.match(lines[1], /Widget nextcloud: refresh/);
});

test('no secret of the configuration in the logs, even in debug and on errors', async (t) => {
  const lines = captureLogs(t, 'debug');
  const worlds = [];
  // The token, refused then accepted.
  const tokenWorld = await createWorld({ config: { ...CONFIG, token: `${TOKEN}-wrong` } });
  worlds.push(tokenWorld);
  await tokenWorld.fake.configUpdated({ ...CONFIG, language: 'fr' });
  await createAll(tokenWorld);
  tokenWorld.nextcloud.failure = 'down';
  await tokenWorld.hub.pollAll();
  tokenWorld.nextcloud.failure = 'offsite';
  await tokenWorld.hub.pollAll();
  await tokenWorld.fake.action('test_connection', {});
  // The account: a wrong password, a user that is not an admin, the right one.
  const accountWorld = await createWorld({
    config: { ...ACCOUNT_CONFIG, app_password: `${APP_PASSWORD}-wrong` },
  });
  worlds.push(accountWorld);
  await accountWorld.fake.configUpdated({
    ...ACCOUNT_CONFIG,
    username: USER,
    app_password: USER_PASSWORD,
  });
  await accountWorld.fake.configUpdated({ ...ACCOUNT_CONFIG });
  await accountWorld.fake.widgetGet('nextcloud', { settings: {}, language: 'en' });
  for (const world of worlds) {
    await world.app.stop();
  }

  assert.ok(lines.length > 0);
  const all = lines.join('\n');
  for (const secret of [TOKEN, APP_PASSWORD, USER_PASSWORD]) {
    assert.ok(!all.includes(secret), `a secret is logged: ${secret}`);
    // Nor its Basic encoding.
    assert.ok(!all.includes(Buffer.from(`${USER}:${secret}`).toString('base64')));
    for (const world of worlds) {
      // Nor sent to Gladys (the device params hold the address only).
      assert.ok(!JSON.stringify(world.fake.requests).includes(secret), 'sent to Gladys');
    }
  }
});
