# ADR-0001: Record Architecture Decisions

- **Status:** Approved
- **Date:** 2026-05-28
- **Author(s):** Antigravity
- **Deciders:** USER, Antigravity

## 1. Context
As the Speedgrapher project grows and evolves, it is critical to capture the technical context, forces, and trade-offs behind our architectural choices. Without a structured way to record these decisions, future maintainers may suffer from context loss (the "Chesterton's Fence" problem) or revisit previously discarded alternatives without knowing why they were rejected.

Previously, version history was tracked in a manual `CHANGELOG.md` file, which is prone to being outdated, does not capture technical rationale, and lacks detail on architectural consequences.

## 2. Decision
We will use lightweight Architecture Decision Records (ADRs) to document key technical decisions that are difficult to change. 

- ADRs will be stored in `design/adr/` as plain text Markdown files.
- Files will be named sequentially: `NNNN-short-descriptive-title.md` (e.g. `0001-record-architecture-decisions.md`).
- ADRs are an immutable log: once approved and committed, they are never edited. New decisions will supersede old ones via new ADR records.
- We will retire `CHANGELOG.md` completely. Technical evolutionary history will be driven by ADRs and RFCs.

## 3. Consequences
- **Positive:**
  - Preserves technical context, trade-offs, and rejected options for future maintainers.
  - Reduces cognitive load when onboarding or refactoring.
  - Eliminates the outdated and redundant `CHANGELOG.md` file.
- **Negative:**
  - Requires developers to spend a small amount of time writing and reviewing ADRs when major architectural shifts occur.

## 4. Compliance & Verification
- Enforced by peer code review and repository file audit during development.
