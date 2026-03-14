# Changelog

## [v0.6.0] - 2026-03-09

### Added
- Added `deslopify` skill to rewrite text and remove common AI tropes and clichés.
- Added `tropes` prompt to provide editorial AI writing anti-pattern guidelines via MCP.
- Updated `slop` tool to detect newly identified AI clichés, adverbs ("quietly", "delve"), and structural patterns defined in `tropes.md`.
- Updated `tech-reviewer` and `tech-writer` skills to strictly comply with `google-blog-style` (e.g., enforcing sentence-case headings, avoiding superlatives and future roadmaps).

## [v0.5.8] - 2026-03-06

### Fixed
- Added `.vale.ini` and `SPEEDGRAPHER.md` to git tracking. These files were missing from the previous commit, causing Goreleaser to fail during the archive generation process.

## [v0.5.7] - 2026-03-06

### Added
- Automated Vale Bootstrapper: Speedgrapher now automatically downloads and verifies a pinned version of `vale` (v3.13.1).
- Added `SPEEDGRAPHER.md` to provide the LLM with focused context on how to use the MCP tools.

### Fixed
- Re-architected release packaging:
    - Fixed `.goreleaser.yaml` to use the exact `platform.arch.name` naming pattern required by the Gemini CLI.
    - Included `gemini-extension.json`, `SPEEDGRAPHER.md`, `.vale.ini`, and `skills/` in release archives.
    - Moved the `speedgrapher` binary to the root of the archive and updated paths accordingly.
- Made `vale` configuration fully self-contained within the extension directory, avoiding any use of the user's home directory.
- Updated `README.md` with streamlined installation instructions and corrected build paths.

## [v0.5.6] - 2026-03-06

### Fixed
- Updated `.goreleaser.yaml` to use the exact `platform.arch.name` naming pattern required by the Gemini CLI extension installer. This prevents the fallback behavior of downloading the full source code repository.

## [v0.5.5] - 2026-03-06

### Fixed
- Reverted custom `name_template` in `.goreleaser.yaml` to ensure GitHub release assets use standard OS and Architecture naming conventions (e.g. `darwin_amd64` instead of `Darwin_x86_64`). This fixes the Gemini CLI installer failing to match the pre-compiled binary and falling back to a source-code installation.

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
