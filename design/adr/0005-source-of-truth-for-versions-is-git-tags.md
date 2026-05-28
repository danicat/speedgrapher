# ADR-0005: Enforce Version Alignment to Git Tags and Extension Manifest

- **Status:** Approved
- **Date:** 2026-05-28
- **Author(s):** Antigravity
- **Deciders:** USER, Antigravity

## 1. Context
To maintain project health and extension installation integrity, the compiled `speedgrapher` binary version must *always* precisely align with the version specified in the Gemini CLI extension manifest (`gemini-extension.json`) and the active Git release tag. Mismatches during release compile or package steps will result in broken distribution packages. 

Previously, version numbers were manually hardcoded across multiple files (such as `Makefile` and source headers), leading to a high risk of version drift and installation failures during automated releases.

## 2. Decision
We declare the **Git Tag** as the absolute, single source of truth for Speedgrapher's release version, and establish a multi-layered automation pipeline to ensure binary and manifest version alignment:

1. **Manifest Alignment**:
   The `Makefile` extracts the extension manifest version directly from `gemini-extension.json` using:
   ```makefile
   VERSION ?= $(shell grep '"version":' gemini-extension.json | cut -d'"' -f4)
   ```
   This is injected as a compiler flag (`-ldflags`) to guarantee that local developer builds always report the exact manifest version.
2. **Release Validation Gate**:
   We implement a strict, multi-tiered verification step to physically block builds or CI releases if the git tag drifts from the manifest:
   - **Local target**: `make verify-version` validates tag-to-manifest alignment.
   - **GoReleaser compiler hook**: Executed as a `before.hooks` step to block snapshot or release compilation on drift.
   - **CI/CD Build Gate**: Validates version strings in `.github/workflows/release.yml` to fail the action runner immediately if the pushed tag differs from `gemini-extension.json`.

## 3. Consequences
- **Positive:**
  - Guarantees 100% version alignment between the compiled binary, the Gemini extension manifest, and the Git tag.
  - Zero-drift guarantee: Automated releases fail immediately at multiple validation layers if drift occurs.
- **Negative:**
  - Creating a release tag requires ensuring the manifest version is updated beforehand. A mismatched tag will trigger a pipeline failure, which is a desirable, safe constraint.

## 4. Compliance & Verification
- Enforced by standard CI/CD workflow execution, GoReleaser compiler hooks, and the `make verify-version` local target.
