// -----------------------------------------------------------------------------
// Nextcloud client: the monitoring API of the serverinfo app, shipped and
// enabled with Nextcloud,
//   GET <nextcloud>/ocs/v2.php/apps/serverinfo/api/v1/info?format=json
// the endpoint the "System" page of the administration settings reads, and
// the one the Home Assistant integration polls. Read only: the integration
// never calls anything else.
//
// Authentication, checked by the app (ApiController::checkAuthorized):
//   - `NC-Token: <token>`, the token an administrator stores in the app
//     config (`occ config:app:set serverinfo token --value …`);
//   - otherwise Basic authentication of an account of the `admin` group,
//     ideally with an app password (Personal settings → Security).
// A refused request is throttled by Nextcloud's brute-force protection
// (`@BruteForceProtection(action=serverinfo)`): the hub reads less often
// after one (src/hub.js), and the request timeout leaves room for the delay
// Nextcloud adds to the requests of an address that failed before.
//
// `skipApps=false&skipUpdate=false` adds the installed apps with an update
// (read from the app store cache of Nextcloud, refreshed at most hourly by
// Nextcloud itself) and the result of the last update check of the server
// (the `updatenotification` background job): no extra load at each read.
//
// Answers, recorded on a real Nextcloud 32 (test/fixtures/nextcloud/real/):
//   - 200 `{ ocs: { meta, data: { nextcloud, server, activeUsers } } }`;
//   - 401 OCS 997 "Unauthorised": the login or password is wrong;
//   - 401 `data.message: "Unauthorized"`: the token is wrong, or the account
//     is not an administrator;
//   - 404 OCS 998: the serverinfo app is disabled;
//   - 503 OCS 503: maintenance mode (or an upgrade in progress);
//   - 429: the brute-force protection gave up on this address.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const INFO_PATH = '/ocs/v2.php/apps/serverinfo/api/v1/info';
export const INFO_QUERY = '?format=json&skipApps=false&skipUpdate=false';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: off, wrong address, firewall
  TLS: 'tls', // the certificate does not verify (self-signed without the option)
  AUTH: 'auth', // login, app password or token refused
  NOT_ADMIN: 'not_admin', // the account is valid but not an administrator
  THROTTLED: 'throttled', // the brute-force protection blocks this address (429)
  NO_SERVERINFO: 'no_serverinfo', // the serverinfo app is disabled (OCS 998)
  MAINTENANCE: 'maintenance', // maintenance mode or upgrade (503)
  SERVER_ERROR: 'server_error', // 5xx: PHP, database or reverse proxy down
  NOT_NEXTCLOUD: 'not_nextcloud', // something answers, not Nextcloud (wrong address or path)
  REDIRECT: 'redirect', // a redirect to another host
  HTTP: 'http', // any other HTTP answer
});

// The failures that mean the instance does not serve its users right now.
export const DOWN_KINDS = new Set([
  ERROR_KINDS.UNREACHABLE,
  ERROR_KINDS.MAINTENANCE,
  ERROR_KINDS.SERVER_ERROR,
]);

// The failures Nextcloud counts as a brute-force attempt, or answers because
// of them: reading again at the usual pace would only make it worse.
export const BACKOFF_KINDS = new Set([
  ERROR_KINDS.AUTH,
  ERROR_KINDS.NOT_ADMIN,
  ERROR_KINDS.THROTTLED,
]);

export class NextcloudError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'NextcloudError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const MAX_REDIRECTS = 3;

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** The host of a URL for the logs: never a path, never credentials. */
export function hostForLog(url) {
  try {
    return new URL(url).host;
  } catch {
    return '?';
  }
}

/** The parsed body when it is JSON, null otherwise. */
function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** The OCS status code of an answer (997, 998, 503…), null when not OCS. */
const ocsCode = (json) => {
  const code = json?.ocs?.meta?.statuscode;
  return Number.isInteger(code) ? code : null;
};

