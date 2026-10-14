// -----------------------------------------------------------------------------
// The Nextcloud hub: the configured instance, read on a timer of the
// container (the interval chosen in the configuration); the states of the
// device published to Gladys when they change, the scene events fired when
// an update appears, and the views the widget and the "Test the connection"
// action read.
//
// Gladys cannot be trusted to poll (GladysAssistant/Gladys#3198: a device
// created without `should_poll` is never polled, and the 5.2.1 does not fix
// it), and the interval goes up to 15 minutes, beyond the fixed list of the
// core scheduler: the container reads Nextcloud itself. The device is still
// published with should_poll: true and one minute, and the core's onPoll
// reads only when the timer has not read for 90 % of an interval: a fallback
// if the timer ever stalls, never a second reader.
//
// Brute force: Nextcloud throttles the addresses whose requests it refuses
// (a wrong password, a wrong token, an account that is not an
// administrator), and Gladys may share its address with the other devices of
// the home behind a reverse proxy. After a refusal the hub reads again after
// 30 minutes only, or when the configuration changes, or when the user asks
// ("Test the connection", the widget's Refresh button).
//
// The 300 states per minute of Gladys: one device, only what changed
// (rounded), through the SDK's publishChangedStates; every value is sent
// again after 6 hours unchanged, before the core marks it outdated (48 hours).
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { buildDevice, deviceIds, featureValues, parseDeviceId, valuedKeys } from './devices.js';
import { createIssueLog } from './logs.js';
import { BACKOFF_KINDS, DOWN_KINDS, NextcloudClient, hostForLog } from './nextcloud/client.js';
import { parseInfo } from './nextcloud/model.js';
import {
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  formatBytes,
  formatNumber,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'nextcloud-hub' });

export const WIDGET_KEY = 'nextcloud';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  UPDATE: 'nextcloud_update_available',
  APP_UPDATES: 'app_updates_available',
});

export const HUB_TIMINGS = {
  // A read that fails once is tried again this soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Failures in a row before the instance counts as offline.
  downAfterFailures: 2,
  // After a refused login or token: the next read, unless the user asks.
  backoffMs: 30 * 60_000,
  // An unchanged value is sent again after this long.
  heartbeatMs: 6 * 3600_000,
  // The core's onPoll reads only past this share of the interval.
  corePollGap: 0.9,
};

// The variable of the app trigger holds at most this many characters.
const APPS_TEXT_MAX = 1000;

const signature = (server, config) =>
  JSON.stringify([server.url, server.auth, config.allowSelfSigned]);

