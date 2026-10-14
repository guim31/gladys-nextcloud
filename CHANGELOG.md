# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-14

### Added

- Watch a Nextcloud from Gladys, read only, through its monitoring API (the
  "Monitoring" app, `serverinfo`): one device with online, Nextcloud version,
  Nextcloud update available, app updates, active users (5 minutes, 1 hour,
  24 hours), users, files, shares, free space, database size, system load,
  memory used, PHP version and memory cache.
- Access with a serverinfo token (recommended) or an administrator account and
  an app password; self-signed certificates accepted on option; a Nextcloud
  under a sub-path (`/nextcloud`) supported.
- Scene triggers "Nextcloud update available" and "Nextcloud app updates
  available", once per version, with the versions and the apps as variables.
- Dashboard widget "Nextcloud": free space, active users, updates waiting, and
  what needs attention first; Refresh and Open Nextcloud buttons.
- "Test the connection" action, and connection statuses that say what to fix
  (refused token or password, account not an administrator, app disabled,
  maintenance mode, too many failed attempts, certificate, wrong address).
- The integration reads Nextcloud on its own timer (1 to 15 minutes), and
  waits 30 minutes after a refused login so as not to feed Nextcloud's
  brute-force protection.
- Feature names, texts and documentation in English, French, German and
  Spanish.

[Unreleased]: https://github.com/guim31/gladys-nextcloud/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-nextcloud/releases/tag/v1.0.1
