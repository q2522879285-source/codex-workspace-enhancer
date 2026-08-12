# Security

## Supported version

Security fixes are applied to the latest release.

## Local security model

- The AssetBrowser service binds to `127.0.0.1` only.
- API and media requests require a locally generated token.
- The token, project configuration, ledgers and media are runtime data and are never included in releases.
- The Codex iframe bridge uses a per-open nonce and a dedicated synthetic origin.

## Reporting

Please report vulnerabilities through GitHub's private security advisory flow instead of a public issue.