export class NextcloudHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/nextcloud/http.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    /** The configured instance, null when none. */
    this.record = null;
    /** What /data keeps (src/store.js). */
    this.saved = { url: null, seen: [], announced: null };
    this.transport = null;
    this.connection = null;
    this.discovered = null;
    this.pollTimer = null;
    this.stopped = false;
    // Failures that repeat at every read: one line, then one when they heal.
    this.issues = createIssueLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      url: typeof saved.url === 'string' ? saved.url : null,
      seen: Array.isArray(saved.seen) ? saved.seen.filter((key) => typeof key === 'string') : [],
      announced: validAnnounced(saved.announced),
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates();
    this.transport = null;
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const languageChanged = this.config?.language !== config.language;
    this.config = config;
    const { server } = config;
    if (this.record && (!server || this.record.signature !== signature(server, config))) {
      this.dropRecord(this.record);
      this.record = null;
    }
    if (server && this.saved.url !== server.url) {
      // Another address may be another instance: what was announced for the
      // old one must not count for the new one (recorded again, silently).
      if (this.saved.url !== null) {
        this.saved.announced = null;
      }
      this.saved.url = server.url;
      this.saveState();
    }
    if (server && this.record) {
      this.record.server = server; // a new name only
    } else if (server) {
      this.record = this.newRecord(server, config);
    }
    if (languageChanged) {
      // The feature names and the cache text follow the language.
      this.discovered = null;
      this.gladys.forgetPublishedStates();
    }
    await this.pollAll({ publish: true });
    this.schedulePoll();
  }

  newRecord(server, config) {
    return {
      server,
      signature: signature(server, config),
      client: new NextcloudClient({
        url: server.url,
        auth: server.auth,
        insecure: config.allowSelfSigned,
        request: this.request,
      }),
      /** @type {object|null} the last snapshot read (src/nextcloud/model.js) */
      snapshot: null,
      readAt: 0,
      error: null,
      failures: 0,
      down: false,
      polling: null,
      retryTimer: null,
      widgetDigest: null,
      dropped: false,
    };
  }

  dropRecord(record) {
    record.dropped = true;
    clearTimeout(record.retryTimer);
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    if (this.record) {
      clearTimeout(this.record.retryTimer);
    }
    await this.store.flush();
  }

  /** The delay before the next read: the interval, or the back-off after a refusal. */
  nextDelay() {
    const kind = this.record?.error?.kind;
    return BACKOFF_KINDS.has(kind) ? this.timings.backoffMs : this.config.pollIntervalMs;
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.record) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.issues.ok('poll', 'Polling works again');
      } catch (err) {
        this.issues.fail('poll', 'error', 'Poll failed', err);
      }
      this.schedulePoll();
    }, this.nextDelay());
  }

  saveState() {
    this.store.save({
      url: this.saved.url,
      seen: [...new Set(this.saved.seen)].sort(),
      announced: this.saved.announced,
    });
  }

  // --- Names and identities ------------------------------------------------------

  /** The name of the device: the one configured, else "Nextcloud". */
  serverName(record = this.record) {
    return record?.server.name ?? 'Nextcloud';
  }

  deviceId() {
    return deviceIds(this.gladys, this.record?.server.slot ?? 1).device;
  }

  /** The device of the instance, when the user added it to Gladys. */
  createdDevice(slot) {
    return (
      (this.gladys.devices ?? []).find(
        (device) => parseDeviceId(this.gladys, device.external_id) === slot,
      ) ?? null
    );
  }

  context(record) {
    return {
      online: !record.down && record.error === null && record.snapshot !== null,
      language: this.config?.language ?? 'en',
    };
  }

  seen() {
    return new Set(this.saved.seen);
  }

  /** Remember the optional features the device has had a value for. */
  rememberFeatures(record) {
    const seen = this.seen();
    const before = seen.size;
    for (const key of valuedKeys(record.snapshot, this.context(record))) {
      seen.add(key);
    }
    if (seen.size !== before) {
      this.saved.seen = [...seen];
      return true;
    }
    return false;
  }

  // --- Devices -----------------------------------------------------------------

  discoveredDevices() {
    const record = this.record;
    if (!record) {
      return [];
    }
    return [
      buildDevice(this.gladys, {
        slot: record.server.slot,
        name: this.serverName(record),
        seen: this.seen(),
        language: this.config.language,
        params: [{ name: 'NEXTCLOUD_URL', value: record.server.url }],
      }),
    ];
  }

  /** Publish the Discovery list when it changed (a new feature, a new name…). */
  async publishDevices({ force = false } = {}) {
    // Never read: no structure to propose yet. Read once before (the
    // features seen are in /data), the device can be offered again while
    // Nextcloud is down (Gladys restarted meanwhile).
    if (this.record && !this.record.snapshot && this.saved.seen.length === 0) {
      return;
    }
    const devices = this.discoveredDevices();
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      // Even an empty list: the Discovery tab then shows no stale device.
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.issues.ok('discovery', 'Discovered device accepted again');
    } catch (err) {
      this.issues.fail('discovery', 'warn', `Discovered device refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the instance, publish the list again. */
  async rediscover() {
    await this.pollAll();
    await this.publishDevices({ force: true });
  }

  /** The user added (or updated) the device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const slot = parseDeviceId(this.gladys, device.external_id);
    const { record } = this;
    if (slot === null || !record || record.server.slot !== slot) {
      return;
    }
    // A device deleted then added again is a new row in Gladys: no badge yet.
    this.transport = null;
    // The SDK already forgot what it had published for this device.
    await this.publishRecordStates(record);
    await this.publishTransport();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** The user deleted the device: its badge is gone with it. */
  onDeviceDeleted(device) {
    if (parseDeviceId(this.gladys, device?.external_id) !== null) {
      this.transport = null;
    }
  }

  // --- Reading the instance ---------------------------------------------------------

  /**
   * Read the instance and publish what changed.
   * @param {object} [options]
   * @param {boolean} [options.publish] publish the Discovery list even unchanged
   */
  async pollAll({ publish = false } = {}) {
    const changed = this.record ? await this.poll(this.record) : false;
    await this.afterChanges(changed, { publish });
  }

  /**
   * Gladys polls the device (onPoll, the fallback): read only when the
   * container's timer has not read for most of an interval.
   */
  async pollFromCore(device) {
    const slot = parseDeviceId(this.gladys, device?.external_id);
    const { record } = this;
    if (slot === null || !record || record.server.slot !== slot) {
      logger.debug(`onPoll ignored for ${device?.external_id}`);
      return;
    }
    const gap = this.now() - record.readAt;
    if (gap < this.nextDelay() * this.timings.corePollGap) {
      logger.debug(`onPoll: read ${gap} ms ago, skipped`);
      return;
    }
    await this.afterChanges(await this.poll(record));
  }

  /**
   * Read the instance and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget should be refreshed now
   */
  poll(record) {
    record.polling ??= this.read(record).finally(() => {
      record.polling = null;
    });
    return record.polling;
  }

  async read(record) {
    record.readAt = this.now();
    try {
      return await this.applySuccess(record, await record.client.info());
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      return this.applyFailure(record, err);
    }
  }

  async applySuccess(record, data) {
    if (record.dropped) {
      return false;
    }
    const snapshot = parseInfo(data);
    const name = this.serverName(record);
    if (record.error) {
      logger.info(`${name} answers again`);
    }
    if (!record.snapshot || record.snapshot.version !== snapshot.version) {
      logger.info(
        `Connected to ${hostForLog(record.server.url)}: Nextcloud ${snapshot.version ?? '?'}`,
      );
    }
    clearTimeout(record.retryTimer);
    record.snapshot = snapshot;
    record.failures = 0;
    record.down = false;
    record.error = null;

    if (this.rememberFeatures(record)) {
      this.saveState();
    }
    await this.fireTransitions(record, snapshot);
    if (record.dropped) {
      // Reconfigured while the events were sent: the new record takes over.
      return false;
    }

    await this.publishRecordStates(record);
    const digest = JSON.stringify(this.widgetDigest(record));
    const widgetChanged = digest !== record.widgetDigest;
    record.widgetDigest = digest;
    return widgetChanged;
  }

  /** What the widget shows, coarsely: a change refreshes it at once. */
  widgetDigest(record) {
    const { snapshot } = record;
    if (!snapshot) {
      return [record.error?.kind ?? null];
    }
    return [
      record.error?.kind ?? null,
      snapshot.version,
      snapshot.update?.version ?? null,
      snapshot.apps?.updates.map((app) => app.id) ?? null,
      snapshot.activeUsers.last5minutes,
      snapshot.freeBytes === null ? null : Math.round(snapshot.freeBytes / 1e9),
    ];
  }

  /** Fire the scene events of what appeared since the last read. */
  async fireTransitions(record, snapshot) {
    const name = this.serverName(record);
    const current = {
      server: snapshot.update?.available ? (snapshot.update.version ?? null) : null,
      apps: Object.fromEntries(
        (snapshot.apps?.updates ?? []).map((app) => [app.id, app.version ?? '?']),
      ),
    };
    const previous = this.saved.announced;
    if (!previous) {
      // First read of this instance: record what is already there, silently.
      this.saved.announced = current;
      this.saveState();
      return;
    }
    let changed = false;

    if (current.server && current.server !== previous.server) {
      logger.debug(`${name}: Nextcloud ${snapshot.update.shortVersion} available`);
      previous.server = current.server;
      changed = true;
      await this.fireEvent(TRIGGERS.UPDATE, {
        server_name: name,
        installed_version: snapshot.shortVersion,
        new_version: snapshot.update.shortVersion,
      });
    }

    // Kept, never dropped: an app store that fails once on the Nextcloud side
    // empties the list, and must not announce every app again afterwards.
    const fresh = Object.entries(current.apps).filter(
      ([id, version]) => previous.apps[id] !== version,
    );
    if (fresh.length > 0) {
      for (const [id, version] of fresh) {
        previous.apps[id] = version;
      }
      changed = true;
      logger.debug(`${name}: ${fresh.length} new app update(s)`);
      const listed = fresh.map(([id, version]) => `${id} ${version}`).join(', ');
      await this.fireEvent(TRIGGERS.APP_UPDATES, {
        server_name: name,
        count: fresh.length,
        total: Object.keys(current.apps).length,
        apps: listed.length > APPS_TEXT_MAX ? `${listed.slice(0, APPS_TEXT_MAX - 1)}…` : listed,
      });
    }
    if (changed) {
      this.saveState();
    }
  }

  async applyFailure(record, err) {
    if (record.dropped) {
      return false;
    }
    const wasError = record.error?.kind;
    record.error = { kind: err.kind, message: err.message };
    if (wasError !== err.kind) {
      logger.warn(`${this.serverName(record)}: ${err.message}`);
    } else {
      // The same failure at every read: logged once, "answers again" when it heals.
      logger.debug(`${this.serverName(record)}: ${err.message}`);
    }
    // Only silence counts as offline: a refused password is a configuration
    // problem, reported by the connection status.
    if (!DOWN_KINDS.has(err.kind)) {
      record.failures = 0;
      return wasError !== err.kind;
    }
    record.failures += 1;
    if (record.failures === 1) {
      this.scheduleRetry(record);
    }
    if (!record.down && record.failures >= this.timings.downAfterFailures) {
      record.down = true;
      await this.publishRecordStates(record);
      return true;
    }
    if (record.down) {
      // Offline again after a resync or past the heartbeat (deduplicated).
      await this.publishRecordStates(record);
    }
    return wasError !== err.kind;
  }

  scheduleRetry(record) {
    clearTimeout(record.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    record.retryTimer = setTimeout(() => {
      this.poll(record)
        .then((changed) => this.afterChanges(changed))
        .then(() => this.issues.ok('retry', 'Retry works again'))
        .catch((err) => this.issues.fail('retry', 'error', 'Retry failed', err));
    }, this.timings.retryMs);
    record.retryTimer.unref?.();
  }

  async fireEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.issues.ok('scene', 'Scene events accepted again');
    } catch (err) {
      this.issues.fail('scene', 'warn', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  /** The states of the device, when the user added it. */
  async publishRecordStates(record) {
    const { slot } = record.server;
    if (!this.createdDevice(slot)) {
      return;
    }
    const ctx = this.context(record);
    const seen = this.seen();
    let values;
    if (record.error) {
      // Nothing read: only say the instance is offline once it is.
      if (!record.down) {
        return;
      }
      values = featureValues(this.gladys, { slot, snapshot: null, ctx, seen });
    } else if (record.snapshot) {
      values = featureValues(this.gladys, { slot, snapshot: record.snapshot, ctx, seen });
    } else {
      return;
    }
    const states = values
      .filter((entry) => entry.value !== null)
      .map(({ externalId, value, text }) =>
        text
          ? { device_feature_external_id: externalId, text: value }
          : { device_feature_external_id: externalId, state: value },
      );
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.issues.ok('states', 'States accepted again');
    } catch (err) {
      this.issues.fail('states', 'warn', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransport();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the device: "local", or "unreachable" with the instance. */
  async publishTransport() {
    const { record } = this;
    if (!record || record.readAt === 0) {
      return;
    }
    const device = this.createdDevice(record.server.slot);
    if (!device) {
      return;
    }
    const transport =
      record.error === null ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
    if (this.transport === transport) {
      return;
    }
    try {
      await this.gladys.publishTransports([{ external_id: device.external_id, transport }]);
      this.transport = transport;
      this.issues.ok('transports', 'Transport accepted again');
    } catch (err) {
      this.issues.fail('transports', 'warn', `Transport refused: ${err.message}`);
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    const config = this.config;
    if (!config || !config.server) {
      return {
        connected: false,
        message: config?.invalidUrl
          ? CONNECTION_TEXT.invalidUrl
          : config?.missingAuth
            ? CONNECTION_TEXT.missingAuth
            : CONNECTION_TEXT.noServer,
      };
    }
    const { record } = this;
    if (!record?.error) {
      return { connected: true };
    }
    return { connected: false, message: this.errorText(record) };
  }

  /** "Name: why it cannot be read", in the four languages. */
  errorText(record = this.record) {
    const message = {};
    for (const language of Object.keys(CONNECTION_TEXT.noServer)) {
      message[language] = labelled(
        this.serverName(record),
        pick(ERROR_TEXT[record.error.kind], language),
        language,
      ).slice(0, 200);
    }
    return message;
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.issues.ok('connection', 'Connection status accepted again');
    } catch (err) {
      this.issues.fail('connection', 'warn', `Connection status refused: ${err.message}`);
    }
  }

  // --- Reports -------------------------------------------------------------------------

  /** "Test the connection": read the instance now, one line. */
  async testConnection() {
    await this.pollAll({ publish: true });
    this.schedulePoll(); // a refusal fixed on the Nextcloud side: back to the usual pace
    const { record } = this;
    if (!record || record.error) {
      return this.connectionStatus().message;
    }
    const { snapshot } = record;
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      const parts = [text.ok(snapshot.shortVersion ?? '?')];
      if (snapshot.update) {
        parts.push(
          snapshot.update.available
            ? text.update(snapshot.update.shortVersion ?? '?')
            : text.upToDate,
        );
      }
      if (snapshot.apps?.updates.length) {
        parts.push(text.apps(snapshot.apps.updates.length));
      }
      if (snapshot.users !== null) {
        parts.push(text.users(formatNumber(snapshot.users, language)));
      }
      if (snapshot.files !== null) {
        parts.push(text.files(formatNumber(snapshot.files, language)));
      }
      if (snapshot.freeBytes !== null) {
        parts.push(text.free(formatBytes(snapshot.freeBytes, language).text));
      }
      parts.push(
        record.server.auth.kind === 'token'
          ? text.token
          : text.account(record.server.auth.username.slice(0, 40)),
      );
      message[language] = parts.join(', ').slice(0, 200);
    }
    return message;
  }
}

/** The announced versions kept in /data, null when absent or damaged. */
function validAnnounced(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const apps = value.apps && typeof value.apps === 'object' && !Array.isArray(value.apps);
  return {
    server: typeof value.server === 'string' ? value.server : null,
    apps: apps
      ? Object.fromEntries(Object.entries(value.apps).filter(([, v]) => typeof v === 'string'))
      : {},
  };
}
