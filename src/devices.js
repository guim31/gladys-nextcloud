// -----------------------------------------------------------------------------
// The Gladys device of a Nextcloud instance, proposed in the Discovery tab:
// the user adds it, nothing is created on their behalf.
//
// One device per instance: online, version, update available, apps with an
// update, active users (5 minutes, 1 hour, 24 hours), users, files, shares,
// free space, database size, system load, memory used, PHP version and memory
// cache. All read only: the integration never changes anything in Nextcloud.
//
// Identity: the configuration slot (1). Nextcloud gives no instance id over
// serverinfo, and the address may change (HTTP to HTTPS, a new domain)
// without the instance changing: the slot keeps the device, its history and
// its scenes.
//
// A feature marked `optional` exists once it has had a value (what this
// Nextcloud tells: the update check, the app updates, the free space, the
// threads of the processor…). The features seen are remembered in /data
// (src/hub.js), so a field missing once does not change the structure of the
// device.
//
// Category/type couples come from the core table (see
// test/gladys-rules.test.js). The core has no generic "percent" category:
// percentages are `level-sensor/liquid-level-percent` (bounds 0-100, the
// couple Glances, Unraid and OctoPrint use).
//
// Published with should_poll: true and a poll frequency of one minute, so
// that the core's onPoll can take over if the container's own timer stalls;
// the timer (src/hub.js) does the reading, at the interval of the
// configuration, and the core's onPoll is skipped while it runs.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORY,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { cacheSummary } from './nextcloud/model.js';
import { CACHE_NONE, pick } from './texts.js';

export const DEVICE_TYPE = 'instance';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  ONLINE: 'online',
  VERSION: 'version',
  UPDATE_AVAILABLE: 'update_available',
  APP_UPDATES: 'app_updates',
  ACTIVE_USERS_5MIN: 'active_users_5min',
  ACTIVE_USERS_1H: 'active_users_1h',
  ACTIVE_USERS_24H: 'active_users_24h',
  USERS: 'users',
  FILES: 'files',
  SHARES: 'shares',
  FREE_SPACE: 'free_space',
  DATABASE_SIZE: 'database_size',
  SYSTEM_LOAD: 'system_load',
  MEMORY: 'memory',
  PHP_VERSION: 'php_version',
  MEMORY_CACHE: 'memory_cache',
});

const K = FEATURE_KEYS;

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [K.ONLINE]: 'Online',
    [K.VERSION]: 'Nextcloud version',
    [K.UPDATE_AVAILABLE]: 'Nextcloud update available',
    [K.APP_UPDATES]: 'App updates',
    [K.ACTIVE_USERS_5MIN]: 'Active users (5 min)',
    [K.ACTIVE_USERS_1H]: 'Active users (1 hour)',
    [K.ACTIVE_USERS_24H]: 'Active users (24 hours)',
    [K.USERS]: 'Users',
    [K.FILES]: 'Files',
    [K.SHARES]: 'Shares',
    [K.FREE_SPACE]: 'Free space',
    [K.DATABASE_SIZE]: 'Database size',
    [K.SYSTEM_LOAD]: 'System load',
    [K.MEMORY]: 'Memory used',
    [K.PHP_VERSION]: 'PHP version',
    [K.MEMORY_CACHE]: 'Memory cache',
  },
  fr: {
    [K.ONLINE]: 'En ligne',
    [K.VERSION]: 'Version de Nextcloud',
    [K.UPDATE_AVAILABLE]: 'Mise à jour de Nextcloud disponible',
    [K.APP_UPDATES]: "Mises à jour d'applications",
    [K.ACTIVE_USERS_5MIN]: 'Utilisateurs actifs (5 min)',
    [K.ACTIVE_USERS_1H]: 'Utilisateurs actifs (1 heure)',
    [K.ACTIVE_USERS_24H]: 'Utilisateurs actifs (24 heures)',
    [K.USERS]: 'Utilisateurs',
    [K.FILES]: 'Fichiers',
    [K.SHARES]: 'Partages',
    [K.FREE_SPACE]: 'Espace libre',
    [K.DATABASE_SIZE]: 'Taille de la base de données',
    [K.SYSTEM_LOAD]: 'Charge du système',
    [K.MEMORY]: 'Mémoire utilisée',
    [K.PHP_VERSION]: 'Version de PHP',
    [K.MEMORY_CACHE]: 'Cache mémoire',
  },
  de: {
    [K.ONLINE]: 'Online',
    [K.VERSION]: 'Nextcloud-Version',
    [K.UPDATE_AVAILABLE]: 'Nextcloud-Update verfügbar',
    [K.APP_UPDATES]: 'App-Updates',
    [K.ACTIVE_USERS_5MIN]: 'Aktive Benutzer (5 Min.)',
    [K.ACTIVE_USERS_1H]: 'Aktive Benutzer (1 Stunde)',
    [K.ACTIVE_USERS_24H]: 'Aktive Benutzer (24 Stunden)',
    [K.USERS]: 'Benutzer',
    [K.FILES]: 'Dateien',
    [K.SHARES]: 'Freigaben',
    [K.FREE_SPACE]: 'Freier Speicher',
    [K.DATABASE_SIZE]: 'Datenbankgröße',
    [K.SYSTEM_LOAD]: 'Systemlast',
    [K.MEMORY]: 'Belegter Arbeitsspeicher',
    [K.PHP_VERSION]: 'PHP-Version',
    [K.MEMORY_CACHE]: 'Speicher-Cache',
  },
  es: {
    [K.ONLINE]: 'En línea',
    [K.VERSION]: 'Versión de Nextcloud',
    [K.UPDATE_AVAILABLE]: 'Actualización de Nextcloud disponible',
    [K.APP_UPDATES]: 'Actualizaciones de aplicaciones',
    [K.ACTIVE_USERS_5MIN]: 'Usuarios activos (5 min)',
    [K.ACTIVE_USERS_1H]: 'Usuarios activos (1 hora)',
    [K.ACTIVE_USERS_24H]: 'Usuarios activos (24 horas)',
    [K.USERS]: 'Usuarios',
    [K.FILES]: 'Archivos',
    [K.SHARES]: 'Recursos compartidos',
    [K.FREE_SPACE]: 'Espacio libre',
    [K.DATABASE_SIZE]: 'Tamaño de la base de datos',
    [K.SYSTEM_LOAD]: 'Carga del sistema',
    [K.MEMORY]: 'Memoria usada',
    [K.PHP_VERSION]: 'Versión de PHP',
    [K.MEMORY_CACHE]: 'Caché de memoria',
  },
};

