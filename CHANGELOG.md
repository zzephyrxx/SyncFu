# Changelog

This file tracks user-visible changes. Entries under **Unreleased** are development work, not a signed or production-validated release.

## Unreleased

### Added

- Windows/macOS LAN pairing, explicit folder grants and per-task two-way, one-way update and strict mirror rules.
- Conflict comparison and decisions, version-specific ignore and policy-based exclusions.
- Backup-before-write, operation receipts, protected undo, pause and interrupted-result reconciliation.
- Backend-preflight-driven one-click ordinary synchronization; separate review for destructive, risky, conflict-override and undo operations.
- Five interface languages, local usage statistics and platform permission diagnostics.
- Cross-platform build workflow, regression tests, dependency notices and isolated acceptance tooling.
- Persistent sidebar collapse, stable task-folder colors and a dedicated usage-overview page.
- Local device aliases and emoji, reflected in task endpoints, direction menus and file destinations while retaining original device names.
- Material previews and license links for the components used by the production interface.

### Changed

- Refreshed the production desktop workspace with BoardUI controls, EasyUI-derived folder artwork and Morphicons, retaining filename-first rows and cross-page batch selection.
- Combined the macOS window-control area and application toolbar into one row; theme selection now lives in Settings.
- Made discovered LAN devices the primary connection path and moved manual IP entry to a fallback section.
- Standardized on “pairing code” and introduced five individual digit fields with full-code paste, leading-zero support and keyboard correction.
- Reorganized task creation into a compact form with distinct device, folder and direction information; aligned checkbox, radio, focus and disabled states.
- Replaced ambiguous offline artwork with a disconnection icon and actionable connection guidance.

### Fixed

- Added a visible wait state during pairing approval, with controls unlocked after at most 18 seconds.
- Prevented consumed pairing codes from appearing valid again after a request disconnects.

### Validation

- The [2026-11-15 UI refresh](docs/ui-refresh/README.md) records 81 frontend tests passing, including type checking and the production build.
- Browser fixtures cover 1120 × 780 and 680 × 560 layouts, light/dark themes, sidebar persistence, pairing interactions, task creation, offline states and device-profile updates.
- Native macOS WKWebView preview confirmed the single-row toolbar and sidebar collapse. The Apple Silicon / arm64 application passed ad-hoc signature verification and ZIP integrity checks.

### Known limitations

- This is an unreleased development source snapshot, not a stable or production-validated distribution.
- Automatic write scheduling is not implemented.
- Native Windows window behavior and physical two-device LAN synchronization have not been validated in this UI iteration.
- Local build or ad-hoc signature verification is not Developer ID signing, Apple notarization or Windows code signing.
- Vite reports that the desktop JavaScript chunk exceeds 500 KB; the production build completes.
- Historical UI designs and measurements remain under `docs/` for reference; they are not current release claims.
