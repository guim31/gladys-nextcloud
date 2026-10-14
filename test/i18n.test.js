// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, and the four documentation files, with the same sections. German says
// "du", never the polite "Sie". (Adapted from guim31/gladys-unraid.)
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { NAMES } from '../src/devices.js';
import { ERROR_KINDS } from '../src/nextcloud/client.js';
import {
  CACHE_NONE,
  CONNECTION_TEXT,
  DONE_TEXT,
  ERROR_TEXT,
  INIT_FAILED,
  REPORT_TEXT,
} from '../src/texts.js';
import { TEXT } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 200,
  short: 24,
  status: 40,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(table, name, max, render = (value) => value) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(render(value), `${name}.${lang}.${key}`, lang, max));
    }
  }
  return found;
}

const each = (table, name, max) =>
  Object.entries(table).flatMap(([key, value]) => problems(value, `${name}.${key}`, max));

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  assert.deepEqual(Object.keys(NAMES), LANGS);
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 50, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the name is the same in every language, and the catalog text long enough', () => {
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const lang of LANGS) {
    assert.ok(manifest.description[lang].length >= 10, `description.${lang} is too short`);
  }
});

test('every message table of the code has the four languages', () => {
  // Widget texts shown as tiles, rows or buttons are short; the others are messages.
  const longWidgetTexts = new Set(['pick', 'waiting']);
  const found = [
    ...problems(INIT_FAILED, 'INIT_FAILED', MAX.message),
    ...problems(CACHE_NONE, 'CACHE_NONE', MAX.short),
    ...each(CONNECTION_TEXT, 'CONNECTION_TEXT', MAX.message),
    // "Name: reason" holds in the 200 characters of a status.
    ...each(ERROR_TEXT, 'ERROR_TEXT', 120),
    ...Object.entries(TEXT).flatMap(([key, value]) =>
      problems(value, `TEXT.${key}`, longWidgetTexts.has(key) ? MAX.message : MAX.status),
    ),
  ];
  assert.deepEqual(found, []);
  assert.deepEqual(sorted(Object.keys(ERROR_TEXT)), sorted(Object.values(ERROR_KINDS)));
  // Buttons and tiles hold 24 characters.
  for (const key of ['refresh', 'open', 'free', 'active', 'updates']) {
    assert.deepEqual(problems(TEXT[key], `TEXT.${key}`, MAX.short), []);
  }
});

test('the feature names exist in every language', () => {
  assert.deepEqual(tableProblems(NAMES, 'NAMES', MAX.featureName), []);
});

test('the report and the toasts exist in every language', () => {
  const render = (value) => (typeof value === 'function' ? value('12') : value);
  assert.deepEqual(tableProblems(REPORT_TEXT, 'REPORT_TEXT', MAX.message, render), []);
  assert.deepEqual(tableProblems(DONE_TEXT, 'DONE_TEXT', MAX.message), []);
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: 'Licht' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: '', es: 'Luz' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Gerät', 'Ihre IP', 'mit Ihrem', 'Ihnen']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_triggers[0].variables[0].label.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_triggers[0].variables[0].label has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});

// --- Documentation -------------------------------------------------------------

const docs = Object.fromEntries(
  await Promise.all(
    LANGS.map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);

const headings = (markdown) =>
  markdown
    .split('\n')
    .filter((line) => /^#{1,3} /.test(line))
    .map((line) => line.match(/^#+/)[0].length);

test('the four documentation files exist, with the same sections', () => {
  for (const lang of LANGS) {
    assert.ok(docs[lang].length >= 300, `docs/${lang}.md is too short for the store`);
    assert.deepEqual(headings(docs[lang]), headings(docs.en), `docs/${lang}.md sections`);
  }
  assert.ok(headings(docs.en).length >= 10);
});

test('the documentation names every trigger, feature, setting and widget button', () => {
  for (const lang of LANGS) {
    const doc = docs[lang];
    for (const item of manifest.scene_triggers) {
      assert.ok(doc.includes(item.label[lang]), `docs/${lang}.md: "${item.label[lang]}"`);
      for (const variable of item.variables) {
        assert.ok(doc.includes(variable.key), `docs/${lang}.md: variable "${variable.key}"`);
      }
    }
    for (const name of Object.values(NAMES[lang])) {
      assert.ok(doc.includes(name), `docs/${lang}.md: feature "${name}"`);
    }
    for (const key of ['refresh', 'open']) {
      assert.ok(doc.includes(TEXT[key][lang]), `docs/${lang}.md: "${TEXT[key][lang]}"`);
    }
    for (const action of manifest.actions) {
      assert.ok(doc.includes(action.label[lang]), `docs/${lang}.md: "${action.label[lang]}"`);
    }
    for (const entry of manifest.config_schema.filter((f) => f.type !== 'section')) {
      assert.ok(doc.includes(entry.label[lang]), `docs/${lang}.md: setting "${entry.label[lang]}"`);
    }
  }
});

test('the German documentation says "du"', () => {
  const polite = docs.de
    .split('\n')
    .filter((line) => !line.startsWith('`') && POLITE_GERMAN.test(line));
  assert.deepEqual(polite, []);
});

test('the documentation says what was tested, where to give feedback, and who owns the brand', () => {
  assert.match(docs.en, /Tested against a real Nextcloud 32/);
  assert.match(docs.fr, /Testée contre un vrai Nextcloud 32/);
  assert.match(docs.de, /Gegen eine echte Nextcloud 32 getestet/);
  assert.match(docs.es, /Probada con un Nextcloud 32 real/);
  for (const lang of LANGS) {
    assert.match(docs[lang], /github\.com\/guim31\/gladys-nextcloud\/issues/);
    assert.match(docs[lang], /Nextcloud GmbH/);
  }
});
