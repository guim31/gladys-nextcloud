// -----------------------------------------------------------------------------
// The serverinfo answer (`ocs.data`) turned into the snapshot the rest of the
// integration reads. Every field may be missing (an older serverinfo, a
// system that does not tell): it is then null, never a guess.
//
// Units, as the app computes them (apps/serverinfo/lib):
//   - `freespace`: bytes free in the data directory, null when unknown;
//   - `mem_total`, `mem_free`: kibibytes (`MemTotal`, `MemAvailable` of
//     /proc/meminfo), 0 when the system does not tell (not Linux);
//   - `cpuload`: the 1, 5 and 15 minute load averages, `cpunum` the threads;
//   - `database.size`: a string of bytes, or "N/A";
//   - `storage.num_files`: a count refreshed by a background job of the app
//     (every 3 hours by default), not live.
// -----------------------------------------------------------------------------

/** A finite number from a number or a numeric string, null otherwise. */
export function numberOf(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) {
    return Number(value);
  }
  return null;
}

/** A count: a finite number, zero or more. */
const countOf = (value) => {
  const number = numberOf(value);
  return number === null || number < 0 ? null : Math.round(number);
};

const textOf = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** "32.0.9.2" → "32.0.9": the fourth number is internal to Nextcloud. */
export function shortVersion(version) {
  const text = textOf(version);
  if (!text) {
    return null;
  }
  const match = text.match(/^(\d+\.\d+\.\d+)(\.\d+)?$/);
  return match ? match[1] : text.slice(0, 40);
}

/** The short name of a memory cache class: `\OC\Memcache\APCu` → `APCu`. */
export function cacheName(value) {
  const text = textOf(value);
  if (!text || text.toLowerCase() === 'none') {
    return null;
  }
  return text.split('\\').filter(Boolean).pop().slice(0, 30);
}

/** The apps with an update: `{ calendar: "5.0.1" }` (an empty PHP array is `[]`). */
function appUpdates(apps) {
  if (!apps || typeof apps !== 'object') {
    return null;
  }
  const list = apps.app_updates;
  if (Array.isArray(list)) {
    // An empty list, or a list of names (never seen, accepted).
    return list.filter((id) => typeof id === 'string').map((id) => ({ id, version: null }));
  }
  if (!list || typeof list !== 'object') {
    return [];
  }
  return Object.entries(list)
    .filter(([id]) => /^[A-Za-z0-9_.-]{1,64}$/.test(id))
    .map(([id, version]) => ({ id, version: textOf(String(version ?? '')) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * @param {object} data the `ocs.data` of a serverinfo answer
 * @returns {object} the snapshot
 */
export function parseInfo(data) {
  const system = data?.nextcloud?.system ?? {};
  const storage = data?.nextcloud?.storage ?? {};
  const shares = data?.nextcloud?.shares ?? {};
  const server = data?.server ?? {};
  const active = data?.activeUsers ?? {};

  const update = system.update && typeof system.update === 'object' ? system.update : null;
  const updates = appUpdates(system.apps);
  const appsAnswered = Boolean(system.apps && typeof system.apps === 'object');

  const load = Array.isArray(system.cpuload) ? system.cpuload.map(numberOf) : [];
  const threads = countOf(system.cpunum);
  const load1 = load[0] ?? null;
  // The 1-minute load average per thread: 100 % when every thread is busy
  // (or waiting for the disk), more under overload.
  const loadPercent = load1 !== null && threads ? (load1 / threads) * 100 : null;

  const memTotal = numberOf(system.mem_total);
  const memFree = numberOf(system.mem_free);
  const memoryPercent =
    memTotal && memTotal > 0 && memFree !== null
      ? Math.min(100, Math.max(0, ((memTotal - memFree) / memTotal) * 100))
      : null;

  const caches = [
    cacheName(system['memcache.local']),
    cacheName(system['memcache.distributed']),
    cacheName(system['memcache.locking']),
  ];

  const database = server.database && typeof server.database === 'object' ? server.database : {};
  const php = server.php && typeof server.php === 'object' ? server.php : {};

  return {
    version: textOf(system.version),
    shortVersion: shortVersion(system.version),
    update: update
      ? {
          available: update.available === true,
          version: update.available === true ? textOf(update.available_version) : null,
          shortVersion: update.available === true ? shortVersion(update.available_version) : null,
        }
      : null,
    apps: appsAnswered
      ? { installed: countOf(system.apps.num_installed), updates: updates ?? [] }
      : null,
    activeUsers: {
      last5minutes: countOf(active.last5minutes),
      last1hour: countOf(active.last1hour),
      last24hours: countOf(active.last24hours),
    },
    users: countOf(storage.num_users),
    files: countOf(storage.num_files),
    shares: countOf(shares.num_shares),
    freeBytes: (() => {
      const free = numberOf(system.freespace);
      return free === null || free < 0 ? null : free;
    })(),
    databaseBytes: (() => {
      const size = numberOf(database.size);
      return size === null || size < 0 ? null : size;
    })(),
    databaseType: textOf(database.type),
    loadAverage: load1,
    threads,
    loadPercent,
    memoryPercent,
    phpVersion: textOf(php.version),
    cache: { local: caches[0], distributed: caches[1], locking: caches[2] },
  };
}

/** The cache names in use, once each ("APCu", "APCu + Redis"), null when none. */
export function cacheSummary(snapshot) {
  const names = [...new Set(Object.values(snapshot.cache).filter(Boolean))];
  return names.length ? names.join(' + ') : null;
}

/** The number of updates waiting: Nextcloud itself and its apps. */
export function pendingUpdates(snapshot) {
  const server = snapshot.update?.available ? 1 : 0;
  return server + (snapshot.apps?.updates.length ?? 0);
}
