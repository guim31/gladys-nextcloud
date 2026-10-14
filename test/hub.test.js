// -----------------------------------------------------------------------------
// The hub with the SDK's fake Gladys and the fake Nextcloud: what Gladys
// receives (the device, its states, the badge, the connection status), the
// outages, the refusals and the back-off they cause, the reconfigurations.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ACCOUNT_CONFIG,
  CONFIG,
  FakeNextcloud,
  USER,
  USER_PASSWORD,
  createAll,
  createWorld,
  deviceId,
  featureId,
} from './helpers/world.js';

test('without configuration: no device, a status that says what to fill in', async (t) => {
  const world = await createWorld({ config: {} });
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.discoveredDevices, []);
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /address of your Nextcloud/);
  assert.equal(world.nextcloud.reads, 0);

  await world.fake.configUpdated({ url: 'not a url at all://', token: 'x' });
  assert.match(world.fake.connectionStatus.message.fr, /Adresse incomprise/);
  await world.fake.configUpdated({ url: 'cloud.local', username: 'admin' });
  assert.match(world.fake.connectionStatus.message.de, /serverinfo-Token/);
});

test('the device is offered, then its states sent once added', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const [device] = world.fake.discoveredDevices;
  assert.equal(device.external_id, deviceId(world.gladys));
  assert.equal(device.name, 'Nextcloud');
  assert.equal(device.model, 'Nextcloud');
  assert.deepEqual(device.params, [{ name: 'NEXTCLOUD_URL', value: 'http://192.0.2.20' }]);
  assert.equal(world.fake.connectionStatus.connected, true);
  // Not added yet: nothing sent, Gladys would drop it.
  assert.equal(world.fake.states.length, 0);

  await createAll(world);
  const state = (key) => world.fake.lastState(featureId(world.gladys, key));
  assert.equal(state('online'), 1);
  assert.equal(state('version'), '32.0.9');
  assert.equal(state('update_available'), 1);
  assert.equal(state('app_updates'), 0);
  assert.equal(state('active_users_1h'), 2);
  assert.equal(state('free_space'), 31.7);
  assert.equal(state('memory_cache'), 'None');
  assert.deepEqual(world.fake.transports.at(-1), {
    device_external_id: deviceId(world.gladys),
    transport: 'local',
  });
  assert.ok(world.fake.widgetRefreshes.includes('nextcloud'));
});

test('only the changes are sent', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  const before = world.fake.states.length;
  world.clock.advance(60_000);
  await world.hub.pollAll();
  assert.equal(world.fake.states.length, before, 'nothing changed, nothing sent');

  world.nextcloud.data.activeUsers.last5minutes = 3;
  world.nextcloud.setAppUpdates({ calendar: '5.5.4' });
  await world.hub.pollAll();
  const sent = world.fake.states.slice(before).map((s) => s.device_feature_external_id);
  assert.deepEqual(sent.sort(), [
    featureId(world.gladys, 'active_users_5min'),
    featureId(world.gladys, 'app_updates'),
  ]);
});

test('Nextcloud off: offline after two failed reads, back online after', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  const online = () => world.fake.lastState(featureId(world.gladys, 'online'));

  world.nextcloud.failure = 'down';
  await world.hub.pollAll();
  assert.equal(online(), 1, 'one failure is a blip');
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.fr, /Nextcloud : ne répond pas/);
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');

  await world.hub.pollAll();
  assert.equal(online(), 0);

  world.nextcloud.failure = null;
  await world.hub.pollAll();
  assert.equal(online(), 1);
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(world.fake.transports.at(-1).transport, 'local');
});

test('maintenance mode counts as offline, a refused token does not', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  const online = () => world.fake.lastState(featureId(world.gladys, 'online'));
  world.nextcloud.failure = 'maintenance';
  await world.hub.pollAll();
  await world.hub.pollAll();
  assert.equal(online(), 0);
  assert.match(world.fake.connectionStatus.message.en, /maintenance mode/);

  world.nextcloud.failure = null;
  await world.hub.pollAll();
  await world.fake.configUpdated({ ...CONFIG, token: 'a-wrong-token' });
  await world.hub.pollAll();
  assert.equal(online(), 1, 'a configuration problem is not an outage');
  assert.match(world.fake.connectionStatus.message.en, /token, login or app password refused/);
});

test('an account that is not an administrator is told so', async (t) => {
  const world = await createWorld({
    config: { ...ACCOUNT_CONFIG, username: USER, app_password: USER_PASSWORD },
  });
  t.after(() => world.app.stop());
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /not an administrator/);
  assert.deepEqual(world.fake.discoveredDevices, [], 'never read: nothing to offer');
});

