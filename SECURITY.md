# Security

VAV is a local-first desktop app. Pairing secrets and API keys unlock filesystem access, shells, and provider accounts on this machine.

- **API keys** are stored via Electron `safeStorage` (OS keychain). Do not commit keys, pairing URIs, or `paired-hosts.json`. Revealing a stored key requires a native confirmation dialog.
- **Local files:** renderer IPC and `vav-local://` can only read/write the watched workspace, app temp dirs (clips, office convert, working copies), and paths granted by a main-process open/save dialog.
- **Daemon / remote:** a valid pairing secret is equivalent to local code execution on the host. Desktop listen defaults to `127.0.0.1`. Headless `vavd` still binds all interfaces so other devices can connect (`--listen 127.0.0.1` for loopback-only). Treat the pairing line like a password.
- **CLI agents** may be launched with workspace-trust / skip-permission flags from Settings. Review those defaults before pointing VAV at a sensitive tree.

## Reporting a vulnerability

Email **licensing@21stware.com** with steps to reproduce. Please do not open a public issue for unpatched RCE or secret-disclosure bugs.