export const MODEL = 'Nextcloud';

const BYTES_PER_GB = 1e9;
const BYTES_PER_MB = 1e6;

// Display bounds (the core never applies them on write). Fixed: a bound that
// moves changes the device structure.
export const BOUNDS = Object.freeze({
  USERS_MAX: 1_000_000,
  FILES_MAX: 10_000_000_000,
  SHARES_MAX: 100_000_000,
  APPS_MAX: 1000,
  FREE_SPACE_MAX_GB: 1_000_000,
  DATABASE_MAX_MB: 10_000_000,
});

/** External ids of the device of a configuration slot. */
export const deviceIds = (gladys, slot) => gladys.externalIds(DEVICE_TYPE, `${slot}`);

/** The slot of a device external id, null when not ours. */
export function parseDeviceId(gladys, externalId) {
  if (typeof externalId !== 'string') {
    return null;
  }
  const prefix = gladys.externalIds(DEVICE_TYPE, '').device;
  if (!externalId.startsWith(prefix)) {
    return null;
  }
  const match = externalId.slice(prefix.length).match(/^(\d+)$/);
  return match ? Number(match[1]) : null;
}

const round = (value, digits) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const binaryOf = (value) => (value === null || value === undefined ? null : value ? 1 : 0);

// Feature shapes. `text`: a text/text feature, published as `{ text }`.
const percent = () => ({
  definition: {
    category: CATEGORY.LEVEL_SENSOR,
    type: TYPE.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
    unit: UNIT.PERCENT,
    min: 0,
    max: 100,
  },
  digits: 0,
});
const binary = () => ({
  definition: { category: CATEGORY.INPUT, type: TYPE.SENSOR.BINARY, min: 0, max: 1 },
  digits: 0,
});
const counter = (max) => ({
  definition: { category: CATEGORY.COUNTER_SENSOR, type: TYPE.SENSOR.INTEGER, min: 0, max },
  digits: 0,
});
const size = (unit, max, digits) => ({
  definition: { category: CATEGORY.DATA, type: TYPE.DATA.SIZE, unit, min: 0, max },
  digits,
});
// min/max are NOT NULL in Gladys, text features included.
const textFeature = () => ({
  definition: { category: CATEGORY.TEXT, type: TYPE.TEXT.TEXT, min: 0, max: 0 },
  text: true,
});

/**
 * The features of the device: their shape and their value, read from the
 * snapshot (src/nextcloud/model.js); `ctx` carries { online, language }.
 */
