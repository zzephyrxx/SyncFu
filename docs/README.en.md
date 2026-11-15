<p align="center"><img src="../assets/syncfu-icon.svg" alt="SyncFu" width="88" /></p>
<h1 align="center">SyncFu</h1>
<p align="center">Two computers. One set of files. LAN folder synchronization for Windows and macOS.</p>
<p align="center"><a href="../README.md">简体中文</a> · English · <a href="README.md">Documentation</a> · <a href="../CONTRIBUTING.md">Contributing</a> · <a href="../SECURITY.md">Security</a></p>

> **Development preview, not a production-validated stable release.** Start with dedicated test folders and keep independent backups. Browser fixtures, automated tests and local builds do not establish physical two-device acceptance.

## Features

- **Per-task rules:** two-way synchronization, one-way updates, or strict one-way mirroring. Pairing initiator/receiver roles do not determine synchronization direction.
- **One operation list:** select additions, updates and deletions in bulk across all matching pages. Restrict a run to sending or receiving without changing the task's persistent rules.
- **Explicit conflict decisions:** compare versions, choose a source, defer, ignore the current versions, or exclude a path through the shared policy.
- **Fewer prompts, not fewer safeguards:** ordinary additions/updates execute after backend preflight. Deletions, selected conflict overrides, undo, risk approvals and expanded selections require review.
- **Recoverable operations:** backup before overwrite/deletion, per-operation receipts, protected undo and reconciliation after interruption.
- **Local-first:** no cloud account or relay required; files move directly between LAN peers.
- **LAN-first pairing:** choose a discovered device and enter its five-digit pairing code in separate digit boxes. Manual IP entry is available as a fallback.
- **Recognizable devices and tasks:** save device aliases and emoji locally; original device names remain available. Colored folder icons identify tasks in a collapsible sidebar whose state persists.
- **Clear synchronization endpoints:** device names, folders and transfer direction have separate places in the task workspace and compact task-creation form.
- **Desktop navigation:** a dedicated usage overview, theme selection in Settings, and a single-row macOS toolbar with space for native window controls.
- **Consistent controls:** light/dark themes, filename-first rows, accessible selection controls, and Simplified Chinese, Traditional Chinese, English, Japanese and Korean.

| Task workspace | Dark theme, collapsed sidebar |
| --- | --- |
| ![Task workspace with explicit device and folder endpoints](ui-refresh/screenshots/workspace.jpg) | ![Dark task workspace with a collapsed sidebar](ui-refresh/screenshots/dark-collapsed.jpg) |

Screenshots use isolated test devices and folders, not a physical two-device synchronization session. See the [current UI and verification record](ui-refresh/README.md) for the implementation scope and validation limits.

## Status and requirements

| Area | Status |
| --- | --- |
| Windows | Target: Windows 10 22H2 / Windows 11 x64 with WebView2 |
| macOS | Target: macOS 13+, Apple Silicon and Intel build targets; the current UI iteration was validated on Apple Silicon |
| Linux / mobile | Not supported |
| Automatic synchronization | Automatic **read-only checks** exist; automatic writes are not implemented |
| Network | Mutually reachable IPv4 LAN; TCP `47657` by default; no relay or NAT traversal |
| Compatibility | Peer protocol **4**, state schema **3**; incompatible with protocol 3 peers |
| Distribution | Source first; successful GitHub Actions runs provide build artifacts, not signed stable releases |

Windows installers use an existing WebView2 runtime or download it if missing. Building dependencies, installing WebView2 for the first time and manually opening the release page may require internet access.

## Run locally

