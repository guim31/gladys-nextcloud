// -----------------------------------------------------------------------------
// The serverinfo answer turned into a snapshot: the real answers of a
// Nextcloud 32.0.9, the Nextcloud 28 answer of the Home Assistant tests, and
// the fields a system or an older serverinfo leaves out.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  cacheName,
  cacheSummary,
  numberOf,
  parseInfo,
  pendingUpdates,
  shortVersion,
} from '../src/nextcloud/model.js';

const load = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/nextcloud/${name}`, import.meta.url), 'utf8')).ocs
    .data;

test('a real Nextcloud 32.0.9 with an update waiting', async () => {
  const snapshot = parseInfo(await load('real/info-update-available.json'));
  assert.equal(snapshot.version, '32.0.9.2');
  assert.equal(snapshot.shortVersion, '32.0.9');
  assert.deepEqual(snapshot.update, {
    available: true,
    version: '32.0.10.1',
    shortVersion: '32.0.10',
  });
  assert.deepEqual(snapshot.apps, { installed: 28, updates: [] });
  assert.equal(snapshot.users, 2);
  assert.equal(snapshot.files, 23);
  assert.equal(snapshot.shares, 2);
  assert.equal(snapshot.freeBytes, 31692312576);
  // The database size is a string in the answer.
  assert.equal(snapshot.databaseBytes, 1777664);
  assert.equal(snapshot.databaseType, 'sqlite3');
  assert.equal(snapshot.threads, 4);
  assert.ok(snapshot.loadPercent >= 0 && snapshot.loadPercent < 100);
  assert.ok(snapshot.memoryPercent > 0 && snapshot.memoryPercent < 100);
  assert.equal(snapshot.phpVersion, '8.3.6');
  assert.deepEqual(snapshot.cache, { local: null, distributed: null, locking: null });
  assert.equal(cacheSummary(snapshot), null);
  assert.deepEqual(snapshot.activeUsers, { last5minutes: 0, last1hour: 2, last24hours: 2 });
  assert.equal(pendingUpdates(snapshot), 1);
});

test('a real Nextcloud 32.0.9 up to date', async () => {
  const snapshot = parseInfo(await load('real/info-up-to-date.json'));
  assert.deepEqual(snapshot.update, { available: false, version: null, shortVersion: null });
  assert.equal(pendingUpdates(snapshot), 0);
});

test('Nextcloud 28 (Home Assistant fixture): APCu, no thread count, memory in KiB', async () => {
  const snapshot = parseInfo(await load('home-assistant-28.0.4.json'));
  assert.equal(snapshot.shortVersion, '28.0.4');
  assert.deepEqual(snapshot.update, { available: false, version: null, shortVersion: null });
  assert.equal(snapshot.threads, null);
  assert.equal(snapshot.loadPercent, null, 'no thread count: no load percentage');
  assert.equal(snapshot.loadAverage, 2.06640625);
  // 30728192 KiB total, 6753280 KiB available: 78 % used.
  assert.equal(Math.round(snapshot.memoryPercent), 78);
  assert.equal(snapshot.freeBytes, 32769138688);
  assert.equal(snapshot.cache.local, 'APCu');
  assert.equal(cacheSummary(snapshot), 'APCu');
  assert.deepEqual(snapshot.activeUsers, { last5minutes: 0, last1hour: 0, last24hours: 0 });
});

test('the app updates: an object of versions, or an empty PHP array', () => {
  const data = (updates) => ({
    nextcloud: { system: { apps: { num_installed: 40, app_updates: updates } } },
  });
  assert.deepEqual(parseInfo(data([])).apps.updates, []);
  assert.deepEqual(parseInfo(data({ contacts: '7.3.2', calendar: '5.5.4' })).apps.updates, [
    { id: 'calendar', version: '5.5.4' },
    { id: 'contacts', version: '7.3.2' },
  ]);
  // Without the apps section (skipApps ignored by an old serverinfo): unknown.
  assert.equal(parseInfo({ nextcloud: { system: {} } }).apps, null);
});

test('missing or odd fields are null, never a guess', () => {
  const snapshot = parseInfo({
    nextcloud: {
      system: {
        version: '31.0.0',
        freespace: null,
        cpuload: false,
        mem_total: 0,
        mem_free: 0,
        'memcache.local': '\\OC\\Memcache\\APCu',
        'memcache.distributed': '\\OC\\Memcache\\Redis',
        'memcache.locking': '\\OC\\Memcache\\Redis',
      },
    },
    server: { database: { type: 'mysql', size: 'N/A' } },
  });
  assert.equal(snapshot.shortVersion, '31.0.0');
  assert.equal(snapshot.update, null);
  assert.equal(snapshot.freeBytes, null);
  assert.equal(snapshot.loadPercent, null);
  assert.equal(snapshot.memoryPercent, null);
  assert.equal(snapshot.databaseBytes, null);
  assert.equal(snapshot.users, null);
  assert.equal(snapshot.phpVersion, null);
  assert.equal(cacheSummary(snapshot), 'APCu + Redis');
  assert.equal(parseInfo({}).version, null);
});

test('small helpers', () => {
  assert.equal(shortVersion('32.0.9.2'), '32.0.9');
  assert.equal(shortVersion('33.0.0'), '33.0.0');
  assert.equal(shortVersion('32.0.0 beta 1'), '32.0.0 beta 1');
  assert.equal(shortVersion(''), null);
  assert.equal(cacheName('none'), null);
  assert.equal(cacheName('\\OC\\Memcache\\Memcached'), 'Memcached');
  assert.equal(numberOf('1474560'), 1474560);
  assert.equal(numberOf('N/A'), null);
  assert.equal(numberOf(Number.NaN), null);
});
