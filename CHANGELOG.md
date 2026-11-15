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
- Local device aliases, Fluent Emoji avatars and optional Lucide device-type icons; aliases appear in task endpoints, direction menus and file destinations while original device names remain available.
- A small, verified local Fluent Emoji asset set with provenance and MIT notices; arbitrary custom emoji retain a system-font fallback.
- File-type glyphs from react-file-icon and Phosphor Circle weights for connectivity and task status.
- Material previews and license links for the components used by the production interface.

### Changed

- Replaced the BoardUI visual system with tauri-ui desktop conventions and vendored shadcn/ui components built on Radix primitives. The existing Tauri/Rust application, filename-first rows and cross-page selection remain in place.
- Replaced historical Morphicons/EasyUI runtime visuals with Lucide action and device-type icons, colored flat task folders, Fluent device avatars and explicit red conflict warnings.
- Reorganized paired devices into compact horizontal rows and added avatar/type selection to the local device-profile editor.
- Combined the macOS window-control area and application toolbar into one row; theme selection now lives in Settings.
- Made discovered LAN devices the primary connection path and moved manual IP entry to a fallback section.
- Standardized on “pairing code” and introduced five individual digit fields with full-code paste, leading-zero support and keyboard correction.
- Reorganized task creation into a compact form with distinct device, folder and direction information; aligned checkbox, radio, focus and disabled states.
- Replaced ambiguous offline artwork with a disconnection icon and actionable connection guidance.

### Fixed

- Added a visible wait state during pairing approval, with controls unlocked after at most 18 seconds.
- Prevented consumed pairing codes from appearing valid again after a request disconnects.

### Validation

- Current implementation scope and validation results belong to the [tauri-ui/shadcn desktop record](docs/shadcn-redesign/README.md) and CI for the corresponding revision.
- The [previous UI refresh](docs/ui-refresh/README.md) retains its historical test and macOS preview results; these do not validate the current component replacement.

### Known limitations

- This is an unreleased development source snapshot, not a stable or production-validated distribution.
- Automatic write scheduling is not implemented.
- Native Windows window behavior and physical two-device LAN synchronization have not been validated in this UI iteration.
- Local build or ad-hoc signature verification is not Developer ID signing, Apple notarization or Windows code signing.
- Historical UI designs and measurements remain under `docs/` for reference; they are not current release claims.
