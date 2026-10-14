// -----------------------------------------------------------------------------
// The one function that talks to the network: an HTTP(S) request on
// node:http / node:https. Not on fetch: fetch cannot accept the self-signed
// certificate of one server only (a Nextcloud on a NAS often has one),
// node:https can, per request. Redirects are never followed here: the client
// (src/nextcloud/client.js) decides which ones it trusts, since the request
// carries the credentials.
//
// The client takes this function as a parameter: the tests replace it with an
// in-memory Nextcloud (test/helpers/fakeNextcloud.js).
// (Adapted from guim31/gladys-unraid.)
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';

// The serverinfo answer weighs a few kB (the PHP extensions list included).
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * @param {string} url absolute URL
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {Record<string, string>} [options.headers]
 * @param {string} [options.body]
 * @param {boolean} [options.insecure] accept a certificate that does not verify (HTTPS only)
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string }>}
 */
export function httpRequest(
  url,
  { method = 'GET', headers = {}, body, insecure = false, timeoutMs = 30_000 } = {},
) {
  const target = new URL(url);
  const isHttps = target.protocol === 'https:';
  const payload = body === undefined ? null : Buffer.from(body, 'utf8');

  return new Promise((resolve, reject) => {
    const request = (isHttps ? https : http).request(
      target,
      {
        method,
        headers: payload ? { ...headers, 'content-length': String(payload.length) } : headers,
        timeout: timeoutMs,
        ...(isHttps ? { rejectUnauthorized: !insecure } : {}),
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            const error = new Error('Response too large');
            error.code = 'ERESPONSETOOLARGE';
            request.destroy(error);
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('timeout', () => {
      const error = new Error(`Timed out after ${timeoutMs} ms`);
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    request.end(payload ?? undefined);
  });
}
