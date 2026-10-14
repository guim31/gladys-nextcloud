// -----------------------------------------------------------------------------
// The reading timer of the container. Gladys 5.2.x never polls a device
// created without should_poll (GladysAssistant/Gladys#3198): Nextcloud must
// be read by the hub's own timer, with no onPoll at all. Also: the heartbeat
// that keeps unchanged values recent, the back-off after a refusal, and the
// timer stopping with the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, createAll, createWorld, featureId } from './helpers/world.js';

/** Let the timer callbacks and the fake network settle. */
const settle = async () => {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/** A clock that follows the mocked Date, so the SDK's heartbeat sees the same time. */
const mockedClock = () => ({ now: () => Date.now(), advance() {} });

test('the internal timer reads Nextcloud without any onPoll from Gladys', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 14, 10) });
  const world = await createWorld({
    clock: mockedClock(),
    config: { ...CONFIG, poll_interval: '120' },
    timers: true,
  });
  t.after(() => world.app.stop());
  const polled = t.mock.method(world.hub, 'pollFromCore');
  await createAll(world);
  const reads = world.nextcloud.reads;

  for (const users of [3, 4, 5]) {
    world.nextcloud.data.activeUsers.last5minutes = users;
    t.mock.timers.tick(120_000);
    await settle();
    assert.equal(world.fake.lastState(featureId(world.gladys, 'active_users_5min')), users);
  }
  assert.equal(world.nextcloud.reads - reads, 3, 'one reading per interval');
  assert.equal(polled.mock.callCount(), 0, 'no onPoll involved');
});

test('an unchanged value is sent again every 6 hours, well before Gladys marks it old', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 14, 10) });
  const world = await createWorld({ clock: mockedClock(), timers: true });
  t.after(() => world.app.stop());
  await createAll(world);
  const users = featureId(world.gladys, 'users');
  const sent = () => world.fake.states.filter((s) => s.device_feature_external_id === users);
  assert.equal(sent().length, 1);
  for (let minute = 0; minute < 6 * 60; minute += 1) {
    t.mock.timers.tick(60_000);
    await settle();
  }
  assert.equal(sent().length, 2, 'once at the start, once 6 hours later');
});

test('after a refused token, the timer waits 30 minutes before trying again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 14, 10) });
  const world = await createWorld({
    clock: mockedClock(),
    config: { ...CONFIG, token: 'a-wrong-token' },
    timers: true,
  });
  t.after(() => world.app.stop());
  const reads = world.nextcloud.reads;
  t.mock.timers.tick(29 * 60_000);
  await settle();
  assert.equal(world.nextcloud.reads, reads, 'no new attempt for 30 minutes');
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(world.nextcloud.reads, reads + 1);

  // Fixed in the configuration: read at once, then at the usual pace.
  await world.fake.configUpdated({ ...CONFIG });
  assert.equal(world.fake.connectionStatus.connected, true);
  const fixed = world.nextcloud.reads;
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(world.nextcloud.reads, fixed + 1);
});

test('a failed read is tried again 15 s later, to tell a blip from an outage', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 14, 10) });
  const world = await createWorld({ clock: mockedClock(), timers: true });
  t.after(() => world.app.stop());
  await createAll(world);
  world.nextcloud.failure = 'down';
  t.mock.timers.tick(60_000);
  await settle();
  t.mock.timers.tick(15_000);
  await settle();
  assert.equal(world.fake.lastState(featureId(world.gladys, 'online')), 0, 'two failures');
});

test('the timer stops with the integration', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 14, 10) });
  const world = await createWorld({ clock: mockedClock(), timers: true });
  await world.app.stop();
  const before = world.nextcloud.requests.length;
  t.mock.timers.tick(60 * 60_000);
  await settle();
  assert.equal(world.nextcloud.requests.length, before);
});
