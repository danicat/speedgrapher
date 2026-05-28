![logo](logo.jpeg)

# Speedgrapher

> This is not an officially supported Google product.

Speedgrapher is a Model Context Protocol (MCP) server that helps you write better technical articles. It runs style checks, readability tests, and automated editorial reviews right from your terminal.

## User Instructions

### Installation

#### Gemini CLI
Install Speedgrapher as a Gemini CLI extension to automatically compile the binary, configure the MCP server, and register all editorial personas:

```bash
gemini extensions install https://github.com/danicat/speedgrapher
```

#### Antigravity CLI
Install the Gemini CLI extension, then import into `agy`:

```bash
# Step 1: install the extension
gemini extensions install https://github.com/danicat/speedgrapher

# Step 2: import into Antigravity CLI
agy plugin import gemini
```

#### Claude Code
1. Install the binary globally:
   ```bash
   go install github.com/danicat/speedgrapher/cmd/speedgrapher@latest
   ```
2. Register the MCP server:
   ```bash
   claude mcp add --transport stdio --scope user speedgrapher -- speedgrapher
   ```

### Usage Instructions

Speedgrapher runs automatically in the background of your agent-compatible client. The client agent discovers and calls the exposed tools during writing and editing tasks.

#### Configuration (Command-line Flags)

| Flag | Description | Default |
| :--- | :--- | :--- |
| `--editorial` | Path to the editorial guidelines file. | `EDITORIAL.md` |
| `--localization` | Path to the localization guidelines file. | `LOCALIZATION.md` |
| `--version` | Prints the version and exits. | `false` |

### Features and Tools

* **Gunning Fog Index (`fog`)**: Evaluates text readability to ensure the content matches general or professional readers.
* **Slop Score (`slop`)**: Grades text from 0 to 100 by counting overused LLM clichés (for example, "delve" or "tapestry"). Lower scores mean more natural, human writing. The slop score matches clichés against the database at [tropes.fyi](https://tropes.fyi/).
* **Vale Static Analysis (`vale`)**: Analyzes style guidelines and grammar. Speedgrapher automatically downloads and verifies a secure, pinned version of `vale` (v3.13.1) during its first execution.
* **SEO Audit (`analyze_seo`)**: Performs technical SEO analysis on a URL or raw HTML (including Hugo Markdown with front matter). Checks title tags, meta descriptions, H1 structure, image alt text, links, content length, and canonical tags.

### Editorial Personas

When you install Speedgrapher as a Gemini CLI extension, it registers four expert personas to guide you through drafting and polishing:

* **`tech-interviewer`**: Interviews you about your technical topic to extract raw logs, error messages, and core lessons. It then drafts a solid structural outline.
* **`tech-writer`**: Drafts the article with you, focusing on a clear, conversational narrative voice that follows cozy web principles.
* **`tech-reviewer`**: Audits the draft against editorial guidelines using analytical tools to flag style issues, readability scores, and AI slop patterns.
* **`tech-publisher`**: Audits page SEO, manages article localization, and runs final checks before publication.

### Interactive Prompts (Slash Commands)

Run these commands in the terminal to execute workflows:

| Command | Description |
| --- | --- |
| `/interview` | Starts an interview to extract raw details for your post. |
| `/review` | Audits the current article draft using `fog`, `slop`, and `vale`. |
| `/readability` | Displays a quick Fog Index readability report for the last generated text. |

## Developer Instructions

### Prerequisites

* [Go](https://go.dev/doc/install) 1.24 or later
* [GoReleaser](https://goreleaser.com/install/) (for release distribution packaging)

### Building

Build the project from source using the Makefile:
```bash
git clone https://github.com/danicat/speedgrapher.git
cd speedgrapher
make build
```
This compiles the server binary to `bin/speedgrapher`.

To install the binary globally to your `$GOPATH/bin`:
```bash
make install
```

### Testing

Run the test suite:
```bash
make test
```

To run tests and generate a coverage report:
```bash
make test-cov
```

### Running Locally

Run the compiled binary directly to test behavior:
```bash
./bin/speedgrapher
```

Check the version:
```bash
./bin/speedgrapher --version
```

### Releasing

Speedgrapher relies on Git tags for versioning. Build versions are dynamically injected at compile time using `git describe`.

To release a new version:

1. Update the version string in `gemini-extension.json`:
   ```bash
   make bump-version VERSION=0.7.0
   ```

2. Commit the manifest changes:
   ```bash
   git add gemini-extension.json
   git commit -m "chore: bump version to 0.7.0"
   ```

3. Create and push a new Git tag:
   ```bash
   git tag v0.7.0
   git push origin v0.7.0
   ```

The release pipeline will automatically run GoReleaser when a new tag is pushed.

To test the GoReleaser configuration locally, generate a snapshot release:
```bash
make snapshot
```

## Development Architecture

Key technical choices are recorded using the Architecture Decision Record (ADR) framework under the `/design/adr` directory:

1. **[ADR-0001: Record Architecture Decisions](design/adr/0001-record-architecture-decisions.md)**: Establishes the ADR system and retires the manual changelog.
2. **[ADR-0002: Automated Vale Bootstrapping](design/adr/0002-automated-vale-bootstrapping.md)**: Details the runtime dynamic downloader and SHA256 verification gate for the `vale` binary.
3. **[ADR-0003: Stdio Model Context Protocol Transport](design/adr/0003-stdio-model-context-protocol-transport.md)**: Records the security and isolation choices for using standard streams over network sockets.
4. **[ADR-0004: Replace Changelog with Evolutionary Documentation](design/adr/0004-replace-changelog-with-evolutionary-documentation.md)**: Solidifies the transition from manual files to git tag records and ADR histories.
5. **[ADR-0005: Enforce Version Alignment to Git Tags and Extension Manifest](design/adr/0005-source-of-truth-for-versions-is-git-tags.md)**: Details the three-tiered verification gate (Makefile, GoReleaser hooks, and CI/CD steps) that blocks version drift during release cycles.

## License

This project is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.

## References
*   **Model Context Protocol Specification:** [https://modelcontextprotocol.io/specification/2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18)
*   **Go SDK for MCP:** [https://github.com/modelcontextprotocol/go-sdk](https://github.com/modelcontextprotocol/go-sdk)
*   **How to build an MCP server with Gemini CLI and Go:** [https://danicat.dev/posts/20250729-how-to-build-an-mcp-server-with-gemini-cli-and-go/](https://danicat.dev/posts/20250729-how-to-build-an-mcp-server-with-gemini-cli-and-go/)
