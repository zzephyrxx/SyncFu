# Security policy

SyncFu is a development-stage file synchronization tool. It has not completed an independent security audit or production acceptance across its target platforms. Keep independent backups and use dedicated test folders first.

## Reporting a vulnerability

Please do **not** disclose an exploitable issue in a public Issue or Pull Request.

Use this repository's **Security → Report a vulnerability** entry when it is available. If private reporting is unavailable, open a minimal Issue asking for a private contact channel **without exploit details, private data or credentials**. No response-time or long-term maintenance SLA is currently promised.

Useful information for a private report:

- Affected revision and operating systems.
- Expected versus observed behavior and the potential impact.
- A minimal reproduction using synthetic files and temporary directories.
- Whether authorization, content validation, deletion protection, backup or recovery was bypassed.

Never include pairing codes, identity/private keys, system credentials, application databases, actual file contents or unredacted personal paths in public reports. Avoid attaching a complete application-data or backup directory.

## Supported security scope

Security fixes currently target the latest development source. There are no supported stable or LTS release branches yet. Historical prototypes and screenshots are not supported client versions.

The design includes PAKE pairing, mutual TLS, stable peer identities, explicit folder grants, shared task policies, SHA-256 content verification, authorized-root/no-follow protections, backup-before-write, deletion risk gates and protected undo. These mechanisms reduce risk; they do not establish a formal security certification or guarantee recovery from every failure.

## Operational boundaries

- Use mutually trusted devices on a private LAN. Do not expose SyncFu's listener directly to the public internet.
- Grant only the intended folder. Do not grant a whole home, system, credential or backup directory.
- Do not weaken certificate checks, TLS verification, firewall protections, Gatekeeper or SmartScreen to work around an error.
- Stop editing files during a controlled acceptance run. A partial result is not proof that both peers agree.
- Preserve `.syncfu-stage` and backups while investigating interruption or uncertain outcomes.
- Undo applies to the recorded operations and protects subsequent edits. It is not a complete folder rollback.
- Active databases, application libraries, NAS/removable storage and full metadata fidelity are outside the current acceptance scope.

SyncFu 0.1.0 uses the application-data identity `org.syncfu.desktop`. Quit older SyncFu processes before starting the current application. Historical preview data is not automatically imported or deleted.

For non-security bugs, use the ordinary bug template with sanitized diagnostic details.
