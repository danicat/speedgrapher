![logo](logo.jpeg)

# Speedgrapher

> This is not an officially supported Google product.

Speedgrapher is a local MCP server that helps you write better technical articles. It runs style checks, readability tests, and automated editorial reviews right from your terminal.

## Editorial Personas

When you install Speedgrapher as a Gemini CLI extension, it registers four expert personas to guide you through drafting and polishing:

* **`tech-interviewer`**: Interviews you about your technical topic to extract raw logs, error messages, and core lessons, drafting a solid structural outline.
* **`tech-writer`**: Drafts the article with you, focusing on a clear, conversational narrative voice that follows cozy web principles.
* **`tech-reviewer`**: Audits the draft against editorial guidelines using analytical tools to flag style issues, readability scores, and AI slop patterns.
* **`tech-publisher`**: Audits page SEO, manages article localization, and runs final checks before publication.

## Built-in Tools

* **Gunning Fog Index (`fog`)**: Evaluates text readability to ensure the content matches general or professional readers.
* **Slop Score (`slop`)**: Grades text from 0 to 100 by counting overused LLM clichés (e.g., "delve", "tapestry"). Lower scores mean more natural, human writing. Clichés are matched against [tropes.fyi](https://tropes.fyi/).
* **Vale Static Analysis (`vale`)**: Analyzes style guidelines and grammar. Speedgrapher automatically downloads and verifies a secure, pinned version of `vale` (v3.13.1) during its first execution.

## Interactive Prompts (Slash Commands)

Run these commands in the terminal to execute workflows:

| Command | Description |
| --- | --- |
| `/interview` | Starts an interview to extract raw details for your post. |
| `/review` | Audits the current article draft using `fog`, `slop`, and `vale`. |
| `/readability` | Displays a quick Fog Index readability report for the last generated text. |

## Installation & Setup

The easiest way to use Speedgrapher is as a **Gemini CLI extension**. This automatically installs the compiled binary, registers the MCP server, and configures the editorial skills.

### 1. Install as an Extension

Run this command in your terminal:

```bash
gemini extensions install https://github.com/danicat/speedgrapher
```

### 2. Local Manual Installation

If you are developing locally or prefer manual control:

#### A. Compile and Install the Binary
Install the `speedgrapher` binary to your `$GOPATH/bin`:

```bash
make install
```

#### B. Register MCP Server
Add this configuration to your `~/.gemini/settings.json`:

```json
{
    "mcpServers": {
        "speedgrapher": {
            "command": "$HOME/<path to your speedgrapher directory>/bin/speedgrapher"
        }
    }
}
```

#### C. Register Editorial Skills
Install each skill from the `skills/` directory:

```bash
gemini skills install skills/tech-interviewer --scope user
gemini skills install skills/tech-writer --scope user
gemini skills install skills/tech-reviewer --scope user
gemini skills install skills/tech-publisher --scope user
```
After registering, reload the active session with `/skills reload`.

## Development

### Prerequisites

* [Go](https://go.dev/doc/install) 1.24 or later
* [Goreleaser](https://goreleaser.com/install/) (for release distribution packaging)

### Build Commands

The project uses a `Makefile` to handle common tasks:

* **Build executable**: Compiles a local `speedgrapher` executable in the root directory.
  ```bash
  make build
  ```
* **Run tests**: Runs the entire Go test suite.
  ```bash
  make test
  ```
* **Clean workspace**: Removes local binaries and temporary build directories.
  ```bash
  make clean
  ```

## License
This project is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.

## References
*   **Model Context Protocol Specification:** [https://modelcontextprotocol.io/specification/2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18)
*   **Go SDK for MCP:** [https://github.com/modelcontextprotocol/go-sdk](https://github.com/modelcontextprotocol/go-sdk)
*   **How to build an MCP server with Gemini CLI and Go:** [https://danicat.dev/posts/20250729-how-to-build-an-mcp-server-with-gemini-cli-and-go/](https://danicat.dev/posts/20250729-how-to-build-an-mcp-server-with-gemini-cli-and-go/)

