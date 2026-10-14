// -----------------------------------------------------------------------------
// An in-memory Nextcloud behind the HTTP seam of the client
// (src/nextcloud/http.js): the serverinfo endpoint, answering what a real
// Nextcloud 32 answered (test/fixtures/nextcloud/real/), with its
// authentication rules (token, admin account, other account), the
// maintenance mode, the app disabled, and the network failures a home server
// shows (off, self-signed certificate, redirect to HTTPS, reverse proxy
// error, brute-force protection).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/nextcloud/${name}`, import.meta.url), 'utf8'));

export const TOKEN = 'fake-serverinfo-token-0a1b2c3d4e5f6a7b';
export const ADMIN = 'admin';
export const APP_PASSWORD = 'AbCdE-fGhIj-KlMnO-pQrSt-UvWxY';
export const USER = 'bob';
export const USER_PASSWORD = 'bob-app-password-zZyYxX';

export const HOST = '192.0.2.20';
const INFO_PATH = '/ocs/v2.php/apps/serverinfo/api/v1/info';

export class FakeNextcloud {
  /**
   * @param {object} [options]
   * @param {string} [options.fixture] the answer replayed (a file of test/fixtures/nextcloud)
   * @param {string} [options.basePath] the path Nextcloud is served under (`/nextcloud`)
   * @param {'http'|'https'|'redirect'} [options.scheme] HTTP only, HTTPS only (self-signed),
   *   or HTTP redirected to HTTPS
   */
  constructor({
    fixture: name = 'real/info-update-available.json',
    basePath = '',
    scheme = 'http',
  } = {}) {
    this.answer = fixture(name);
    this.basePath = basePath;
    this.scheme = scheme;
    /** `down`, `timeout`, `maintenance`, `disabled`, `html`, `bad-gateway`, `throttled`, `offsite` */
    this.failure = null;
    this.requests = [];
  }

  /** The `ocs.data` served, to change between reads. */
  get data() {
    return this.answer.ocs.data;
  }

  get system() {
    return this.data.nextcloud.system;
  }

  /** Offer an update of Nextcloud (null: up to date). */
  setUpdate(version) {
    this.system.update = version
      ? { lastupdatedat: 1792005240, available: true, available_version: version }
      : { lastupdatedat: 1792005240, available: false };
  }

  /** The apps with an update, `{ id: version }`. */
  setAppUpdates(updates) {
    const ids = Object.keys(updates);
    this.system.apps.num_updates_available = ids.length;
    // PHP serializes an empty array as [] and a filled one as an object.
    this.system.apps.app_updates = ids.length ? { ...updates } : [];
  }

  /** The seam of the client: `(url, options) => { status, headers, body }`. */
  request = async (url, options = {}) => {
    const target = new URL(url);
    this.requests.push({ url, headers: { ...options.headers } });
    if (target.hostname !== HOST && this.failure !== 'offsite') {
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${target.hostname}`), {
        code: 'ENOTFOUND',
      });
    }
    if (this.failure === 'down') {
      throw Object.assign(new Error(`connect ECONNREFUSED ${HOST}:80`), {
        code: 'ECONNREFUSED',
      });
    }
    if (this.failure === 'timeout') {
      throw Object.assign(new Error('Timed out after 30000 ms'), { code: 'ETIMEDOUT' });
    }
    if (target.protocol === 'https:' && this.scheme === 'http') {
      throw Object.assign(new Error('wrong version number'), {
        code: 'ERR_SSL_WRONG_VERSION_NUMBER',
      });
    }
    if (target.protocol === 'https:' && !options.insecure) {
      throw Object.assign(new Error('self-signed certificate'), {
        code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
      });
    }
    if (target.protocol === 'http:' && this.scheme === 'https') {
      throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    }
    if (target.protocol === 'http:' && this.scheme === 'redirect') {
      return redirect(`https://${HOST}${target.pathname}${target.search}`);
    }
    if (this.failure === 'offsite') {
      return redirect(`https://login.example.net${target.pathname}`);
    }
    if (this.failure === 'bad-gateway') {
      return html(502, '<html><body>502 Bad Gateway</body></html>');
    }
    if (this.failure === 'html') {
      return html(200, '<!DOCTYPE html><html><body>Welcome to nginx!</body></html>');
    }
    if (target.pathname !== `${this.basePath}${INFO_PATH}`) {
      return html(404, '<html><body>404 Not Found</body></html>');
    }
    if (this.failure === 'throttled') {
      return json(429, { message: 'Reached maximum delay' });
    }
    if (this.failure === 'maintenance') {
      return json(503, fixture('real/maintenance.json'));
    }
    const headers = lowerKeys(options.headers);
    const basic = parseBasic(headers.authorization);
    if (basic && !credentialsOk(basic)) {
      // The core refuses the login before the app runs.
      return json(401, fixture('real/unauthorised-login.json'));
    }
    if (this.failure === 'disabled') {
      return json(404, fixture('real/serverinfo-disabled.json'));
    }
    const tokenOk = headers['nc-token'] === TOKEN;
    const adminOk = basic?.user === ADMIN;
    if (!tokenOk && !adminOk) {
      return json(401, fixture('real/unauthorized-token.json'));
    }
    return json(200, structuredClone(this.answer));
  };

  /** The requests that reached the serverinfo endpoint. */
  get reads() {
    return this.requests.filter((r) => r.url.includes(INFO_PATH)).length;
  }
}

const lowerKeys = (headers = {}) =>
  Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));

function parseBasic(header) {
  const match = typeof header === 'string' ? header.match(/^Basic (.+)$/) : null;
  if (!match) {
    return null;
  }
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  return { user: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

const credentialsOk = ({ user, password }) =>
  (user === ADMIN && password === APP_PASSWORD) || (user === USER && password === USER_PASSWORD);

const json = (status, body) => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});

const html = (status, body) => ({
  status,
  headers: { 'content-type': 'text/html' },
  body,
});

const redirect = (location) => ({ status: 301, headers: { location }, body: '' });