Install [Node.js 22.18+](https://nodejs.org/), [Rust stable](https://www.rust-lang.org/tools/install), and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). Clone this repository, enter its directory, then run:

```bash
npm ci
```

```bash
npm run tauri dev
```

For a browser-only UI fixture:

```bash
npm run dev
```

Open `http://localhost:1420/?desktop-test`. This development-only entry cannot connect to real peers or modify synchronization folders. The browser homepage is not the native desktop runtime.

## First synchronization

1. Put both computers on the same LAN and open **Devices → Connect**. Let one device wait for a connection. On the initiating device, select it from the discovered LAN devices and enter its **five-digit pairing code**; pasting the complete code is supported, including leading zeros. Confirm the request on the waiting device. If discovery does not find the device, expand the manual IP fallback.
2. Authorize a dedicated test folder on each device. Do not authorize an entire home, Desktop or system directory.
3. Link the two grants in a task. Confirm the personal/shared relationship and direction; initial classification requires peer approval.
4. Inspect changes. Non-conflicting additions/updates are initially selected; deletions and unresolved conflicts are not. Selection cards never execute changes themselves.
5. Click **Sync**. Review any dangerous or expanded operation list. After a partial result or disconnection, reconcile history instead of assuming both folders match.

The one-run scope does not change persistent rules. Closing the window may leave SyncFu running in the tray/menu bar; use the quit action before starting another version.

See the [acceptance guide](acceptance/README.md) for dedicated test data and staged checks.

## Build

Build on the target operating system. These commands use the normal application identity.

### macOS application

For an Apple Silicon application, run on an Apple Silicon Mac:

```bash
npm run tauri -- build --bundles app
```

Output: `target/release/bundle/macos/`. This is the architecture validated in the current UI iteration.

To build a universal application for both Apple Silicon and Intel:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

```bash
npm run tauri -- build --target universal-apple-darwin --bundles app
```

Output: `target/universal-apple-darwin/release/bundle/macos/`.

### Windows installer

```bash
npm run tauri -- build --target x86_64-pc-windows-msvc --bundles nsis
```

Output: `target/x86_64-pc-windows-msvc/release/bundle/nsis/`. To explicitly bundle the much larger offline WebView2 runtime:

```bash
npm run tauri -- build --target x86_64-pc-windows-msvc --bundles nsis --config src-tauri/tauri.offline.json
```

The isolated acceptance app uses `org.syncfu.acceptance.p2`, not the normal `org.syncfu.desktop` identity. Older acceptance tasks may persist. See the [acceptance instructions](acceptance/README.md); do not run old and new acceptance processes simultaneously.

## Verification and limits

The [2026-11-15 UI refresh record](ui-refresh/README.md) reports **81 frontend tests passing** through `npm test`, including TypeScript checking, the production build, synchronization selection/protection contracts and device-profile persistence. This is a recorded validation snapshot; use CI and the acceptance records for the revision you run.

- Browser fixtures were checked at 1120 × 780 and the minimum desktop size of 680 × 560, covering themes, sidebar persistence, long device names, offline states, usage overview, material previews, task creation and device-profile updates.
- Pairing checks covered LAN selection, full-code paste, leading zeros, backspace, final-digit replacement, manual IP fallback, generation/copy feedback and simulated request completion.
- A native macOS WKWebView preview with an isolated application identity was launched. The single-row toolbar and sidebar collapse were visually checked.
- The current Apple Silicon / arm64 app build passed ad-hoc signature verification with `codesign --verify --deep --strict`; its ZIP passed integrity checks. It is not Developer ID signed or Apple notarized.
- **Native Windows window behavior and physical two-device LAN synchronization have not been validated in this iteration.** Browser fixtures and native macOS visual checks do not establish cross-platform synchronization acceptance.

The production build completes with a Vite warning about the desktop JavaScript chunk exceeding 500 KB. Earlier performance and core test records remain in the [documentation index](README.md); their results are not presented as validation of this revision.

SyncFu uses PAKE pairing, mutual TLS, SHA-256 verification, authorized roots, write-time checks and deletion risk gates. It has not received an independent security audit. Undo protects later edits and reverses the recorded batch's changes; it is not a whole-folder snapshot restore. Synchronization is not a substitute for independent backups.

Current validation targets ordinary files/folders on internal disks at roughly 10,000 files per task. Active databases, application libraries, NAS, removable media and complete system-metadata preservation are outside the current acceptance scope. Read [SECURITY.md](../SECURITY.md) before testing with important data.

## Troubleshooting

- Discovery failures: check IPv4 reachability, Wi-Fi client isolation and firewall rules, or enter the peer address manually.
- Use **Settings → Permission checks** to diagnose local-network access. Limit inbound access to trusted private networks.
- Proxy/mirror failures during builds are build-machine configuration issues. Do not disable TLS verification or substitute an old installer.
- Reconcile partial results while both peers are online; preserve `.syncfu-stage` until recovery is understood.
- For unsigned-app warnings, verify the source and retain the exact error. Do not disable Gatekeeper or SmartScreen.

## Development and licensing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for checks and contribution boundaries, and [the documentation index](README.md) for architecture and historical records.

First-party code is licensed under [Apache-2.0](../LICENSE); see [NOTICE](../NOTICE). The production UI uses BoardUI controls, EasyUI-derived task folders, Morphicons, Lucide icon data, Microsoft Fluent Emoji and Inter. Settings includes previews of the materials in use and their license links. React Bits was evaluated but no component source was copied. [BoardUI component provenance](boardui-redesign/sources.json) and [material provenance](material-redesign/sources.json) record pinned upstream sources; the original notices are retained. Dependency notices are collected into application distributions.

SyncFu is independent and is not affiliated with Syncthing or the referenced UI/asset projects.
