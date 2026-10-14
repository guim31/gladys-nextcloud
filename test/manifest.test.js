// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// (Adapted from the template and guim31/gladys-unraid.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, LANGUAGES, POLL_INTERVALS } from '../src/config.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { WIDGETS } from '../src/widgets.js';
import { FakeNextcloud, createWorld } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const CAPABILITY_MIN_GLADYS_VERSION = [5, 1, 0];
const CATEGORIES_MIN_GLADYS_VERSION = [4, 86, 0];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('identity: name, image, cover, local transport, categories', () => {
  assert.equal(manifest.name, 'Nextcloud');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-nextcloud:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-nextcloud/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['services', 'network']);
  assert.equal(pkg.name, 'gladys-nextcloud');
});

test('every manifest action has a handler', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const action of manifest.actions) {
    const ack = await world.fake.action(action.key, {});
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
  }
  assert.deepEqual(keysOf(manifest.actions), ['test_connection']);
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(minGladysVersion(), CATEGORIES_MIN_GLADYS_VERSION));
});

test('scene triggers and widgets require Gladys >= 5.1.0, no widget form (5.2.0)', () => {
  assert.ok(manifest.scene_triggers && manifest.widgets);
  assert.ok(isAtLeast(minGladysVersion(), CAPABILITY_MIN_GLADYS_VERSION));
  // Read only: no scene action.
  assert.equal(manifest.scene_actions, undefined);
  assert.equal(manifest.gladys_version, '>=5.1.0');
});

test('every widget key has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets), Object.keys(WIDGETS));
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
});

test('every scene trigger the code fires is declared, with the variables it sends', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  const nextcloud = new FakeNextcloud({ fixture: 'real/info-up-to-date.json' });
  const world = await createWorld({ nextcloud });
  t.after(() => world.app.stop());
  nextcloud.setUpdate('32.0.10.1');
  nextcloud.setAppUpdates({ calendar: '5.5.4' });
  await world.hub.pollAll();
  assert.equal(world.fake.sceneEvents.length, 2);
  for (const event of world.fake.sceneEvents) {
    const declared = manifest.scene_triggers.find((entry) => entry.key === event.key);
    assert.ok(declared, `${event.key} is not declared`);
    // `data` carries exactly the declared variables, of the declared types.
    assert.deepEqual(Object.keys(event.data).sort(), keysOf(declared.variables).sort());
    for (const variable of declared.variables) {
      assert.equal(typeof event.data[variable.key], variable.type, `${event.key}.${variable.key}`);
    }
    // Nothing to filter on: one instance, the event is the whole story.
    assert.equal(declared.fields, undefined);
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.ok(!(field.key in DEFAULT_CONFIG), `section "${field.key}" stores no value`);
      assert.equal(field.required, undefined);
      assert.equal(field.default, undefined);
      assert.equal(field.placeholder, undefined);
      for (const link of field.links ?? []) {
        assert.match(link.url, /^https:\/\//, 'section links must be https');
      }
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `${field.key} has no default in the code`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
  const values = (key) =>
    manifest.config_schema.find((f) => f.key === key).options.map((option) => option.value);
  assert.deepEqual(values('poll_interval'), POLL_INTERVALS);
  assert.deepEqual(values('language'), LANGUAGES);
  // The secrets are secret fields, never shown back.
  for (const key of ['token', 'app_password']) {
    assert.equal(manifest.config_schema.find((f) => f.key === key).type, 'secret');
  }
});

test('the version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('field placeholders are multi-language objects', () => {
  const withPlaceholder = allFields.filter((f) => f.placeholder !== undefined);
  assert.ok(withPlaceholder.length > 0);
  for (const field of withPlaceholder) {
    assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
    assert.ok(field.placeholder.en, `field "${field.key}": placeholder needs an English text`);
  }
});
