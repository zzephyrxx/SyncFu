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

### Project organization

- Unified product metadata, build entry points and distributable names as **SyncFu 0.1.0**.
- Consolidated current documentation into build, testing and UI guides; historical design records are archived separately.
- Replaced separate stage-specific application builds with one SyncFu application identity.
- Added a Windows source archive with lockfiles, tests, licenses and a SHA-256 source manifest, plus a `Build-Windows.cmd` entry point.
- Collected current build outputs under `releases/0.1.0/` and excluded caches and historical artifacts from source archives.

### Fixes

- Pairing approval has a visible wait state and unlocks controls after at most 18 seconds.
- Consumed pairing codes cannot appear valid again after a request disconnects.
- Device and folder endpoints remain explicit in task creation and synchronization views.
- Settings switch thumbs use one translation and remain within their tracks.
- Removed the obsolete computer-handoff action and its dialogs.

### Validation and limitations

- UI checks and their scope are recorded in [the UI guide](docs/ui/README.md); automated checks belong to their corresponding revision and CI run.
- Automatic write scheduling is not implemented.
- Native Windows window behavior and physical two-device LAN synchronization still require acceptance testing.
- Local builds and ad-hoc signature checks do not imply Windows code signing, Developer ID signing or Apple notarization.
