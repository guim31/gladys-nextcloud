// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `nextcloud`.
//
// The use case: a glance at the family cloud from the wall tablet, "is
// everything fine?": the space left, who uses it right now, and the updates
// waiting (Nextcloud itself and its apps), then the details an administrator
// checks (users, files, shares, database, load, memory, PHP, memory cache).
//
// Budget (8 components, 2 texts, 6 tiles, 1 status, 4 buttons): a heading
// (name and version), three tiles (free space, active users, updates), one
// status list (up to 10 rows, what needs attention first) and up to two
// buttons (Refresh, and Open Nextcloud on an HTTPS address: the core only
// opens https links). The figures are sent as values, not bound to device
// features, so the widget works before the device is added to Gladys.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import { cacheSummary, pendingUpdates } from './nextcloud/model.js';
import { CACHE_NONE, DONE_TEXT, formatBytes, formatNumber, pick } from './texts.js';

// Action keys of the buttons: permanent once published (unique, the core
// drops a button whose key is taken).
export const ACTIONS = Object.freeze({
  REFRESH: 'refresh',
});

const MAX_ROWS = 10;
// Above these, the row turns orange.
export const BUSY_PERCENT = 80;

export const TEXT = {
  pick: {
    en: 'Enter the address of your Nextcloud and a serverinfo token or an app password in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre Nextcloud et un jeton serverinfo ou un mot de passe d'application dans la configuration de l'intégration.",
    de: 'Gib die Adresse deiner Nextcloud und ein serverinfo-Token oder ein App-Passwort in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su Nextcloud y un token de serverinfo o una contraseña de aplicación en la configuración de la integración.',
  },
  waiting: {
    en: 'Reading Nextcloud…',
    fr: 'Lecture de Nextcloud…',
    de: 'Nextcloud wird gelesen …',
    es: 'Leyendo Nextcloud…',
  },
  free: { en: 'Free space', fr: 'Espace libre', de: 'Frei', es: 'Espacio libre' },
  active: {
    en: 'Active (5 min)',
    fr: 'Actifs (5 min)',
    de: 'Aktiv (5 Min.)',
    es: 'Activos (5 min)',
  },
  updates: { en: 'Updates', fr: 'Mises à jour', de: 'Updates', es: 'Actualizaciones' },
  nextcloud: { en: 'Nextcloud', fr: 'Nextcloud', de: 'Nextcloud', es: 'Nextcloud' },
  apps: { en: 'Apps', fr: 'Applications', de: 'Apps', es: 'Aplicaciones' },
  upToDate: { en: 'Up to date', fr: 'À jour', de: 'Aktuell', es: 'Actualizado' },
  activeHourDay: {
    en: 'Active (1 h / 24 h)',
    fr: 'Actifs (1 h / 24 h)',
    de: 'Aktiv (1 Std. / 24 Std.)',
    es: 'Activos (1 h / 24 h)',
  },
  users: { en: 'Users', fr: 'Utilisateurs', de: 'Benutzer', es: 'Usuarios' },
  files: { en: 'Files', fr: 'Fichiers', de: 'Dateien', es: 'Archivos' },
  shares: { en: 'Shares', fr: 'Partages', de: 'Freigaben', es: 'Compartidos' },
  database: { en: 'Database', fr: 'Base de données', de: 'Datenbank', es: 'Base de datos' },
  load: { en: 'System load', fr: 'Charge du système', de: 'Systemlast', es: 'Carga del sistema' },
  memory: { en: 'Memory used', fr: 'Mémoire utilisée', de: 'Arbeitsspeicher', es: 'Memoria usada' },
  php: { en: 'PHP', fr: 'PHP', de: 'PHP', es: 'PHP' },
  cache: { en: 'Memory cache', fr: 'Cache mémoire', de: 'Speicher-Cache', es: 'Caché de memoria' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  open: {
    en: 'Open Nextcloud',
    fr: 'Ouvrir Nextcloud',
    de: 'Nextcloud öffnen',
    es: 'Abrir Nextcloud',
  },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const count = (value, language) => (value === null ? '—' : formatNumber(value, language));

function message(text, language) {
  return {
    ttl_seconds: 60,
    components: [{ type: 'text', variant: 'body', text: fit(t(text, language), 300) }],
  };
}

const refreshButton = (language) => ({
  type: 'button',
  label: t(TEXT.refresh, language),
  icon: 'refresh-cw',
  style: 'secondary',
  action: { key: ACTIONS.REFRESH },
});

/** The link to the administration overview, on an HTTPS address only. */
function openButton(url, language) {
  if (!url.startsWith('https://')) {
    return null;
  }
  return {
    type: 'button',
    label: t(TEXT.open, language),
    icon: 'external-link',
    style: 'secondary',
    link: { url: `${url}/index.php/settings/admin/overview` },
  };
}

/** The status rows: what needs attention first, then the details. */
export function rows(snapshot, language) {
  const attention = [];
  const details = [];
  const { update, apps } = snapshot;

  const versionRow = {
    label: t(TEXT.nextcloud, language),
    icon: 'cloud',
    value: fit(
      update?.available
        ? `${snapshot.shortVersion ?? '?'} → ${update.shortVersion ?? '?'}`
        : (snapshot.shortVersion ?? '?'),
      40,
    ),
    color: update?.available
      ? WIDGET_COLORS.WARNING
      : update
        ? WIDGET_COLORS.SUCCESS
        : WIDGET_COLORS.NEUTRAL,
  };
  (update?.available ? attention : details).push(versionRow);

  if (apps) {
    const names = apps.updates.map((app) => app.id).join(', ');
    (apps.updates.length ? attention : details).push({
      label: t(TEXT.apps, language),
      icon: 'package',
      value: apps.updates.length ? fit(names, 40) : t(TEXT.upToDate, language),
      color: apps.updates.length ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    });
  }

  const busy = (value) => value !== null && value >= BUSY_PERCENT;
  for (const [value, label, icon] of [
    [snapshot.loadPercent, TEXT.load, 'cpu'],
    [snapshot.memoryPercent, TEXT.memory, 'layers'],
  ]) {
    if (value === null) {
      continue;
    }
    (busy(value) ? attention : details).push({
      label: t(label, language),
      icon,
      value: `${formatNumber(Math.round(value), language)} %`,
      color: busy(value) ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
  }

  const cache = cacheSummary(snapshot);
  const cacheRow = {
    label: t(TEXT.cache, language),
    icon: 'zap',
    value: fit(cache ?? t(CACHE_NONE, language), 40),
    // Nextcloud's own setup checks warn when no memory cache is configured.
    color: cache ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
  };

  const { last1hour, last24hours } = snapshot.activeUsers;
  if (last1hour !== null || last24hours !== null) {
    details.push({
      label: t(TEXT.activeHourDay, language),
      icon: 'activity',
      value: `${count(last1hour, language)} / ${count(last24hours, language)}`,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  for (const [value, label, icon] of [
    [snapshot.users, TEXT.users, 'users'],
    [snapshot.files, TEXT.files, 'file'],
    [snapshot.shares, TEXT.shares, 'share-2'],
  ]) {
    if (value !== null) {
      details.push({
        label: t(label, language),
        icon,
        value: formatNumber(value, language),
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
  }
  if (snapshot.databaseBytes !== null) {
    const size = formatBytes(snapshot.databaseBytes, language).text;
    details.push({
      label: t(TEXT.database, language),
      icon: 'database',
      value: fit(snapshot.databaseType ? `${size} (${snapshot.databaseType})` : size, 40),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  (cache ? details : attention).push(cacheRow);
  if (snapshot.phpVersion) {
    details.push({
      label: t(TEXT.php, language),
      icon: 'code',
      value: fit(snapshot.phpVersion, 40),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  return [...attention, ...details].slice(0, MAX_ROWS);
}

async function get(hub, { language = 'en' } = {}) {
  const { record } = hub;
  if (!record) {
    return message(TEXT.pick, language);
  }
  if (record.error) {
    return {
      ttl_seconds: 60,
      components: [
        { type: 'text', variant: 'body', text: fit(pick(hub.errorText(record), language), 300) },
        refreshButton(language),
      ],
    };
  }
  if (!record.snapshot) {
    return message(TEXT.waiting, language);
  }
  const { snapshot } = record;
  const name = hub.serverName();
  const heading = snapshot.shortVersion
    ? name === 'Nextcloud'
      ? `Nextcloud ${snapshot.shortVersion}`
      : `${name} · Nextcloud ${snapshot.shortVersion}`
    : name;
  const free = snapshot.freeBytes === null ? null : formatBytes(snapshot.freeBytes, language);
  const pending = pendingUpdates(snapshot);
  const known = snapshot.update !== null || snapshot.apps !== null;
  const components = [
    { type: 'text', variant: 'heading', text: fit(heading, 40) },
    {
      type: 'value',
      value: free ? free.value : '—',
      ...(free ? { unit: free.unit } : {}),
      label: t(TEXT.free, language),
      icon: 'hard-drive',
    },
    {
      type: 'value',
      value: snapshot.activeUsers.last5minutes ?? '—',
      label: t(TEXT.active, language),
      icon: 'users',
    },
    {
      type: 'value',
      value: known ? pending : '—',
      label: t(TEXT.updates, language),
      icon: 'download',
      color: pending > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    },
    { type: 'status', items: rows(snapshot, language) },
    refreshButton(language),
  ];
  const open = openButton(record.server.url, language);
  if (open) {
    components.push(open);
  }
  return { ttl_seconds: 60, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.pollAll();
  hub.schedulePoll();
  return {
    message: Object.fromEntries(
      Object.entries(DONE_TEXT).map(([language, text]) => [language, text.refreshed]),
    ),
  };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
