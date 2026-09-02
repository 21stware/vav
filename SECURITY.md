# Security

VAV is a local-first desktop app. Pairing secrets and API keys unlock filesystem access, shells, and provider accounts on this machine.

- **API keys** are stored via Electron `safeStorage` (OS keychain). Do not commit keys, pairing URIs, or `paired-hosts.json`.
- **Daemon / remote:** a valid pairing secret is equivalent to local code execution on the host. `vavd` binds all interfaces by default so other devices can connect; use `--listen 127.0.0.1` for loopback-only. Treat the pairing line like a password.
- **CLI agents** may be launched with workspace-trust / skip-permission flags from Settings. Review those defaults before pointing VAV at a sensitive tree.

## Reporting a vulnerability

Email **licensing@21stware.com** with steps to reproduce. Please do not open a public issue for unpatched RCE or secret-disclosure bugs.
