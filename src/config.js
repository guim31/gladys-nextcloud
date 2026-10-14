// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One Nextcloud instance. Its device is keyed on slot 1 (src/devices.js), so
// a second instance can be added later without changing any external id.
//
// Two ways in, the two of the serverinfo app:
//   - the serverinfo token (`NC-Token` header), set by the administrator with
//     `occ config:app:set serverinfo token --value …`: no account involved;
//   - an administrator account and an app password (Basic authentication),
//     created in Personal settings → Security. The main password works too
//     (without two-factor authentication), but is never recommended.
// When both are filled, the token wins: it cannot do anything else.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// The configuration slot of the instance: part of the device external id.
export const SLOT = 1;

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['60', '120', '300', '600', '900'];

export const DEFAULT_CONFIG = {
  url: '',
  token: '',
  username: '',
  app_password: '',
  name: '',
  allow_self_signed: false,
  poll_interval: '60',
  language: 'fr',
};

const MAX_NAME_LENGTH = 40;

// What follows the root of Nextcloud in an address copied from the browser:
// cut there, the rest is the path Nextcloud is served under (`/nextcloud`).
const NEXTCLOUD_PAGES =
  /\/(index\.php|ocs|remote\.php|status\.php|apps|settings|login|core|public\.php|s)(\/.*)?$/i;

/**
 * Parse the address typed by the user into the base URL of Nextcloud: a bare
 * host or IP (`192.0.2.10`, `cloud.local:8080`), a sub-path
 * (`https://example.org/nextcloud`), or the URL copied from the browser
 * (`https://cloud.example.org/index.php/apps/files/`). HTTP by default.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs and the device params.
  if (url.username || url.password) {
    return null;
  }
  const path = url.pathname.replace(NEXTCLOUD_PAGES, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme, no path). */
export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '?';
  }
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 * @returns {{
 *   server: {
 *     slot: number,
 *     url: string,
 *     name: string|null,
 *     auth: { kind: 'token', token: string } | { kind: 'basic', username: string, password: string },
 *   }|null,
 *   invalidUrl: boolean,
 *   missingAuth: boolean,
 *   allowSelfSigned: boolean,
 *   pollIntervalMs: number,
 *   language: string,
 * }}
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };

  const typed = text('url');
  const url = typed ? parseServerUrl(typed) : null;
  // Tokens and app passwords never contain spaces: the ones around come from
  // a copy. An app password is shown in groups (`xxxxx-xxxxx-…`): kept as is.
  const token = text('token');
  const username = text('username');
  const password = text('app_password');
  let auth = null;
  if (token) {
    auth = { kind: 'token', token };
  } else if (username && password) {
    auth = { kind: 'basic', username, password };
  }
  const server =
    url && auth
      ? { slot: SLOT, url, name: text('name').slice(0, MAX_NAME_LENGTH) || null, auth }
      : null;

  return {
    server,
    invalidUrl: Boolean(typed) && !url,
    missingAuth: Boolean(url) && !auth,
    allowSelfSigned: source.allow_self_signed === true || source.allow_self_signed === 'true',
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
