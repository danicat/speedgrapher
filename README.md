![logo](logo.jpeg)

# Speedgrapher

> This is not an officially supported Google product.

Speedgrapher is a local MCP server written in Go, designed to assist writers by providing a suite of tools to streamline the writing process.

## Modernized Workflow with Editorial Skills

Speedgrapher has been modernized to utilize specialized AI skills that encapsulate the editorial process. Instead of multiple slash commands, you can now interact with four expert personas:

*   **`tech-interviewer`**: Your brainstorming partner. Use it to flesh out ideas, collect data, and generate structured outlines.
*   **`tech-writer`**: Your drafting companion. It focuses on style, voice alignment, and narrative flow following the "cozy web" principles.
*   **`tech-reviewer`**: Your quality gate. It uses analytical tools (`fog`, `slop`, `vale`) to ensure your article is readable, authentic, and professional.
*   **`tech-publisher`**: Your final checklist expert. It handles SEO audits, localization, and prepares a publication plan.

## Available Tools

### Gunning Fog Index (`fog`)
Calculates a readability score. Aim for "General" or "Professional" audience levels.

### Slop Score (`slop`)
Calculates a "slop score" (0-100) to detect common AI clichés (like "delve", "tapestry"). Lower scores indicate more natural, human-like writing.

### Vale Static Analysis (`vale`)
Runs `vale` to check for style and grammar issues.

## Available Prompts (Slash Commands)

The following essential commands are retained for direct action:

| Command | Description |
| --- | --- |
| `/interview` | Starts a structured interview to gather material for a post. |
| `/review` | Performs a comprehensive review using `fog`, `slop`, and `vale`. |
| `/readability` | Quick check of the Fog Index for the last generated text. |

## Development

### Prerequisites

*   [Go](https://go.dev/doc/install) 1.24 or later
*   [Goreleaser](https://goreleaser.com/install/) (for building distributions)
*   [Vale](https://vale.sh/docs/vale-cli/installation/) (for the static analysis tool)

### Building and Testing

The project uses a `Makefile` to manage common development tasks.

*   **Build:** Creates an executable at `bin/speedgrapher`.
    ```bash
    make build
    ```
*   **Test:** Runs the Go test suite.
    ```bash
    make test
    ```
*   **Clean:** Removes the `bin` and `dist` directories.
    ```bash
    make clean
    ```

## Installation & Setup

### 1. Install the MCP Server

You can build the server from source or use the released binaries.

**From Source:**
```sh
make build
make install
```

**Using Pre-built Binaries:**
Download the appropriate archive for your operating system from the GitHub Releases page, extract it, and place the `speedgrapher` binary in your path.

### 2. Configure Gemini CLI

Add this configuration to your `.gemini/settings.json`, pointing the `command` to where the `speedgrapher` binary is located:

```json
{
    "mcpServers": {
        "speedgrapher": {
            "command": "speedgrapher"
        }
    }
}
```

### 3. Install the SkillTo enable the specialized editorial workflow, install the accompanying skills into your Gemini CLI. Navigate to the `skills/` directory and install them:

```bash
gemini skills install skills/tech-interviewer --scope user
gemini skills install skills/tech-writer --scope user
gemini skills install skills/tech-reviewer --scope user
gemini skills install skills/tech-publisher --scope user
```
fter installation, reload your skills in the interactive CLI: `/skills reload`.

## Release & Distribution

Speedgrapher uses **Goreleaser** to build, package, and publish cross-platform binaries.

*   **Test a Release Locally (Snapshot):** Builds and packages the binaries into the `dist/` folder without publishing.
    ```bash
    make snapshot
    ```
*   **Publish a Release:** When you are ready to publish a new version:
    1.  Bump the version in the `Makefile`.
    2.  Create and push a new Git tag:
        ```bash
        git tag v0.5.0
        git push origin v0.5.0
        ```
    3.  Run the release command (requires a `GITHUB_TOKEN` environment variable):
        ```bash
        make release
        ```
