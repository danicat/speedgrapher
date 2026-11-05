# Contributing to Speedgrapher

Thank you for your interest in contributing to Speedgrapher! We welcome bug reports, feature requests, documentation improvements, and pull requests.

## Code of Conduct

All contributors and participants are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Development Setup

Speedgrapher consists of a Go CLI / MCP server and an Antigravity sidecar panel:

1. **Prerequisites**:
   - Go 1.23+
   - Node.js 20+
   - [Vale](https://vale.sh) (optional for grammar/style linting)
2. **Build and Test**:
   ```bash
   make build
   make test
   make check
   ```

## Pull Request Guidelines

1. **Branching**: Create feature branches off `main`.
2. **Tests**: Ensure all existing tests pass (`go test ./...`) and add new tests for any added features or bug fixes.
3. **Licensing**: All new source files must include the appropriate Apache-2.0 license header. You can check this by running `make license-check`.
4. **Clean Commits**: Keep commit messages concise, descriptive, and imperative (e.g., `fix(seo): prevent SSRF on local IP redirects`).
