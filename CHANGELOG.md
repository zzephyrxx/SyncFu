# Changelog

## 0.1.0

Development release. A versioned package is not a claim of production acceptance or publisher signing.

### Features

- LAN discovery and five-digit pairing codes, explicit folder grants, and per-task two-way, one-way update and strict mirror rules.
- Cross-page file selection, conflict comparison and decisions, version-specific ignores and policy exclusions.
- Write-time preflight, backup-before-write, operation receipts, protected undo, pause and interrupted-result reconciliation.
- Five interface languages, local usage overview and platform permission diagnostics.
- A shadcn/Radix desktop interface with Lucide controls, Fluent Emoji device avatars, Phosphor status dots and react-file-icon file glyphs.
- Persistent sidebar collapse, colored task folders, local device aliases and a compact endpoint-aware task form.
- A 38px macOS toolbar aligned with native window controls, and light/dark themes controlled in Settings.
- Consistent dropdown selectors, a static acknowledgements page, and a centered application About page.
- Uncapped task entry counts, bounded 256-file scan batches and live discovery/verification progress; no manual task splitting for large directories.
- Per-file transfer and application status, completed-file marks and paged progress updates alongside total byte and item counts.
- Daily processed-file heatmaps alongside byte charts, with shared 7/30-day real-record aggregation and portal tooltips that remain outside clipped chart containers.
- Optional light/dark glass surfaces in Settings, with solid material as the default and reduced-transparency/contrast fallbacks.

### Project organization

- Unified product metadata, build entry points and distributable names as **SyncFu 0.1.0**.
- Consolidated current documentation into build, testing and UI guides; historical design records are archived separately.
- Replaced separate stage-specific application builds with one SyncFu application identity.
- Added a Windows source archive with lockfiles, tests, licenses and a SHA-256 source manifest, plus a `Build-Windows.cmd` entry point.
- Collected current build outputs under `releases/0.1.0/` and excluded caches and historical artifacts from source archives.

### Fixes

- Prevent directory-handle exhaustion during broad or deep scans by queuing paths and limiting concurrent file reads.
- Remove the 20,000-entry scan/plan limit while preserving complete-scan validation and authorization checks. Keep the queued hashing work and read buffers bounded; full manifests and plans still use O(n) memory.
- Report per-device scan phases, paths, bounded queue counts, file counts and bytes. Long scan and work RPCs have a longer deadline; active framed transfers use per-frame stall deadlines rather than a 90-second whole-message server deadline.
- Upgrade the peer protocol to **5** with 256 KiB sequenced frames and explicit message endings. Large JSON representations spill to automatically cleaned temporary files, removing the former 32 MiB message cap. Pre-pairing messages retain their cumulative 32 KiB limit; both devices must upgrade together. State schema remains **3**.
- Explain disabled synchronization when the scan is incomplete, rules are pending, a device is offline, or no files are selected.
- Put confirmed unpairing on device rows and move additional folder grants to the authorization list toolbar.
- Compact the rules dialog and restore visible primary confirmation buttons. Replace ambiguous policy reconciliation with explicit confirmation-state feedback where recovery is needed.

- Pairing approval has a visible wait state and unlocks controls after at most 18 seconds.
- Consumed pairing codes cannot appear valid again after a request disconnects.
- Device and folder endpoints remain explicit in task creation and synchronization views.
- Settings switch thumbs use one translation and remain within their tracks.
- Removed the obsolete computer-handoff action and its dialogs.
- Display Windows extended-length paths as familiar drive or UNC paths while preserving the original paths for filesystem operations.

### Validation and limitations

- UI checks and their scope are recorded in [the UI guide](docs/ui/README.md); automated checks belong to their corresponding revision and CI run.
- Automatic write scheduling is not implemented.
- Native Windows window behavior and physical two-device LAN synchronization still require acceptance testing.
- Local builds and ad-hoc signature checks do not imply Windows code signing, Developer ID signing or Apple notarization.