export class NextcloudClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL of Nextcloud, `http(s)://host[:port][/path]`
   * @param {{ kind: 'token', token: string } | { kind: 'basic', username: string, password: string }} options.auth
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, auth, insecure = false, request = httpRequest, timeoutMs = 30_000 }) {
    this.url = url;
    this.auth = auth;
    this.insecure = insecure;
    this.request = request;
    this.timeoutMs = timeoutMs;
    this.host = new URL(url).hostname;
  }

  headers() {
    const headers = {
      accept: 'application/json',
      'ocs-apirequest': 'true',
      'user-agent': 'gladys-nextcloud',
    };
    if (this.auth.kind === 'token') {
      headers['nc-token'] = this.auth.token;
    } else {
      const pair = `${this.auth.username}:${this.auth.password}`;
      headers.authorization = `Basic ${Buffer.from(pair, 'utf8').toString('base64')}`;
    }
    return headers;
  }

  /**
   * One request, following the redirects that stay on the same host (HTTP to
   * HTTPS, a reverse proxy adding a slash): the credentials go nowhere else.
   * @returns {Promise<{ status: number, headers: object, body: string }>}
   */
  async get(url) {
    let target = url;
    for (let hop = 0; ; hop += 1) {
      let response;
      try {
        response = await this.request(target, {
          method: 'GET',
          headers: this.headers(),
          insecure: this.insecure,
          timeoutMs: this.timeoutMs,
        });
      } catch (err) {
        throw this.networkError(err, target);
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return response;
      }
      const location = response.headers?.location;
      let next;
      try {
        next = location ? new URL(location, target) : null;
      } catch {
        next = null;
      }
      if (!next || next.hostname !== this.host || !['http:', 'https:'].includes(next.protocol)) {
        throw new NextcloudError(
          ERROR_KINDS.REDIRECT,
          `${hostForLog(target)} redirects to ${next ? hostForLog(next.href) : 'an unknown address'}`,
          { status: response.status, location: next ? next.origin : null },
        );
      }
      if (hop >= MAX_REDIRECTS) {
        throw new NextcloudError(
          ERROR_KINDS.REDIRECT,
          `${hostForLog(target)}: too many redirects`,
          {
            status: response.status,
          },
        );
      }
      // Never downgrade: an HTTPS address redirected to HTTP would send the
      // credentials in clear.
      if (new URL(target).protocol === 'https:' && next.protocol === 'http:') {
        throw new NextcloudError(
          ERROR_KINDS.REDIRECT,
          `${hostForLog(target)} redirects from HTTPS to HTTP`,
          { status: response.status, location: null },
        );
      }
      target = next.href;
    }
  }

  networkError(err, url) {
    const host = hostForLog(url);
    const code = err?.code ?? '';
    if (TLS_CODES.has(code)) {
      return new NextcloudError(ERROR_KINDS.TLS, `${host}: certificate refused (${code})`);
    }
    return new NextcloudError(
      ERROR_KINDS.UNREACHABLE,
      `${host}: ${code || err?.message || 'no answer'}`,
    );
  }

  /**
   * Read the serverinfo API.
   * @returns {Promise<object>} the `ocs.data` object (see src/nextcloud/model.js)
   * @throws {NextcloudError}
   */
  async info() {
    const response = await this.get(`${this.url}${INFO_PATH}${INFO_QUERY}`);
    const { status } = response;
    const json = parseJson(response.body);
    const code = ocsCode(json);
    const host = hostForLog(this.url);

    if (status >= 200 && status < 300) {
      const data = json?.ocs?.data;
      if (!data || typeof data !== 'object' || !data.nextcloud?.system) {
        throw new NextcloudError(
          ERROR_KINDS.NOT_NEXTCLOUD,
          `${host}: HTTP ${status}, not a serverinfo answer`,
          { status },
        );
      }
      return data;
    }
    if (status === 401) {
      // 997 comes from the core (login refused); the app itself answers a
      // plain 401 to a wrong token or to an account outside the admin group.
      if (code === 997 || this.auth.kind === 'token') {
        return this.fail(ERROR_KINDS.AUTH, `${host}: credentials refused (HTTP 401)`, status);
      }
      return this.fail(ERROR_KINDS.NOT_ADMIN, `${host}: not an administrator (HTTP 401)`, status);
    }
    if (status === 429) {
      return this.fail(
        ERROR_KINDS.THROTTLED,
        `${host}: too many failed attempts (HTTP 429)`,
        status,
      );
    }
    if (status === 404 && code === 998) {
      return this.fail(ERROR_KINDS.NO_SERVERINFO, `${host}: serverinfo app disabled`, status);
    }
    if (status === 503 && code === 503) {
      return this.fail(ERROR_KINDS.MAINTENANCE, `${host}: maintenance mode`, status);
    }
    if (status >= 500) {
      return this.fail(ERROR_KINDS.SERVER_ERROR, `${host}: HTTP ${status}`, status);
    }
    if (status === 404 || (status < 400 && !json)) {
      return this.fail(ERROR_KINDS.NOT_NEXTCLOUD, `${host}: HTTP ${status}, not Nextcloud`, status);
    }
    return this.fail(ERROR_KINDS.HTTP, `${host}: HTTP ${status}`, status);
  }

  fail(kind, message, status) {
    throw new NextcloudError(kind, message, { status });
  }
}
