# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] — 2026-09-10

### Added

- `carrycut watch` session guardian (interval / `--once`, edge-triggered alerts, NDJSON `--json`).
- Compaction markers (`lastCompactAt`) surfaced in sim/watch output.
- Hardened transcript parsing: Windows project-path encodings, array text content, nested Skill / SlashCommand shapes.
- Session path + skill count in table output when using `--session`.

### Changed

- Package positioned as a **session guardian** (V2); version bump to 2.0.0.

## [1.0.0] — 2026-09-10

### Added

- `carrycut sim` — KEEP / TRUNCATE / DROP simulation (5k per skill, 25k combined, newest-first).
- `carrycut stale` — mtime / hash freshness checks vs session timestamps.
- Calibrated tiktoken (`o200k_base` × 1.15) token estimates.
- `--json`, `--critical`, `--strict`, `--skills-root`, demo fixtures, unit tests.
- MIT license.

[2.0.0]: https://github.com/YOUR_GITHUB_USER/carrycut/releases/tag/v2.0.0
[1.0.0]: https://github.com/YOUR_GITHUB_USER/carrycut/releases/tag/v1.0.0
