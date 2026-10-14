// -----------------------------------------------------------------------------
// The client against the fake Nextcloud, which answers what a real
// Nextcloud 32 answered (test/fixtures/nextcloud/real/): the two ways to
// authenticate, every refusal, and the network failures of a home server.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, NextcloudClient } from '../src/nextcloud/client.js';
import {
  ADMIN,
  APP_PASSWORD,
  FakeNextcloud,
  HOST,
  TOKEN,
  USER,
  USER_PASSWORD,
} from './helpers/fakeNextcloud.js';

const tokenAuth = { kind: 'token', token: TOKEN };
const adminAuth = { kind: 'basic', username: ADMIN, password: APP_PASSWORD };

function client(nextcloud, options = {}) {
  return new NextcloudClient({
    url: `http://${HOST}`,
    auth: tokenAuth,
    request: nextcloud.request,
    ...options,
  });
}

/** The kind of the error `promise` rejects with. */
async function kindOf(promise) {
  try {
    await promise;
  } catch (err) {
    for (const secret of [TOKEN, APP_PASSWORD, USER_PASSWORD]) {
      assert.ok(!err.message.includes(secret), `the error message holds a secret: ${err.message}`);
    }
    return err.kind;
  }
  return 'resolved';
}

test('reads serverinfo with the token, apps and update check included', async () => {
  const nextcloud = new FakeNextcloud();
  const data = await client(nextcloud).info();
  assert.equal(data.nextcloud.system.version, '32.0.9.2');
  const [request] = nextcloud.requests;
  assert.equal(
    request.url,
    `http://${HOST}/ocs/v2.php/apps/serverinfo/api/v1/info?format=json&skipApps=false&skipUpdate=false`,
  );
  assert.equal(request.headers['nc-token'], TOKEN);
  assert.equal(request.headers.authorization, undefined);
  assert.equal(request.headers['ocs-apirequest'], 'true');
  assert.equal(request.headers.accept, 'application/json');
});

test('reads serverinfo with an administrator account and its app password', async () => {
  const nextcloud = new FakeNextcloud();
  await client(nextcloud, { auth: adminAuth }).info();
  const [request] = nextcloud.requests;
  assert.equal(request.headers['nc-token'], undefined);
  const decoded = Buffer.from(request.headers.authorization.slice(6), 'base64').toString();
  assert.equal(decoded, `${ADMIN}:${APP_PASSWORD}`);
});

test('a Nextcloud under a sub-path', async () => {
  const nextcloud = new FakeNextcloud({ basePath: '/nextcloud' });
  const data = await client(nextcloud, { url: `http://${HOST}/nextcloud` }).info();
  assert.ok(data.activeUsers);
  // Without the path, the address is not a Nextcloud.
  assert.equal(await kindOf(client(nextcloud).info()), ERROR_KINDS.NOT_NEXTCLOUD);
});

test('every refusal of Nextcloud has its kind', async () => {
  const nextcloud = new FakeNextcloud();
  const wrongToken = { kind: 'token', token: 'not-the-token' };
  const wrongPassword = { kind: 'basic', username: ADMIN, password: 'wrong' };
  const notAdmin = { kind: 'basic', username: USER, password: USER_PASSWORD };
  assert.equal(await kindOf(client(nextcloud, { auth: wrongToken }).info()), ERROR_KINDS.AUTH);
  assert.equal(await kindOf(client(nextcloud, { auth: wrongPassword }).info()), ERROR_KINDS.AUTH);
  assert.equal(await kindOf(client(nextcloud, { auth: notAdmin }).info()), ERROR_KINDS.NOT_ADMIN);

  const cases = [
    ['disabled', ERROR_KINDS.NO_SERVERINFO],
    ['maintenance', ERROR_KINDS.MAINTENANCE],
    ['throttled', ERROR_KINDS.THROTTLED],
    ['bad-gateway', ERROR_KINDS.SERVER_ERROR],
    ['html', ERROR_KINDS.NOT_NEXTCLOUD],
    ['down', ERROR_KINDS.UNREACHABLE],
    ['timeout', ERROR_KINDS.UNREACHABLE],
  ];
  for (const [failure, kind] of cases) {
    nextcloud.failure = failure;
    assert.equal(await kindOf(client(nextcloud).info()), kind, failure);
  }
});

test('a self-signed certificate is refused unless accepted', async () => {
  const nextcloud = new FakeNextcloud({ scheme: 'https' });
  const url = `https://${HOST}`;
  assert.equal(await kindOf(client(nextcloud, { url }).info()), ERROR_KINDS.TLS);
  const data = await client(nextcloud, { url, insecure: true }).info();
  assert.ok(data.nextcloud);
  // HTTP on an HTTPS-only server.
  assert.equal(await kindOf(client(nextcloud).info()), ERROR_KINDS.UNREACHABLE);
});

test('HTTP redirected to HTTPS on the same host is followed', async () => {
  const nextcloud = new FakeNextcloud({ scheme: 'redirect' });
  const data = await client(nextcloud, { insecure: true }).info();
  assert.ok(data.nextcloud);
  assert.deepEqual(
    nextcloud.requests.map((r) => new URL(r.url).protocol),
    ['http:', 'https:'],
  );
});

test('a redirect to another host is never followed: the credentials stay home', async () => {
  const nextcloud = new FakeNextcloud();
  nextcloud.failure = 'offsite';
  assert.equal(await kindOf(client(nextcloud).info()), ERROR_KINDS.REDIRECT);
  assert.ok(nextcloud.requests.every((r) => new URL(r.url).hostname === HOST));
});

test('an HTTPS address redirected to HTTP is refused', async () => {
  const request = async (url) =>
    url.startsWith('https:')
      ? { status: 302, headers: { location: `http://${HOST}/` }, body: '' }
      : { status: 200, headers: {}, body: '{}' };
  const https = new NextcloudClient({ url: `https://${HOST}`, auth: tokenAuth, request });
  assert.equal(await kindOf(https.info()), ERROR_KINDS.REDIRECT);
});

test('a redirect loop on the same host stops', async () => {
  let hops = 0;
  const request = async () => {
    hops += 1;
    return { status: 302, headers: { location: `http://${HOST}/again` }, body: '' };
  };
  const loop = new NextcloudClient({ url: `http://${HOST}`, auth: tokenAuth, request });
  assert.equal(await kindOf(loop.info()), ERROR_KINDS.REDIRECT);
  assert.equal(hops, 4);
});

test('a 200 that is not a serverinfo answer, and other statuses', async () => {
  const answer = (status, body) => async () => ({ status, headers: {}, body });
  const make = (request) =>
    new NextcloudClient({ url: `http://${HOST}`, auth: tokenAuth, request });
  assert.equal(await kindOf(make(answer(200, '{"ocs":{"data":[]}}')).info()), 'not_nextcloud');
  assert.equal(await kindOf(make(answer(403, '{}')).info()), ERROR_KINDS.HTTP);
  assert.equal(await kindOf(make(answer(500, 'oops')).info()), ERROR_KINDS.SERVER_ERROR);
  // A 503 of a reverse proxy, not the maintenance mode of Nextcloud.
  assert.equal(await kindOf(make(answer(503, '<html/>')).info()), ERROR_KINDS.SERVER_ERROR);
});
