// -----------------------------------------------------------------------------
// The scene triggers: an update of Nextcloud, new app updates. Once per
// version, never at the first read (what is already there is recorded
// silently), never twice across a restart, never again because the app
// store of Nextcloud failed once.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG, FakeNextcloud, createWorld } from './helpers/world.js';

const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);

test('a new Nextcloud version fires once, with its variables', async (t) => {
  const nextcloud = new FakeNextcloud({ fixture: 'real/info-up-to-date.json' });
  const world = await createWorld({ nextcloud });
  t.after(() => world.app.stop());
  assert.equal(world.fake.sceneEvents.length, 0);

  nextcloud.setUpdate('32.0.10.1');
  await world.hub.pollAll();
  await world.hub.pollAll();
  assert.deepEqual(events(world, 'nextcloud_update_available'), [
    {
      key: 'nextcloud_update_available',
      data: { server_name: 'Nextcloud', installed_version: '32.0.9', new_version: '32.0.10' },
    },
  ]);

  // The update check flaps (no result), then the same version again: nothing.
  nextcloud.setUpdate(null);
  await world.hub.pollAll();
  nextcloud.setUpdate('32.0.10.1');
  await world.hub.pollAll();
  assert.equal(events(world, 'nextcloud_update_available').length, 1);

  // A newer one: fired.
  nextcloud.setUpdate('32.0.11.0');
  await world.hub.pollAll();
  assert.equal(events(world, 'nextcloud_update_available').length, 2);
  assert.equal(events(world, 'nextcloud_update_available')[1].data.new_version, '32.0.11');
});

test('what is already there at the first read is recorded, not announced', async (t) => {
  const world = await createWorld(); // 32.0.10 already waiting
  t.after(() => world.app.stop());
  await world.hub.pollAll();
  assert.deepEqual(world.fake.sceneEvents, []);
});

test('a restart does not announce the same update again', async (t) => {
  const nextcloud = new FakeNextcloud({ fixture: 'real/info-up-to-date.json' });
  const first = await createWorld({ nextcloud });
  nextcloud.setUpdate('32.0.10.1');
  nextcloud.setAppUpdates({ calendar: '5.5.4' });
  await first.hub.pollAll();
  assert.equal(first.fake.sceneEvents.length, 2);
  await first.app.stop();
  const saved = JSON.parse(await readFile(join(first.dataDir, 'nextcloud-state.json'), 'utf8'));
  assert.deepEqual(saved.announced, { server: '32.0.10.1', apps: { calendar: '5.5.4' } });

  const second = await createWorld({ nextcloud, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  await second.hub.pollAll();
  assert.deepEqual(second.fake.sceneEvents, []);
});

test('another address is another instance: recorded again, silently', async (t) => {
  const nextcloud = new FakeNextcloud({ fixture: 'real/info-up-to-date.json' });
  const world = await createWorld({ nextcloud });
  t.after(() => world.app.stop());
  await world.fake.configUpdated({ ...CONFIG, url: 'http://192.0.2.20/' });
  nextcloud.setUpdate('32.0.10.1');
  await world.fake.configUpdated({ ...CONFIG, url: 'https://192.0.2.20', allow_self_signed: true });
  // The fake serves HTTP only: unreadable, nothing announced.
  assert.deepEqual(world.fake.sceneEvents, []);
  await world.fake.configUpdated({ ...CONFIG });
  assert.deepEqual(world.fake.sceneEvents, [], 'the address changed twice: first read again');
});

test('new app updates fire one event with the list; an app store blip does not repeat it', async (t) => {
  const nextcloud = new FakeNextcloud({ fixture: 'real/info-up-to-date.json' });
  const world = await createWorld({ nextcloud });
  t.after(() => world.app.stop());

  nextcloud.setAppUpdates({ contacts: '7.3.2', calendar: '5.5.4' });
  await world.hub.pollAll();
  assert.deepEqual(events(world, 'app_updates_available'), [
    {
      key: 'app_updates_available',
      data: {
        server_name: 'Nextcloud',
        count: 2,
        total: 2,
        apps: 'calendar 5.5.4, contacts 7.3.2',
      },
    },
  ]);

  // The app store of Nextcloud failed once: no update listed, then back.
  nextcloud.setAppUpdates({});
  await world.hub.pollAll();
  nextcloud.setAppUpdates({ contacts: '7.3.2', calendar: '5.5.4' });
  await world.hub.pollAll();
  assert.equal(events(world, 'app_updates_available').length, 1);

  // One more app, and a newer calendar: only the news.
  nextcloud.setAppUpdates({ contacts: '7.3.2', calendar: '5.5.5', deck: '1.15.0' });
  await world.hub.pollAll();
  const last = events(world, 'app_updates_available').at(-1);
  assert.deepEqual(last.data, {
    server_name: 'Nextcloud',
    count: 2,
    total: 3,
    apps: 'calendar 5.5.5, deck 1.15.0',
  });
});

test('a long list of apps is cut to what a scene variable holds', async (t) => {
  const nextcloud = new FakeNextcloud({ fixture: 'real/info-up-to-date.json' });
  const world = await createWorld({ nextcloud });
  t.after(() => world.app.stop());
  const many = Object.fromEntries(
    Array.from({ length: 120 }, (_, i) => [`some_rather_long_app_name_${i}`, '10.20.30']),
  );
  nextcloud.setAppUpdates(many);
  await world.hub.pollAll();
  const [event] = events(world, 'app_updates_available');
  assert.equal(event.data.count, 120);
  assert.ok(event.data.apps.length <= 1000);
  assert.ok(event.data.apps.endsWith('…'));
});

test('the device name configured is the server_name of the events', async (t) => {
  const nextcloud = new FakeNextcloud({ fixture: 'real/info-up-to-date.json' });
  const world = await createWorld({ nextcloud, config: { ...CONFIG, name: 'Family cloud' } });
  t.after(() => world.app.stop());
  nextcloud.setUpdate('33.0.0.16');
  await world.hub.pollAll();
  assert.equal(events(world, 'nextcloud_update_available')[0].data.server_name, 'Family cloud');
  assert.equal(events(world, 'nextcloud_update_available')[0].data.new_version, '33.0.0');
});
