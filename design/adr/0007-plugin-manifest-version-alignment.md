# ADR-0007: Plugin Manifest Version Alignment

- **Status:** Approved
- **Date:** 2026-07-14
- **Author(s):** Antigravity
- **Deciders:** USER, Antigravity

## 1. Context
To maintain project health and installation integrity within the new Antigravity plugin ecosystem, the compiled `speedgrapher` binary version must precisely align with the version specified in the `plugin.json` manifest and the active Git release tag. The previous extension manifest (`gemini-extension.json`) has been deprecated in favor of `plugin.json`.

## 2. Decision
We declare the **Git Tag** as the absolute, single source of truth for Speedgrapher's release version. We transition from the deprecated `gemini-extension.json` format to the standard `plugin.json` format for maintaining manifest alignment.

## 3. Consequences
- **Positive Consequences (What we gain):** Seamless integration with the new Antigravity plugin structure and improved clarity of the release process.
- **Negative Consequences (What we lose or must accept):** Deprecation of the older `gemini-extension.json` format, requiring developers to update their release commands.
- **Neutral Consequences:** Minor restructuring of the manifest file.

## 4. Compliance & Verification
- Enforced by standard CI/CD workflow execution, GoReleaser compiler hooks, and local verification targets using the new `plugin.json`.
