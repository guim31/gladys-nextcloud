// -----------------------------------------------------------------------------
// Against a real Nextcloud, through the real HTTP client: skipped unless
// NEXTCLOUD_URL is set (the CI has no Nextcloud). Read only, like the
// integration.
//
//   NEXTCLOUD_URL=http://127.0.0.1:8089 \
//   NEXTCLOUD_TOKEN=… (and/or NEXTCLOUD_USER=admin NEXTCLOUD_APP_PASSWORD=…) \
//   npm run test:real
//
// NEXTCLOUD_INSECURE=1 accepts a self-signed certificate.
// NEXTCLOUD_TEST_REFUSALS=1 also sends a wrong token and a wrong password:
// Nextcloud's brute-force protection then slows down this address for a
// while (`occ security:bruteforce:reset <address>` lifts it).
// How to run a throwaway Nextcloud for it: test/fixtures/nextcloud/README.md.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { parseServerUrl } from '../src/config.js';
import { ERROR_KINDS, NextcloudClient } from '../src/nextcloud/client.js';
import { parseInfo } from '../src/nextcloud/model.js';
import { Store } from '../src/store.js';

process.env.LOG_LEVEL ??= 'silent';

const {
  NEXTCLOUD_URL,
  NEXTCLOUD_TOKEN,
  NEXTCLOUD_USER,
  NEXTCLOUD_APP_PASSWORD,
  NEXTCLOUD_INSECURE,
  NEXTCLOUD_TEST_REFUSALS,
} = process.env;
const url = NEXTCLOUD_URL ? parseServerUrl(NEXTCLOUD_URL) : null;
const insecure = NEXTCLOUD_INSECURE === '1';
const skip = url ? false : 'NEXTCLOUD_URL is not set';

const auths = [
  NEXTCLOUD_TOKEN ? { kind: 'token', token: NEXTCLOUD_TOKEN } : null,
  NEXTCLOUD_USER && NEXTCLOUD_APP_PASSWORD
    ? { kind: 'basic', username: NEXTCLOUD_USER, password: NEXTCLOUD_APP_PASSWORD }
    : null,
].filter(Boolean);

for (const auth of auths) {
  test(`serverinfo answers (${auth.kind})`, { skip }, async () => {
    const client = new NextcloudClient({ url, auth, insecure });
    const snapshot = parseInfo(await client.info());
    assert.match(snapshot.shortVersion, /^\d+\.\d+\.\d+$/);
    assert.ok(snapshot.update, 'the update check is part of the answer');
    assert.ok(snapshot.apps, 'the apps are part of the answer');
    assert.ok(snapshot.users >= 1);
    assert.equal(typeof snapshot.activeUsers.last24hours, 'number');
  });
}

test('the whole integration against this Nextcloud', { skip }, async (t) => {
  const config = {
    url,
    token: NEXTCLOUD_TOKEN ?? '',
    username: NEXTCLOUD_USER ?? '',
    app_password: NEXTCLOUD_APP_PASSWORD ?? '',
    allow_self_signed: insecure,
    language: 'fr',
  };
  const gladys = createFakeGladys({ config });
  const app = registerHandlers(gladys, {
    store: new Store(mkdtempSync(join(tmpdir(), 'gladys-nextcloud-real-'))),
    timers: false,
  });
  t.after(() => app.stop());
  await gladys.connect();
  await app.ready;
  assert.equal(
    gladys.fake.connectionStatus.connected,
    true,
    JSON.stringify(gladys.fake.connectionStatus),
  );

  const [device] = gladys.fake.discoveredDevices;
  assert.ok(device, 'the device is offered');
  await gladys.fake.deviceCreated(device);
  assert.equal(gladys.fake.lastState(`${device.external_id}:online`), 1);
  assert.ok(gladys.fake.states.length >= 10, 'the states are sent');

  const report = await gladys.fake.action('test_connection', {});
  assert.match(report.data.message.fr, /^Nextcloud \d+\.\d+\.\d+ répond/);

  const widget = await gladys.fake.widgetGet('nextcloud', { settings: {}, language: 'fr' });
  assert.deepEqual(validateWidgetContent(widget.data.content), []);
});

test(
  'a wrong token and a wrong password are refused as such',
  { skip: skip || (NEXTCLOUD_TEST_REFUSALS === '1' ? false : 'NEXTCLOUD_TEST_REFUSALS is not 1') },
  async () => {
    const kindOf = async (auth) => {
      try {
        await new NextcloudClient({ url, auth, insecure }).info();
        return 'resolved';
      } catch (err) {
        return err.kind;
      }
    };
    assert.equal(await kindOf({ kind: 'token', token: 'gladys-wrong-token' }), ERROR_KINDS.AUTH);
    assert.equal(
      await kindOf({ kind: 'basic', username: NEXTCLOUD_USER ?? 'admin', password: 'wrong' }),
      ERROR_KINDS.AUTH,
    );
  },
);
