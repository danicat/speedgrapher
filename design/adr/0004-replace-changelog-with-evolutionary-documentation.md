# ADR-0004: Replace Changelog with Evolutionary Documentation

- **Status:** Approved
- **Date:** 2026-05-28
- **Author(s):** Antigravity
- **Deciders:** USER, Antigravity

## 1. Context
Maintaining a manual `CHANGELOG.md` file introduces development overhead and is prone to becoming outdated. Changelogs only describe *what* changed at a surface level, but fail to explain the architectural design forces, trade-offs, and decisions behind those changes. 

To create a high-quality, maintainable, and self-documenting project history, we need a better evolutionary documentation framework.

## 2. Decision
We will retire `CHANGELOG.md` completely. All historical context and decisions will be captured using the Architecture Decision Record (ADR) and Request for Comments (RFC) frameworks.
- Git commit logs and release tags will serve as the factual record of version releases.
- ADRs in `design/adr/` will document accepted, immutable design decisions.
- RFCs in `design/rfc/` will capture exploratory design options and feature proposals.

## 3. Consequences
- **Positive:**
  - Prevents the documentation from falling out of sync with actual codebase features (a common problem with manual changelogs).
  - Shifts developer focus from listing individual files changed to documenting structural architectural reasoning.
- **Negative:**
  - Standard changelog parses (e.g. tools that automatically scrap `CHANGELOG.md`) will no longer find a changelog file. However, git tag histories and releases provide a cleaner, automated alternative.

## 4. Compliance & Verification
- Confirmed by removing `CHANGELOG.md` from the workspace and updating `.goreleaser.yaml` to prevent reference to the deleted file.
