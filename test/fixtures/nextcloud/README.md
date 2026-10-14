# Nextcloud fixtures

## `real/`: answers of a real Nextcloud

Recorded on 14/10/2026 from a **Nextcloud 32.0.9** (git tag `v32.0.9` of
`nextcloud/server` with its `3rdparty` submodule, the `serverinfo` app of
branch `stable32`), installed with `occ maintenance:install` on SQLite and
served by `php -S` (PHP 8.3), with a test token and two throwaway accounts
(`admin`, and `bob` outside the admin group). Nothing private: a sandbox with
no real data. Request:
`GET /ocs/v2.php/apps/serverinfo/api/v1/info?format=json&skipApps=false&skipUpdate=false`.

| File                         | HTTP | Case                                                                 |
| ---------------------------- | ---- | -------------------------------------------------------------------- |
| `info-update-available.json` | 200  | token; the update check of the core says 32.0.10.1 is available      |
| `info-up-to-date.json`       | 200  | token; no update                                                     |
| `unauthorized-token.json`    | 401  | wrong `NC-Token` (answered by the app: `data.message`)               |
| `unauthorised-login.json`    | 401  | wrong password (answered by the core: OCS status 997)                |
| `not-admin.json`             | 401  | valid account outside the admin group (same answer as a wrong token) |
| `serverinfo-disabled.json`   | 404  | `occ app:disable serverinfo` (OCS status 998)                        |
| `maintenance.json`           | 503  | `occ maintenance:mode --on` (OCS status 503)                         |

The update was simulated with
`occ config:app:set core lastupdateResult --value '{"version":"32.0.10.1",…}'`,
the value the `updatenotification` background job stores. No app update could
be recorded: the apps of a git checkout are never offered an update, and the
session had no access to the app store; the tests set `app_updates` in the
shape the app returns (`{ "calendar": "5.5.4" }`, or `[]` when empty).

## `home-assistant-28.0.4.json`

The `NC_DATA` of the Home Assistant tests (`tests/components/nextcloud/const.py`,
Apache-2.0), a Nextcloud 28.0.4 with APCu, wrapped in its OCS envelope. Older
serverinfo: no `cpunum`, no `num_disabled_users`.

## Running a throwaway Nextcloud for `npm run test:real`

```bash
git clone --depth 1 --branch v32.0.9 --recurse-submodules --shallow-submodules \
  https://github.com/nextcloud/server nextcloud
git clone --depth 1 --branch stable32 https://github.com/nextcloud/serverinfo nextcloud/apps/serverinfo
cd nextcloud
php occ maintenance:install --database sqlite --admin-user admin \
  --admin-pass '<a password>' --data-dir "$PWD/../nc-data"
php occ app:enable serverinfo
php occ config:system:set trusted_domains 1 --value=127.0.0.1:8089
php occ config:app:set serverinfo token --value '<a token>'
php occ user:auth-tokens:add admin    # prints an app password
php -S 127.0.0.1:8089 &
cd - && NEXTCLOUD_URL=http://127.0.0.1:8089 NEXTCLOUD_TOKEN='<a token>' \
  NEXTCLOUD_USER=admin NEXTCLOUD_APP_PASSWORD='<the app password>' npm run test:real
```
