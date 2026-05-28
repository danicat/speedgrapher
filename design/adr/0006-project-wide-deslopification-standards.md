# ADR-0006: Project-wide deslopification standards

- **Status:** Approved
- **Date:** 2026-05-28
- **Author(s):** Gemini CLI
- **Deciders:** USER, Gemini CLI

## 1. Context

AI-generated text often contains predictable patterns, overused clichés, and structural rigidities (commonly referred to as "AI slop"). As a project dedicated to improving technical writing quality, Speedgrapher must lead by example. The previous prompts and skill definitions contained Title Case headings, passive voice, and numerous AI tropes that reduced their professional impact.

## 2. Decision

We will implement and maintain "deslopification" standards across all project assets, including source code prompts, skill definitions, and user-facing documentation.

- **Sentence case headings:** All headings must use sentence-style capitalization (for example, "Reference material" instead of "Reference Material").
- **Active voice:** Prefer active voice over passive voice to improve clarity and directness.
- **Minimal slop:** Actively scan and remove LLM clichés like "delve", "tapestry", and "it's worth noting".
- **Readability:** Aim for a Gunning Fog Index of 16 or lower (Professional or General audience) for all internal prompts and documentation.
- **Google style compliance:** Follow the Google Developer Documentation Style Guide, specifically regarding contractions, Latin abbreviations, and avoiding "Let's".

## 3. Consequences

- **Positive:**
  - Improves the professional tone and authority of the project.
  - Demonstrates the effectiveness of the project's own tools (fog, slop, vale).
  - Enhances readability for the target audience of developers and engineers.
- **Negative:**
  - Requires ongoing manual or automated review of new prompts and documentation to prevent slop re-entry.

## 4. Compliance and verification

- All skill files in `skills/` and prompt strings in `internal/prompts/` were refactored to meet these standards in v0.8.0.
- Future changes must pass Speedgrapher's internal `fog`, `slop`, and `vale` checks during the release quality gate.