const FEATURES = [
  // Known without a read: offline is what failed reads say.
  { key: K.ONLINE, ...binary(), withoutItem: true, value: (_, ctx) => (ctx.online ? 1 : 0) },
  { key: K.VERSION, ...textFeature(), value: (s) => s.shortVersion },
  {
    key: K.UPDATE_AVAILABLE,
    ...binary(),
    optional: true,
    value: (s) => binaryOf(s.update ? s.update.available : null),
  },
  {
    key: K.APP_UPDATES,
    ...counter(BOUNDS.APPS_MAX),
    optional: true,
    value: (s) => (s.apps ? s.apps.updates.length : null),
  },
  {
    key: K.ACTIVE_USERS_5MIN,
    ...counter(BOUNDS.USERS_MAX),
    optional: true,
    value: (s) => s.activeUsers.last5minutes,
  },
  {
    key: K.ACTIVE_USERS_1H,
    ...counter(BOUNDS.USERS_MAX),
    optional: true,
    value: (s) => s.activeUsers.last1hour,
  },
  {
    key: K.ACTIVE_USERS_24H,
    ...counter(BOUNDS.USERS_MAX),
    optional: true,
    value: (s) => s.activeUsers.last24hours,
  },
  { key: K.USERS, ...counter(BOUNDS.USERS_MAX), optional: true, value: (s) => s.users },
  { key: K.FILES, ...counter(BOUNDS.FILES_MAX), optional: true, value: (s) => s.files },
  { key: K.SHARES, ...counter(BOUNDS.SHARES_MAX), optional: true, value: (s) => s.shares },
  {
    key: K.FREE_SPACE,
    ...size(UNIT.GIGABYTE, BOUNDS.FREE_SPACE_MAX_GB, 1),
    optional: true,
    value: (s) => (s.freeBytes === null ? null : s.freeBytes / BYTES_PER_GB),
  },
  {
    key: K.DATABASE_SIZE,
    ...size(UNIT.MEGABYTE, BOUNDS.DATABASE_MAX_MB, 1),
    optional: true,
    value: (s) => (s.databaseBytes === null ? null : s.databaseBytes / BYTES_PER_MB),
  },
  {
    key: K.SYSTEM_LOAD,
    ...percent(),
    optional: true,
    // Beyond 100 % the system is overloaded: shown as full.
    value: (s) => (s.loadPercent === null ? null : Math.min(100, s.loadPercent)),
  },
  { key: K.MEMORY, ...percent(), optional: true, value: (s) => s.memoryPercent },
  { key: K.PHP_VERSION, ...textFeature(), optional: true, value: (s) => s.phpVersion },
  {
    key: K.MEMORY_CACHE,
    ...textFeature(),
    value: (s, ctx) => cacheSummary(s) ?? pick(CACHE_NONE, ctx.language),
  },
];

/** The features with a value in this snapshot. */
export function valuedKeys(snapshot, ctx) {
  return FEATURES.filter((feature) => {
    const value = feature.value(snapshot, ctx);
    return value !== null && value !== undefined && value !== '';
  }).map((feature) => feature.key);
}

/** Whether a feature exists: always, or once it had a value (`seen`). */
const present = (feature, seen) => !feature.optional || seen.has(feature.key);

/**
 * The discovery payload of the device.
 * @param {object} gladys SDK client
 * @param {object} options
 * @param {number} options.slot configuration slot
 * @param {string} options.name device name
 * @param {Set<string>} options.seen the optional features this device ever had
 * @param {string} [options.language] feature names language
 * @param {Array<{name: string, value: string}>} [options.params]
 */
export function buildDevice(gladys, { slot, name, seen, language = 'en', params = [] }) {
  const ids = deviceIds(gladys, slot);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: name.slice(0, 255),
    external_id: ids.device,
    model: MODEL,
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    params: params.map((param) => ({ name: param.name, value: String(param.value).slice(0, 255) })),
    features: FEATURES.filter((feature) => present(feature, seen)).map((feature) => ({
      name: names[feature.key],
      external_id: ids.feature(feature.key),
      ...feature.definition,
      read_only: true,
      has_feedback: false,
      keep_history: !feature.text,
    })),
  };
}

/**
 * The value of every feature of the device (null: nothing to publish).
 * @param {object|null} snapshot null when nothing could be read
 * @returns {Array<{ key: string, externalId: string, value: number|string|null, text: boolean }>}
 */
export function featureValues(gladys, { slot, snapshot, ctx, seen }) {
  const ids = deviceIds(gladys, slot);
  return FEATURES.filter((feature) => present(feature, seen)).map((feature) => {
    const raw = snapshot === null && !feature.withoutItem ? null : feature.value(snapshot, ctx);
    return {
      key: feature.key,
      externalId: ids.feature(feature.key),
      value: feature.text
        ? typeof raw === 'string' && raw.trim()
          ? raw.trim().slice(0, 255)
          : null
        : round(raw, feature.digits),
      text: Boolean(feature.text),
    };
  });
}
