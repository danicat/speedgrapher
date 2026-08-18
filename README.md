# Speedgrapher

Speedgrapher is a specialized agentic editorial suite and Model Context Protocol (MCP) server for technical authors, engineering bloggers, and AI agents. It delivers AST-level readability analytics, automated AI cliché ("slop") detection, multi-point technical SEO auditing, and Vale style linting.

Speedgrapher operates across three integrated surfaces powered by embedded Agent Skills:

1. **MCP Server**: Exposes 4 editorial intelligence tools (`fog`, `slop`, `analyze_seo`, `vale`) over Model Context Protocol (stdio & streamable HTTP).
2. **Headless CLI**: Provides direct subshell tool invocation (`fog`, `slop`, `seo`, `vale`) via `speedgrapher call`, alongside surface management commands (`install`, `uninstall`, `init`, `list`).
3. **Embedded Agent Skills**: Bundled operational personas and writing guides (`@deslopify`, `@inverted-pyramid`, `@tech-interviewer`, `@tech-writer`, `@tech-reviewer`, `@tech-publisher`) unpacked directly into agent workspaces.

---

## Installation

### Option A: One-Line Installer (`install.sh`)

Downloads the latest prebuilt release binary (via GoReleaser) and automatically initializes MCP registration and Agent Skills:

```bash
# Global install (Default: ~/.gemini/config)
curl -fsSL https://raw.githubusercontent.com/danicat/speedgrapher/main/install.sh | bash

# Workspace-scoped install (.agents/)
curl -fsSL https://raw.githubusercontent.com/danicat/speedgrapher/main/install.sh | bash -s -- -w
```

### Option B: Go Toolchain (`go install` + `speedgrapher install`)

```bash
# 1. Install binary
go install github.com/danicat/speedgrapher/cmd/speedgrapher@latest

# 2. Configure surfaces (registers MCP server and unpacks embedded skills)
speedgrapher install
```

#### Granular Surface Management Flags

```bash
# Configure MCP server only
speedgrapher install --mcp

# Unpack embedded Agent Skills only
speedgrapher install --skills

# Configure in current workspace scope (.agents/)
speedgrapher install -w

# Remove configuration (Global or Workspace)
speedgrapher uninstall
speedgrapher uninstall -w
```

---

## Headless CLI Manual

For agents operating in subshells or environments without native MCP integration, all tools can be invoked via JSON payloads or standard input using the `call` subcommand:

```bash
# Print help and usage
speedgrapher

# List all available editorial tools
speedgrapher list

# Run dependency & environment diagnostic health checks (Vale, Git, Hugo, Go)
speedgrapher check
speedgrapher check --json

# Initialize workspace configuration (speedgrapher.json) and workspace skills (.agents/)
speedgrapher init

# Invoke tools via CLI (fog, slop, seo, vale)
speedgrapher call fog '{"text": "The quick brown fox jumps over the lazy dog."}'
speedgrapher call slop '{"text": "In today'\''s fast-paced world, delve into the intricate tapestry of AI."}'
speedgrapher call seo '{"html": "<html><head><title>Technical Guide to MCP</title><meta name=\"description\" content=\"A deep dive into Model Context Protocol architecture, client patterns, and tool handlers.\"></head><body><h1>Technical Guide to MCP</h1><p>Content goes here...</p></body></html>", "keyword": "mcp"}'
speedgrapher call vale '{"text": "This is very unique."}'

# Pipe text directly into tool execution via stdin
cat draft.md | speedgrapher call slop
```

### MCP Server Execution

Speedgrapher can run as a standard stdio server or as a network-accessible streamable HTTP service:

```bash
# Run stdio MCP server (standard for MCP clients like Claude Code or Gemini)
speedgrapher mcp

# Run streamable HTTP MCP server
speedgrapher mcp --listen=:8080
```

---

## Available MCP Tools

