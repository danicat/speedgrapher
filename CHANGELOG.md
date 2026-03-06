# Changelog

## [v0.5.4] - 2026-03-06

### Added
- Automated Vale Bootstrapper: Speedgrapher now automatically downloads, verifies (via SHA256), and executes a pinned version of `vale` (v3.13.1). This ensures a consistent and secure editorial baseline regardless of the user's system configuration.

### Fixed
- Improved linter compliance and resolved several code quality warnings in `seo` and `slop` tools.

## [v0.5.3] - 2026-03-06



### Fixed
- Add missing GitHub Action workflow for binary distribution via Goreleaser.
- Corrected location of editorial skills to the root `skills/` folder.


## [v0.5.0] - 2026-03-05



### Added
- Binary distribution configuration via Goreleaser.
- 4 specialized editorial skills (`tech-interviewer`, `tech-writer`, `tech-reviewer`, `tech-publisher`) to encapsulate the editorial workflow.
- `slop` MCP tool (Go implementation) to detect AI-generated clichés and buzzwords.
- `vale` MCP tool to run static analysis for style and grammar issues.
- Interactive prompt during extension installation to verify the `vale` system dependency.

### Changed
- Refactored `register.go` to retain only essential slash commands (`/interview`, `/review`, `/readability`).
- Updated the `/review` prompt to leverage the new `fog`, `slop`, and `vale` analytical tools.
- Modernized the `README.md` to reflect the new skills-driven workflow and binary distribution instructions.

### Removed
- Deprecated slash commands (`/context`, `/expand`, `/haiku`, `/localize`, `/outline`, `/publish`, `/reflect`, `/seo`, `/voice`) as their knowledge is now encapsulated within the new editorial skills.
