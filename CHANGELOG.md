# Changelog

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
