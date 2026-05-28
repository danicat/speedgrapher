# Speedgrapher

> This is not an officially supported Google product.

Speedgrapher is a Model Context Protocol (MCP) server that helps you write better technical articles. It runs style checks, readability tests, and automated editorial reviews from your terminal.

## User instructions

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

### Usage instructions

Speedgrapher runs in the background of your agent-compatible client. The client agent discovers and calls the exposed tools during writing and editing tasks.

#### Configuration (command-line flags)

| Flag | Description | Default |
| :--- | :--- | :--- |
| `--editorial` | Path to the editorial guidelines file. | `EDITORIAL.md` |
| `--localization` | Path to the localization guidelines file. | `LOCALIZATION.md` |
| `--version` | Prints the version and exits. | `false` |

### Features and tools

* **Gunning Fog Index (`fog`)**: evaluates text readability to ensure the content matches general or professional readers.
* **Slop score (`slop`)**: grades text from 0 to 100 by counting overused LLM clichés (for example, "delve" or "tapestry"). Lower scores mean more natural, human writing. The slop score matches clichés against the database at [tropes.fyi](https://tropes.fyi/).
* **Vale static analysis (`vale`)**: analyzes style guidelines and grammar. Speedgrapher automatically downloads and verifies a secure, pinned version of `vale` (v3.13.1) during its first execution.
* **SEO audit (`analyze_seo`)**: performs technical SEO analysis on a URL or raw HTML (including Hugo Markdown with front matter). Checks title tags, meta descriptions, H1 structure, image alt text, links, content length, and canonical tags.

### Editorial personas

When you install Speedgrapher as a Gemini CLI extension, it registers four expert personas to guide you through drafting and polishing:

* **`tech-interviewer`**: interviews you about your technical topic to extract raw logs, error messages, and core lessons. It then drafts a structural outline.
* **`tech-writer`**: drafts the article with you, focusing on a clear, conversational narrative voice that follows cozy web principles.
* **`tech-reviewer`**: audits the draft against editorial guidelines using analytical tools to flag style issues, readability scores, and AI slop patterns.
* **`tech-publisher`**: audits page SEO, manages article localization, and runs final checks before publication.

### Interactive prompts (slash commands)

Run these commands in the terminal to execute workflows:

| Command | Description |
| --- | --- |
| `/interview` | Starts an interview to extract raw details for your post. |
| `/review` | Audits the article draft using `fog`, `slop`, and `vale`. |
| `/readability` | Displays a quick Fog Index readability report for the last generated text. |

## Developer instructions

### Prerequisites

* [Go](https://go.dev/doc/install) 1.24 or later
* [GoReleaser](https://goreleaser.com/install/) for release distribution packaging

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

### Running locally

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
   make bump-version VERSION=0.8.0
   ```

2. Commit the manifest changes:
   ```bash
   git add gemini-extension.json
   git commit -m "chore: bump version to 0.8.0"
   ```

3. Create and push a new Git tag:
   ```bash
   git tag v0.8.0
   git push origin v0.8.0
   ```

The release pipeline automatically runs GoReleaser when you push a new tag.

To test the GoReleaser configuration locally, generate a snapshot release:
```bash
make snapshot
```

## Development architecture

Key technical choices are recorded using the Architecture Decision Record (ADR) framework under the `/design/adr` directory:

1. **[ADR-0001: Record architecture decisions](design/adr/0001-record-architecture-decisions.md)**: establishes the ADR system and retires the manual changelog.
2. **[ADR-0002: Automated Vale bootstrapping](design/adr/0002-automated-vale-bootstrapping.md)**: details the runtime dynamic downloader and SHA256 verification gate for the `vale` binary.
3. **[ADR-0003: Stdio model context protocol transport](design/adr/0003-stdio-model-context-protocol-transport.md)**: records the security and isolation choices for using standard streams over network sockets.
4. **[ADR-0004: Replace changelog with evolutionary documentation](design/adr/0004-replace-changelog-with-evolutionary-documentation.md)**: solidifies the transition from manual files to git tag records and ADR histories.
5. **[ADR-0005: Enforce version alignment to git tags and extension manifest](design/adr/0005-source-of-truth-for-versions-is-git-tags.md)**: details the three-tiered verification gate that blocks version drift during release cycles.
6. **[ADR-0006: Project-wide deslopification standards](design/adr/0006-project-wide-deslopification-standards.md)**: establishes professional writing standards and the use of internal tools to eliminate AI slop.

## License

This project is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.

## References
*   **Model Context Protocol specification:** [https://modelcontextprotocol.io/specification/2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18)
*   **Go SDK for MCP:** [https://github.com/modelcontextprotocol/go-sdk](https://github.com/modelcontextprotocol/go-sdk)
*   **How to build an MCP server with Gemini CLI and Go:** [https://danicat.dev/posts/20250729-how-to-build-an-mcp-server-with-gemini-cli-and-go/](https://danicat.dev/posts/20250729-how-to-build-an-mcp-server-with-gemini-cli-and-go/)