| Tool | Summary |
| :--- | :--- |
| [`fog`](#fog) | Calculates the Gunning Fog Index to estimate text readability and audience classification. |
| [`slop`](#slop) | Multi-metric heuristic analyzer calculating an AI cliché / slop score (0–100). |
| [`analyze_seo`](#analyze_seo) | Comprehensive 7-point technical SEO audit for published URLs or Hugo Markdown drafts. |
| [`vale`](#vale) | Automated Vale static analysis engine verifying editorial style, grammar, and voice. |

### Tool Breakdown & Behaviors

#### `fog`
- **Parameters**: 
  - `text` (string, optional): Text to analyze for readability. Must contain at least one sentence.
  - `path` (string, optional): Path to a file containing text to analyze. Resolved against `WorkspaceDir`.
- **Behavior**:
  - Calculates the Gunning Fog Index using average sentence length (ASL) and percentage of complex words (PCW, words with 3+ syllables):
    $$\text{Fog Index} = 0.4 \times \left( \frac{\text{words}}{\text{sentences}} + 100 \times \frac{\text{complex words}}{\text{words}} \right)$$
  - Returns classification:
    - **Simplistic** ($< 9$): Accessible for elementary reading levels.
    - **General Audiences** ($9 \le \text{Index} < 13$): Clear and accessible for most readers.
    - **Professional Audiences** ($13 \le \text{Index} < 18$): Ideal for technical and engineering blogs.
    - **Hard to Read** ($18 \le \text{Index} < 22$): Requires significant cognitive effort.
    - **Unreadable** ($\ge 22$): Likely incomprehensible to general technical audiences.
  - Returns structured metrics: `fog_index`, `classification`, `total_words`, `total_sentences`, `average_sentence_length`, `percentage_complex_words`, `complex_words`.

#### `slop`
- **Parameters**:
  - `text` (string, optional): Text to analyze for AI-generated clichés and structural tropes.
  - `path` (string, optional): Path to a file containing text to analyze.
- **Behavior**:
  - Computes a weighted overall score ($0$ to $100$) across 5 calibrated analytical dimensions:
    1. **Structural Clichés (40% weight)**: Scans for distinct LLM rhetorical patterns (e.g., *"It's not X — it's Y"*, *"Not X. Not Y. Just Z."*, *"The result? Devastating."*, *"Here's the kicker"*, *"Delve into the tapestry"*, em-dash clusters).
    2. **Lexical Slop (25% weight)**: Detects overused AI buzzwords (*delve*, *tapestry*, *landscape*, *nuance*, *testament*, *beacon*, *catalyst*, *paradigm*, *robust*, *seamless*, *transformative*, *quietly*, *deeply*, *fundamentally*).
    3. **Filler Words (15% weight)**: Measures stop-word and filler ratios against natural human writing distributions.
    4. **Rhythm Variance (15% weight)**: Evaluates sentence length coefficient of variation (CV) to penalize uniform, monotonous sentence cadences.
    5. **Syntactic Voice (5% weight)**: Measures pronoun-to-noun balance via part-of-speech (POS) tagging.

#### `analyze_seo`
- **Parameters**:
  - `url` (string, optional): Full URL of the live webpage to audit.
  - `html` (string, optional): Raw HTML string or Hugo Markdown with YAML front matter.
  - `keyword` (string, optional): Target keyword to verify across title, description, and headings.
- **Behavior**:
  - Runs a 7-point technical SEO inspection:
    1. **Title Tag**: Checks presence, optimal character length ($30$–$60$ chars), and keyword placement.
    2. **Meta Description**: Checks presence, optimal length ($120$–$160$ chars), and keyword placement.
    3. **H1 Tag**: Enforces single H1 presence and keyword inclusion.
    4. **Image Alt Text**: Detects missing or empty `alt` attributes on all `<img>` elements.
    5. **Links**: Validates presence and distribution of links.
    6. **Content Length**: Assesses total body word count ($300+$ words recommended).
    7. **Canonical Tag**: Verifies `<link rel="canonical">` existence.
  - Automatically compiles Hugo Markdown with front matter using local `hugo` CLI when present.

#### `vale`
- **Parameters**:
  - `text` (string, optional): Text to analyze for grammar and editorial style.
  - `path` (string, optional): Path to markdown document.
- **Behavior**:
  - Bootstraps and executes a pinned Vale binary (v3.13.1) with SHA256 integrity checks.
  - Prioritizes project-specific `.vale.ini` in the workspace or falls back to bundled rules.
  - Respects workspace `speedgrapher.json` accept lists to suppress false positives on approved domain terms.

---

## Specialized Agent Skills

Speedgrapher bundles six specialized operational Agent Skills designed for agentic coding and technical writing workflows:

| Skill | Operational Scope | Location |
| :--- | :--- | :--- |
| **`@deslopify`** | Strips AI tropes, clichés, and structural signposting to restore authentic voice. | [`skills/deslopify/SKILL.md`](skills/deslopify/SKILL.md) |
| **`@inverted-pyramid`** | Enforces information cascading: high-impact action $\rightarrow$ usage $\rightarrow$ technical details. | [`skills/inverted-pyramid/SKILL.md`](skills/inverted-pyramid/SKILL.md) |
| **`@tech-interviewer`** | Brainstorming persona extracting raw logs, errors, and breakthrough narratives before outlining. | [`skills/tech-interviewer/SKILL.md`](skills/tech-interviewer/SKILL.md) |
| **`@tech-writer`** | Drafting specialist adapting to author voice with grounded code examples and citations. | [`skills/tech-writer/SKILL.md`](skills/tech-writer/SKILL.md) |
| **`@tech-reviewer`** | Quality gate specialist evaluating drafts against `fog`, `slop`, and `vale` with indexed suggestions. | [`skills/tech-reviewer/SKILL.md`](skills/tech-reviewer/SKILL.md) |
| **`@tech-publisher`** | Final checklist specialist handling SEO audits, translation boundaries, and publication plans. | [`skills/tech-publisher/SKILL.md`](skills/tech-publisher/SKILL.md) |

---

## Developer Instructions

### Local Development

Compile the server binary to `bin/speedgrapher`:
```bash
make build
```

Run test suite across all packages:
```bash
make test
```

Generate test coverage report:
```bash
make test-cov
```

### Releasing

Speedgrapher relies on Git tags for versioning. Build versions are dynamically injected at compile time:

```bash
# 1. Create and push release tag
make bump-version VERSION=0.8.0
git push origin v0.8.0

# 2. Test release packaging locally
make snapshot

# 3. Trigger production release via GoReleaser
make release
```

---

## Architecture Decision Records (ADRs)

Core architectural choices are documented under [`design/adr/`](design/adr/):

- **[ADR-0001: Record architecture decisions](design/adr/0001-record-architecture-decisions.md)**: Establishes the ADR system.
- **[ADR-0002: Automated Vale bootstrapping](design/adr/0002-automated-vale-bootstrapping.md)**: Runtime downloader and SHA256 verification gate for Vale.
- **[ADR-0003: Stdio model context protocol transport](design/adr/0003-stdio-model-context-protocol-transport.md)**: Process isolation and stream transport.
- **[ADR-0004: Evolutionary documentation](design/adr/0004-replace-changelog-with-evolutionary-documentation.md)**: Transition from manual changelog to git tags and ADRs.
- **[ADR-0005: Enforce version alignment](design/adr/0005-source-of-truth-for-versions-is-git-tags.md)**: Git tag source of truth for version metadata.

---

## License

This project is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.

## References

- [Model Context Protocol Specification](https://modelcontextprotocol.io/specification/2025-06-18)
- [Official Go SDK for MCP](https://github.com/modelcontextprotocol/go-sdk)
- [Tropes.fyi Cliché Database](https://tropes.fyi/)
- [Vale Linter](https://vale.sh/)
