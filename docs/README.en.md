<p align="center"><img src="../assets/syncfu-icon.svg" alt="SyncFu" width="88" /></p>
<h1 align="center">SyncFu 0.1.0</h1>
<p align="center">Two computers. One set of files. LAN folder synchronization for Windows and macOS.</p>
<p align="center"><a href="../README.md">简体中文</a> · English · <a href="README.md">Documentation</a> · <a href="../CONTRIBUTING.md">Contributing</a> · <a href="../SECURITY.md">Security</a></p>

> **0.1.0 is a development release.** Synchronization is manual. Native Windows interaction and physical two-device LAN acceptance remain unverified. Start with dedicated test folders and retain independent backups.

## Features

- Per-task two-way synchronization, one-way updates, or strict mirroring; restrict each run to sending, receiving, or both.
- No 20,000-entry task cap: scan in batches of 256 files with up to four readers, reporting each device's current path, discovered/checked files and bytes without manually splitting tasks.
- Live file and byte progress, with waiting, transferred and completed states; a file is marked complete only after confirmed application.
- Cross-page selection of additions, updates and deletions; compare conflicts, choose versions, defer or exclude paths.
- Write-time preflight, backup before overwrite/deletion, explicit risk approval, protected undo and interrupted-result reconciliation.
- LAN-first discovery and five-digit pairing codes, with manual IP entry as a fallback. No cloud account or relay required.
- A collapsible sidebar, separate usage overview with daily byte charts and file-count heatmaps, neutral light/dark themes, optional Soft/Clear glass surfaces, device aliases, Fluent Emoji avatars and five interface languages.

| Task workspace | Dark theme |
| --- | --- |
| ![Task workspace](ui/screenshots/workspace.jpg) | ![Dark theme](ui/screenshots/dark.jpg) |

Screenshots use test devices and folders. The interface uses shadcn/ui, Radix, Lucide, Fluent Emoji, Phosphor and react-file-icon. See the [UI documentation](ui/README.md) for implementation and provenance.

## Version and platforms

The project has one product: **SyncFu 0.1.0**, application identity `org.syncfu.desktop`. Build entry points, package names and output directories share that version.

| Area | Scope |
| --- | --- |
| Windows | Windows 10 22H2 / Windows 11 x64, with WebView2 |
| macOS | macOS 13+, native Apple Silicon or Intel builds |
| Network | Reachable IPv4 LAN, TCP `47657` by default |
| Compatibility | Peer protocol **5**, state schema **3**; upgrade both devices together, incompatible with protocol 4 and earlier clients |
| Synchronization | Manual writes; automatic checks are read-only |

## Build from the Windows source archive

Extract `SyncFu-0.1.0-windows-source.zip` completely and open the `SyncFu-0.1.0` directory.

Install **Node.js 22.18+**, **Rust stable with the MSVC toolchain**, **Microsoft C++ Build Tools** with “Desktop development with C++”, and **WebView2 Runtime**. Then double-click **Build-Windows.cmd**, or run:

```powershell
node scripts/build.mjs windows
```

The script checks version consistency and the archive's source hashes, installs locked dependencies, runs checks and produces:

```text
releases/0.1.0/SyncFu-0.1.0-windows-x64-setup.exe
```

The first build requires internet access. The source archive includes source, lockfiles, tests, documentation and licenses; it does not include dependency caches or an already-built Windows installer. See the [build guide](building.md) for detailed setup and verification.

## Development

Install the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/), then run in the source root:

```bash
npm ci
npm run tauri dev
```

For the browser-only fixture, run `npm run dev` and open `http://localhost:1420/?desktop-test`. This development-only entry cannot connect to real peers or modify synchronization folders.

## First synchronization

1. Connect both computers to the same LAN. In **Devices → Connect**, let one device wait; select it from the discovered devices on the other computer and enter its pairing code. Confirm the request on the waiting device.
2. Authorize a dedicated test folder on each side, create a task and confirm the endpoints, relationship and synchronization rule.
3. Review the changes. Deletions are unselected by default and unresolved conflicts cannot execute directly.
4. Click **Sync**, review any risk prompt and verify the results. Reconcile partial results in History instead of assuming both folders match.

See the [two-device test guide](testing/README.md). Closing a window may leave the process running in the tray/menu bar; quit older processes before changing builds.

Large scans alternate discovery and bounded hashing batches. Until discovery finishes, progress shows actual counts and activity instead of an invented percentage. An incomplete scan remains visible for diagnosis but cannot authorize synchronization. Large messages use 256 KiB frames and automatically cleaned temporary files for serialization, removing the former 32 MiB whole-message limit.

## Layout

```text
core/                 Rust synchronization and recovery engine
src/                  React interface, shared models and development fixtures
src/components/ui/    Vendored shadcn/Radix components
src-tauri/            Tauri entry point and platform configuration
assets/               Brand assets, third-party materials and licenses
scripts/              Build, packaging, tests and test-data tools
docs/                 Current build, testing, UI and architecture documentation
docs/archive/         Historical records, excluded from source distributions
releases/0.1.0/       Generated release artifacts, excluded from version control
```

## Verification and limits

Build checks, browser interactions and physical two-device synchronization are separate validation results. The [UI record](ui/README.md) describes existing UI checks; CI for a specific revision describes its automated checks. Source archives include SHA-256 manifests for integrity checking, not publisher authentication.

Removing the entry cap does not make total memory constant: complete manifests, comparison plans and file-progress state still grow with the number of entries (O(n)). Work queues, file buffers and network frames are bounded; practical task size still depends on memory, temporary disk space and runtime.

Synchronization is not a substitute for independent backups. Active databases, application libraries, NAS, removable media and complete system-metadata preservation are outside the current validation scope. The application has not undergone an independent security audit; see [SECURITY.md](../SECURITY.md). Local builds do not imply Windows code signing or Apple notarization.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development checks and [CHANGELOG.md](../CHANGELOG.md) for version changes.

## License

First-party code uses [Apache-2.0](../LICENSE). Third-party components, fonts and assets retain their licenses; notices are collected and distributed with the application. See [NOTICE](../NOTICE) and the [UI source ledger](ui/sources.json). SyncFu is independent and not affiliated with Syncthing or its component providers.
