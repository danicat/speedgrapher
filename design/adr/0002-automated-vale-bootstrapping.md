# ADR-0002: Automated Vale Bootstrapping

- **Status:** Approved
- **Date:** 2026-05-28
- **Author(s):** Antigravity
- **Deciders:** USER, Antigravity

## 1. Context
Speedgrapher integrates the Vale static analysis tool to check article text for style and grammar. Vale requires a compiled binary matching the host operating system and architecture. Relying on users to manually install Vale can result in version mismatches, installation failures, and a high barrier to entry.

## 2. Decision
We implement a fully automated Vale bootstrapper directly in Go (`internal/tools/vale/bootstrap.go`).
- Speedgrapher pins Vale version `3.13.1`.
- At runtime, if Vale is not present in the extension directory, Speedgrapher queries the OS and architecture, downloads the correct precompiled asset from GitHub, validates its SHA256 checksum against a hardcoded manifest, and extracts it to the local execution path.
- Alternatives considered:
  - *System dependency*: Discarded because of manual install friction.
  - *Bundling binary inside git repository*: Discarded because it severely inflates the repository size and complicates multi-platform distribution.

## 3. Consequences
- **Positive:**
  - Zero-configuration setup: users don't need to manually download or install Vale.
  - Absolute correctness: guarantees the exact pinned version (`3.13.1`) is used.
  - Security: SHA256 checksum verification prevents untrusted execution.
- **Negative:**
  - Network dependency: the first run requires active internet access to pull the binary.
  - Latency: first execution experiences a startup delay during download/extraction.

## 4. Compliance & Verification
- Verified by unit tests and integration tests in the `internal/tools/vale` package.
