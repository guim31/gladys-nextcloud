// -----------------------------------------------------------------------------
// Configuration: the address as users type or paste it, the two ways to
// authenticate, the defaults.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, hostOf, normalizeConfig, parseServerUrl } from '../src/config.js';

test('the address: a bare host, a port, a sub-path, a URL copied from the browser', () => {
  const cases = [
    ['192.0.2.20', 'http://192.0.2.20'],
    ['  cloud.local:8080/ ', 'http://cloud.local:8080'],
    ['https://cloud.example.com', 'https://cloud.example.com'],
    ['https://example.org/nextcloud/', 'https://example.org/nextcloud'],
    ['https://cloud.example.com/index.php/apps/files/?dir=/', 'https://cloud.example.com'],
    ['https://example.org/nextcloud/index.php/login', 'https://example.org/nextcloud'],
    ['https://example.org/nextcloud/apps/dashboard/', 'https://example.org/nextcloud'],
    ['https://cloud.example.com/settings/admin/overview', 'https://cloud.example.com'],
    [
      'https://cloud.example.com/ocs/v2.php/apps/serverinfo/api/v1/info',
      'https://cloud.example.com',
    ],
    ['https://cloud.example.com/status.php', 'https://cloud.example.com'],
    ['HTTPS://Cloud.Example.com', 'https://cloud.example.com'],
  ];
  for (const [typed, expected] of cases) {
    assert.equal(parseServerUrl(typed), expected, typed);
  }
});

test('an unusable address is refused, credentials in it included', () => {
  for (const typed of ['', '   ', 'ftp://cloud.example.com', 'http://', 'https://admin:pw@cloud']) {
    assert.equal(parseServerUrl(typed), null, typed);
  }
  assert.equal(parseServerUrl(undefined), null);
  const config = normalizeConfig({ url: 'https://admin:secret@cloud.example.com', token: 't' });
  assert.equal(config.server, null);
  assert.equal(config.invalidUrl, true);
});

test('the token wins over the account; the account needs its app password', () => {
  const both = normalizeConfig({
    url: 'cloud.local',
    token: ' tok ',
    username: 'admin',
    app_password: 'pw',
  });
  assert.deepEqual(both.server.auth, { kind: 'token', token: 'tok' });

  const account = normalizeConfig({ url: 'cloud.local', username: ' admin ', app_password: 'pw' });
  assert.deepEqual(account.server.auth, { kind: 'basic', username: 'admin', password: 'pw' });

  const half = normalizeConfig({ url: 'cloud.local', username: 'admin' });
  assert.equal(half.server, null);
  assert.equal(half.missingAuth, true);
  assert.equal(half.invalidUrl, false);
});

test('the defaults, and values coming as strings from the form', () => {
  const empty = normalizeConfig({});
  assert.equal(empty.server, null);
  assert.equal(empty.missingAuth, false);
  assert.equal(empty.invalidUrl, false);
  assert.equal(empty.allowSelfSigned, false);
  assert.equal(empty.pollIntervalMs, Number(DEFAULT_CONFIG.poll_interval) * 1000);
  assert.equal(empty.language, 'fr');

  const typed = normalizeConfig({
    url: 'cloud.local',
    token: 'tok',
    allow_self_signed: 'true',
    poll_interval: 300,
    language: 'de',
    name: '  Family cloud  ',
  });
  assert.equal(typed.allowSelfSigned, true);
  assert.equal(typed.pollIntervalMs, 300_000);
  assert.equal(typed.language, 'de');
  assert.equal(typed.server.name, 'Family cloud');

  // Outside the offered list: the default.
  assert.equal(normalizeConfig({ poll_interval: '5' }).pollIntervalMs, 60_000);
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
  assert.equal(normalizeConfig(null).server, null);
});

test('the host shown to the user has no path', () => {
  assert.equal(hostOf('https://example.org:8443/nextcloud'), 'example.org:8443');
  assert.equal(hostOf('not a url'), '?');
});