test('after a refusal, the core onPoll does not read again before the back-off', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, token: 'wrong' } });
  t.after(() => world.app.stop());
  const reads = world.nextcloud.reads;
  const device = { external_id: deviceId(world.gladys) };
  world.clock.advance(5 * 60_000);
  await world.fake.poll(device);
  assert.equal(world.nextcloud.reads, reads, 'brute-force protection: no new attempt');
  world.clock.advance(30 * 60_000);
  await world.fake.poll(device);
  assert.equal(world.nextcloud.reads, reads + 1);
});

test('the core onPoll is a fallback: skipped while the timer reads', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  const device = world.fake.discoveredDevices[0];
  const reads = world.nextcloud.reads;
  world.clock.advance(30_000);
  assert.deepEqual(await world.fake.poll(device), { success: true });
  assert.equal(world.nextcloud.reads, reads, 'read 30 s ago: skipped');
  world.clock.advance(30_000);
  await world.fake.poll(device);
  assert.equal(world.nextcloud.reads, reads + 1, 'the timer stalled: the core reads');
  // Another integration's device: ignored.
  await world.fake.poll({ external_id: 'ext:other:device' });
  assert.equal(world.nextcloud.reads, reads + 1);
});

test('the device is added again after a deletion: everything is sent again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  const [device] = world.fake.discoveredDevices;
  await world.fake.deviceDeleted(device);
  const before = world.fake.states.length;
  const transports = world.fake.transports.length;
  await world.fake.deviceCreated(device);
  assert.equal(world.fake.states.length - before, 16);
  assert.equal(world.fake.transports.length, transports + 1);
});

test('the language changes the feature names and the texts', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  await world.fake.configUpdated({ ...CONFIG, language: 'de' });
  const names = world.fake.discoveredDevices[0].features.map((f) => f.name);
  assert.ok(names.includes('Freier Speicher'));
  assert.equal(world.fake.lastState(featureId(world.gladys, 'memory_cache')), 'Keiner');
});

test('the features seen are remembered: a field missing once does not change the device', async (t) => {
  const first = await createWorld();
  await first.app.stop();
  const saved = JSON.parse(await readFile(join(first.dataDir, 'nextcloud-state.json'), 'utf8'));
  assert.ok(saved.seen.includes('free_space'));
  assert.equal(saved.url, 'http://192.0.2.20');
  assert.ok(!JSON.stringify(saved).includes(CONFIG.token), 'no secret in /data');

  // Nextcloud restarted with the free space unknown: the feature stays.
  const nextcloud = new FakeNextcloud();
  nextcloud.system.freespace = null;
  const second = await createWorld({ nextcloud, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  const keys = second.fake.discoveredDevices[0].features.map((f) => f.external_id.split(':').pop());
  assert.ok(keys.includes('free_space'));
});

test('Gladys restarted while Nextcloud is down: the device is still offered', async (t) => {
  const first = await createWorld();
  await first.app.stop();
  const nextcloud = new FakeNextcloud();
  nextcloud.failure = 'down';
  const second = await createWorld({ nextcloud, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.equal(second.fake.discoveredDevices.length, 1);
  assert.equal(second.fake.discoveredDevices[0].features.length, 16);
});

test('a reconnection to Gladys sends everything again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  const before = world.fake.states.length;
  await world.gladys.disconnect();
  await world.gladys.connect();
  assert.equal(world.fake.states.length - before, 16);
});

test('a scan request reads Nextcloud and offers the device again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const reads = world.nextcloud.reads;
  const published = world.fake.requests.filter((r) => r.path === '/discovered_device').length;
  await world.fake.scanRequest();
  assert.equal(world.nextcloud.reads, reads + 1);
  assert.equal(
    world.fake.requests.filter((r) => r.path === '/discovered_device').length,
    published + 1,
  );
});

test('"Test the connection" reports in the four languages', async (t) => {
  const world = await createWorld({ config: { ...ACCOUNT_CONFIG } });
  t.after(() => world.app.stop());
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  const message = ack.data.message;
  assert.deepEqual(Object.keys(message).sort(), ['de', 'en', 'es', 'fr']);
  assert.match(message.fr, /^Nextcloud 32\.0\.9 répond, mise à jour 32\.0\.10 disponible/);
  assert.match(message.en, /read as admin$/);
  for (const text of Object.values(message)) {
    assert.ok(text.length <= 200);
  }

  world.nextcloud.failure = 'disabled';
  const failed = await world.fake.action('test_connection', {});
  assert.match(failed.data.message.en, /"Monitoring" app \(serverinfo\) is disabled/);
});

test('a name from the configuration names the device', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, name: 'Family cloud' } });
  t.after(() => world.app.stop());
  assert.equal(world.fake.discoveredDevices[0].name, 'Family cloud');
});
