// -----------------------------------------------------------------------------
// The dashboard widget: every content it can produce fits the vocabulary and
// the budget of the core (validateWidgetContent of the SDK: [] means
// "rendered exactly as sent"), in the four languages; the Refresh button.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { CONFIG, FakeNextcloud, createWorld } from './helpers/world.js';

const LANGUAGES = ['en', 'fr', 'de', 'es'];

async function contentOf(world, language = 'en') {
  const ack = await world.fake.widgetGet('nextcloud', { settings: {}, language, units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  const { content } = ack.data;
  assert.deepEqual(validateWidgetContent(content), [], JSON.stringify(content));
  return content;
}

const texts = (content) =>
  content.components.flatMap((c) => [
    c.text,
    c.label,
    ...(c.items ?? []).flatMap((item) => [item.label, item.value]),
  ]);

test('a Nextcloud with updates: free space, active users, updates first', async (t) => {
  const nextcloud = new FakeNextcloud();
  nextcloud.setAppUpdates({ calendar: '5.5.4', contacts: '7.3.2' });
  nextcloud.system['memcache.local'] = '\\OC\\Memcache\\APCu';
  const world = await createWorld({ nextcloud });
  t.after(() => world.app.stop());
  for (const language of LANGUAGES) {
    const content = await contentOf(world, language);
    const [heading, free, active, updates, status, refresh] = content.components;
    assert.equal(heading.text, 'Nextcloud 32.0.9');
    assert.equal(free.unit, language === 'fr' ? 'Go' : 'GB');
    assert.equal(active.value, 0);
    assert.equal(updates.value, 3);
    assert.equal(updates.color, 'warning');
    assert.equal(status.items[0].value, '32.0.9 → 32.0.10');
    assert.equal(status.items[1].value, 'calendar, contacts');
    assert.ok(status.items.length <= 10);
    assert.equal(refresh.action.key, 'refresh');
    // An HTTP address: no link (the core opens https links only).
    assert.equal(content.components.length, 6);
  }
});

test('up to date, with a name and an HTTPS address: the Open button', async (t) => {
  const nextcloud = new FakeNextcloud({ fixture: 'real/info-up-to-date.json', scheme: 'https' });
  const world = await createWorld({
    nextcloud,
    config: { ...CONFIG, url: 'https://192.0.2.20', allow_self_signed: true, name: 'Home' },
  });
  t.after(() => world.app.stop());
  const content = await contentOf(world, 'fr');
  assert.equal(content.components[0].text, 'Home · Nextcloud 32.0.9');
  assert.equal(content.components[3].value, 0);
  assert.equal(content.components[3].color, 'success');
  const open = content.components.at(-1);
  assert.equal(open.link.url, 'https://192.0.2.20/index.php/settings/admin/overview');
  assert.ok(texts(content).includes('À jour'));
});

test('the Home Assistant fixture (Nextcloud 28) and a busy server', async (t) => {
  const nextcloud = new FakeNextcloud({ fixture: 'home-assistant-28.0.4.json' });
  nextcloud.system.cpunum = 2;
  nextcloud.system.cpuload = [3.5, 2, 1];
  const world = await createWorld({ nextcloud });
  t.after(() => world.app.stop());
  const content = await contentOf(world, 'de');
  const [status] = content.components.filter((c) => c.type === 'status');
  // Overloaded: the load comes first, in orange.
  assert.deepEqual(status.items[0], {
    label: 'Systemlast',
    icon: 'cpu',
    value: '175 %',
    color: 'warning',
  });
});

test('not configured, unreachable, refused: a sentence, never an error', async (t) => {
  const empty = await createWorld({ config: {} });
  t.after(() => empty.app.stop());
  const pick = await contentOf(empty, 'es');
  assert.match(pick.components[0].text, /Introduzca la dirección de su Nextcloud/);

  const nextcloud = new FakeNextcloud();
  nextcloud.failure = 'down';
  const down = await createWorld({ nextcloud });
  t.after(() => down.app.stop());
  const content = await contentOf(down, 'fr');
  assert.equal(content.components[0].text, 'Nextcloud : ne répond pas');
  assert.equal(content.components[1].action.key, 'refresh');

  const refused = await createWorld({ config: { ...CONFIG, token: 'wrong' } });
  t.after(() => refused.app.stop());
  assert.match((await contentOf(refused)).components[0].text, /refused/);
});

test('the Refresh button reads Nextcloud again and says so', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const reads = world.nextcloud.reads;
  const ack = await world.fake.widgetAction('nextcloud', 'refresh', {}, { settings: {} });
  assert.equal(ack.success, true);
  assert.equal(world.nextcloud.reads, reads + 1);
  assert.deepEqual(ack.data.message, {
    en: 'Nextcloud read again',
    fr: 'Nextcloud relu',
    de: 'Nextcloud neu gelesen',
    es: 'Nextcloud leído de nuevo',
  });
  const unknown = await world.fake.widgetAction('nextcloud', 'reboot', {}, { settings: {} });
  assert.equal(unknown.success, false);
});

test('a change the widget shows refreshes it at once', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const before = world.fake.widgetRefreshes.length;
  await world.hub.pollAll();
  assert.equal(world.fake.widgetRefreshes.length, before, 'nothing changed');
  world.nextcloud.setAppUpdates({ deck: '1.15.0' });
  await world.hub.pollAll();
  assert.equal(world.fake.widgetRefreshes.length, before + 1);
});
