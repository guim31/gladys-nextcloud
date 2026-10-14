# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes. In
particular:

- the **serverinfo token** and the **app password**, kept by Gladys in the
  integration configuration (secret fields), sent only to the configured
  Nextcloud (`NC-Token` header, or Basic authentication), never logged, never
  written to `/data`, never sent to Gladys in a device or a state. A redirect
  is followed only on the same host, and never from HTTPS to HTTP;
- the integration is **read only**: it calls the serverinfo monitoring
  endpoint and nothing else. The token opens that endpoint only; an app
  password of an administrator opens more, which is why the token is the
  recommended access;
- what is stored in `/data` (`nextcloud-state.json`): the Nextcloud address,
  the features the device had, and the Nextcloud and app versions already
  announced to the scene triggers. No secret;
- the network: the integration only connects to the Nextcloud of the
  configuration, usually on the local network. Certificate checks stay on
  unless the user ticks "Accept self-signed certificates".

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and Nextcloud and its apps.
