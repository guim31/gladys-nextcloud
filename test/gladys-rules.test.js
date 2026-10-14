// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on the device discovered from realistic
// answers: a real Nextcloud 32.0.9 (test/fixtures/nextcloud/real/), the
// Nextcloud 28 answer of the Home Assistant tests (no thread count), and
// with an account instead of the token, in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// (Adapted from guim31/gladys-wled.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACCOUNT_CONFIG, CONFIG, FakeNextcloud, createAll, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const scenarios = [
  { label: 'English names', config: { ...CONFIG, language: 'en' }, features: 16 },
  { label: 'French names', config: { ...CONFIG, language: 'fr' }, features: 16 },
  { label: 'German names', config: { ...CONFIG, language: 'de' }, features: 16 },
  { label: 'Spanish names', config: { ...CONFIG, language: 'es' }, features: 16 },
  { label: 'an administrator account', config: { ...ACCOUNT_CONFIG }, features: 16 },
  {
    label: 'Nextcloud 28 (Home Assistant fixture)',
    config: { ...CONFIG, language: 'fr' },
    nextcloud: () => new FakeNextcloud({ fixture: 'home-assistant-28.0.4.json' }),
    // No thread count before serverinfo of Nextcloud 28.0.x: no system load.
    features: 15,
  },
];

for (const scenario of scenarios) {
  test(`the discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const world = await createWorld({
      config: scenario.config,
      ...(scenario.nextcloud ? { nextcloud: scenario.nextcloud() } : {}),
    });
    try {
      await createAll(world);
      const devices = world.fake.discoveredDevices;
      assert.equal(devices.length, 1);

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.equal(device.features.length, scenario.features, `${where}: features`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          // Read only: the integration never changes anything in Nextcloud.
          assert.equal(feature.read_only, true, `${at}: must be read only`);
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(
                allowed.includes(feature.unit),
                `${at}: ${feature.unit} for ${feature.category}`,
              );
            }
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
          assert.ok(feature.name.length <= 40, `${at}: name too long`);

          // The value read from the fixtures fits the declared bounds; a
          // text is a non-empty text.
          const state = world.fake.states.findLast(
            (entry) => entry.device_feature_external_id === feature.external_id,
          );
          if (feature.category === 'text') {
            assert.equal(typeof state?.text, 'string', `${at}: no text published`);
            assert.ok(state.text.length > 0, `${at}: empty text`);
            continue;
          }
          const value = state?.state;
          assert.equal(typeof value, 'number', `${at}: no state published`);
          assert.ok(value >= feature.min && value <= feature.max, `${at}: ${value} out of bounds`);
          if (feature.type === 'integer' || feature.type === 'binary') {
            assert.ok(Number.isInteger(value), `${at}: ${value} is not an integer`);
          }
        }
      }
    } finally {
      await world.app.stop();
    }
  });
}
