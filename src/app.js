// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys)
// and returns the hub, so index.js stays a few lines and the tests drive the
// very same wiring. (Adapted from guim31/gladys-unraid.)
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { NextcloudHub } from './hub.js';
import { Store } from './store.js';
import { INIT_FAILED } from './texts.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'nextcloud-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, request, timers, timings, now
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new NextcloudHub({
    gladys,
    store: options.store ?? new Store(),
    request: options.request,
    timers: options.timers ?? true,
    timings: options.timings,
    now: options.now,
  });

  // Resolved once the hub has started; every handler waits for it, so a
  // request arriving during the first read is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let startup = null;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (startup) {
        // A reconnection (Gladys restarted): send again what Gladys may have
        // lost, once the first start is over.
        await startup.catch(() => {});
        await hub.resync(config);
        return;
      }
      // Set before any await: two quick connections start the hub once.
      startup = hub.start(config);
      await startup;
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => hub.rediscover()));

  // The fallback of the container's own timer (src/hub.js): skipped while
  // the timer reads.
  gladys.onPoll(whenReady((device) => hub.pollFromCore(device)));

  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));
  // "Update" in the Discover tab may add features (free space, app
  // updates…): their values were dropped by Gladys until then.
  gladys.onDeviceUpdated(whenReady((device) => hub.onDeviceCreated(device)));
  gladys.onDeviceDeleted(whenReady(async (device) => hub.onDeviceDeleted(device)));

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      logger.info('Configuration updated');
      await hub.reconfigure(normalizeConfig(newConfig));
    }),
  );

  gladys.onAction(
    'test_connection',
    whenReady(() => {
      logger.info('Test the connection');
      return hub.testConnection();
    }),
  );

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady((actionKey, params, context = {}) => {
        logger.info(`Widget ${key}: ${actionKey}`);
        return widget.action(hub, { actionKey, params, ...context });
      }),
    );
  }

  return {
    hub,
    ready,
    stop: () => hub.stop(),
  };
}
