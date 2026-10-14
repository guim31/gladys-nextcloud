# Nextcloud for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for
[Nextcloud](https://nextcloud.com/): your self-hosted cloud watched from Gladys,
**read only**, through the monitoring API of Nextcloud (the "Monitoring" app,
`serverinfo`, shipped and enabled with Nextcloud) — the same API the Home
Assistant integration reads. Is it online, is an update waiting, how much space
is left, who uses it. Scenes react when a new version of Nextcloud or of its
apps comes out; a dashboard widget sums it up.

**Tested against a real Nextcloud 32** (32.0.9 on PHP 8.3 and SQLite, installed
in the development session): its answers are the fixtures of the tests, and
`npm run test:real` drives the whole integration against it. Not yet tested on
a real Gladys installation. Feedback welcome in the
[issues](https://github.com/guim31/gladys-nextcloud/issues).

## Features

- **One device per Nextcloud**: online, Nextcloud version, Nextcloud update
  available, app updates, active users (5 minutes, 1 hour, 24 hours), users,
  files, shares, free space, database size, system load (per processor
  thread), memory used, PHP version, memory cache.
- **Scene triggers**: Nextcloud update available (with the installed and the
  new version), Nextcloud app updates available (with the list of the apps and
  their versions). Once per version, never at the first read, never twice
  across a restart.
- **Dashboard widget** "Nextcloud": free space, active users, updates waiting,
  then what needs attention first; Refresh and Open Nextcloud buttons.
- **Test the connection** action, and a connection status that says what to
  fix (refused token or password, account not an administrator, app disabled,
  maintenance mode, too many failed attempts, certificate, wrong address).
- Feature names, texts and documentation in English, French, German and
  Spanish.

Read only by design: no maintenance mode, no update, no file operation from
Gladys.

## Requirements

- Gladys Assistant 5.1.0 or later.
- Nextcloud with the Monitoring app (`serverinfo`) enabled (the default). The
  system load needs Nextcloud 28 or later (thread count).
- A serverinfo token (`occ config:app:set serverinfo token --value <token>`,
  recommended), or an administrator account with an app password (Personal
  settings → Security). Never the main password.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-nextcloud`
   (or install **Nextcloud** from the catalog once it is listed).
2. In **Configuration**, enter the address of your Nextcloud
   (`https://cloud.example.com`, `http://192.168.1.20:8080`,
   `https://example.org/nextcloud`…) and the token, or the account and its app
   password. Save, then click **Test the connection**.
3. Open the **Discover** tab and add the Nextcloud device.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

The integration calls one endpoint,
`GET <nextcloud>/ocs/v2.php/apps/serverinfo/api/v1/info?format=json&skipApps=false&skipUpdate=false`,
with the `NC-Token` header or Basic authentication. `skipUpdate=false` adds the
result of Nextcloud's own update check (no extra request), `skipApps=false` the
apps with an update, read from the app store list Nextcloud keeps for an hour.
It reads on its own timer (1 to 15 minutes): Gladys 5.2 does not poll reliably
(GladysAssistant/Gladys#3198), the device is still published with
`should_poll: true` so that the core's onPoll can take over if the timer ever
stalls, and is skipped otherwise. After a refused login or token, it waits
30 minutes before trying again (Nextcloud's brute-force protection throttles
the address of Gladys, possibly shared with the whole home behind a reverse
proxy), unless the configuration changes or the user asks.

Only the changes are sent to Gladys, and every value again after 6 hours.
`/data` keeps the address, the features the device had and the versions
already announced; no secret.

## Checked, and what was not

- **Checked against a real Nextcloud 32.0.9** (git tag `v32.0.9`, `serverinfo`
  `stable32`, SQLite, `php -S`): token and app password, a wrong token, a wrong
  password, an account outside the admin group, the app disabled, maintenance
  mode, an update offered by the core's update check. The answers are recorded
  in `test/fixtures/nextcloud/real/`, and `npm run test:real` runs the
  integration (SDK's fake Gladys, real HTTP client) against such an instance.
- **Checked in the Gladys sandbox constraints**: an image with the same
  content (`--cap-drop ALL --read-only --memory 256m`, `/data` volume, bridge
  network) runs at about 20 MB, never logs the token, stops cleanly on SIGTERM,
  and reads the real Nextcloud through the bridge.
- **Not checked**: a real Gladys instance (Discovery tab, widget rendering,
  scene editor), the image built by the CI itself, a real
  app update (a git checkout is never offered one and the session had no app
  store access: the shape comes from the serverinfo code), HTTPS with a real
  certificate or a reverse proxy, MySQL/PostgreSQL, Redis and APCu on a real
  server (the APCu case comes from the Home Assistant fixture), the HTTP 429
  of the brute-force protection (handled from the Nextcloud code, not seen).

## Limitations

- One Nextcloud per installation.
- No disk temperatures, network traffic or per-user quotas: the monitoring API
  does not give them. The file count is refreshed by Nextcloud every 3 hours.
- The events only announce the versions that appear after the first read.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npm run test:real   # skipped without NEXTCLOUD_URL, see test/fixtures/nextcloud/README.md
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and a fake Nextcloud (`test/helpers/fakeNextcloud.js`) replaying the answers
recorded on the real one. `test/gladys-rules.test.js` checks the device against
the category/type table of the Gladys core. See [`CLAUDE.md`](CLAUDE.md) for
the project rules.

Releases go through **Actions → Release** (it bumps the versions, rolls the
changelog, tags, builds the image and publishes the GitHub Release): never
edit the versions by hand. A hand-pushed `vX.Y.Z` tag also builds the image,
but then `version` in `package.json` and in the manifest, and the tag of
`docker_image`, must be bumped together and committed before tagging.

## Credits

- [serverinfo](https://github.com/nextcloud/serverinfo) by Nextcloud GmbH and
  contributors (AGPL-3.0): the API read here; its code was read to know the
  units, the authentication and the answers. No code of it is included.
- The Home Assistant [`nextcloud`](https://www.home-assistant.io/integrations/nextcloud/)
  integration by the Home Assistant authors (Apache-2.0): the choice of
  `skipUpdate=false`, the fields worth showing, and the Nextcloud 28 answer of
  its tests, reused as a fixture.
- [nextcloudmonitor](https://github.com/meichthys/nextcloud_monitor) by
  MeIchthys (MIT), the library Home Assistant uses: the two ways to
  authenticate (`NC-Token`, Basic).
- The architecture, the conformity and language tests follow
  [gladys-unraid](https://github.com/guim31/gladys-unraid) and
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Nextcloud GmbH.
Nextcloud is a trademark of Nextcloud GmbH.

## License

Apache-2.0
