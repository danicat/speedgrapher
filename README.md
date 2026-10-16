# `Speedgrapher` technical writing assistant and MCP server

![Speedgrapher logo: technical writing assistant and MCP server for Antigravity](assets/logo.svg)

`Speedgrapher` is an open source technical writing assistant for Antigravity. It pairs a side-panel Markdown editor with a [Model Context Protocol](https://modelcontextprotocol.io) server and five writing skills. You can read, edit, and review Markdown drafts in the side panel while your agent checks prose clarity, cuts corporate buzzwords and AI clichés, and audits search tags.

You get three pieces in one Go and Node.js package:

- **Four-mode side panel**: Switch between **Reader**, **Editor**, **Reviewer**, and **Raw** modes. You can read clean previews, edit blocks in place, resolve inline notes, or edit raw Markdown source.
- **Four MCP checks**: Run `fog`, `slop`, `vale`, and `seo` from your agent or shell. These tools score Gunning Fog grade level, AI slop tropes, [Vale](https://vale.sh) style rules, and search tags.
- **Five writing skills**: Guide your agent from early notes to final release with `speedgrapher`, `ideate`, `draft`, `readability`, and `publish`, backed by workspace rules in [`rules/AGENTS.md`](rules/AGENTS.md).

---

## Quick start

### 1. Prerequisites

Install three tools on your machine before you build the plugin:

- **Go 1.26 or newer** to compile the `speedgrapher` binary.
- **Node.js 20 or newer** to run the sidecar panel.
- **[Vale](https://vale.sh) v3** on your `$PATH` so the `vale` tool can lint your prose. Install it with `brew install vale` or `go install github.com/errata-ai/vale/v3/cmd/vale@latest`.

### 2. Build and install the plugin

Clone the repository and install the plugin into your local folder:

```bash
git clone https://github.com/danicat/speedgrapher.git
cd speedgrapher
make install-plugin
```

This step builds `bin/speedgrapher`, installs `speedgrapher` to `$GOPATH/bin`, and copies the plugin files into `~/.gemini/config/plugins/speedgrapher`.

### 3. Turn it on in Antigravity

Open **Customizations** in the left sidebar and click the **Installed** tab. Find `Speedgrapher` and switch it **On**. That single toggle starts the MCP server, loads the five writing skills, and registers the side panel for your workspace.

### 4. Open a Markdown file

Click the `[Speedgrapher](sidecar://speedgrapher/panel/)` pill in chat, or type `/speedgrapher` at any time. When a pill links to a path with `?file=/absolute/path/to/file.md`, the side panel loads that file from disk right away.

---

## Side-panel workspace modes

Switch between four views with the **`[ Reader | Editor | Reviewer | Raw ]`** toggle in the top bar. Dark and light themes match your workspace.

### 1. Reader mode

Reader mode is the default view when you open a file. It renders images, tables, code blocks, alerts, task lists, math, and YAML or TOML front matter cards without highlights or inline notes in the body.

Hover over any paragraph and click **`💬 Comment`** to open the comment popup window. If that paragraph already has notes, the popup loads them so you can edit or resolve them. On disk, `Speedgrapher` writes notes right below the paragraph as `<!-- review: ... -->` HTML comments so your feedback travels with Git commits. Click **`Send Comments`** in the top bar to stage AI rewrites in the panel, or click **`💬 Send to Main Chat`** when you want your main chat agent to read the text.

### 2. Editor mode

Click any block in Editor mode to edit its Markdown in place. Press `⌘Z` to undo, or press `⌘Y` and `⇧⌘Z` to redo your changes.

Toggle the four **Editorial Lenses** in the center toolbar to view `Heatmap`, `Slop`, `Vale`, and `Fog` highlights. When `Heatmap` is on, paragraph backgrounds tint across a seven-color scale from `pristine` green to `bad` red based on their combined scores. Click any paragraph's score pill to inspect a breakdown for that block.

Hover over any highlighted phrase to open a **Before and after fix preview**. From that card, you can apply a suggested fix in one click, run **`✨ Rewrite with AI`**, or compare three rewrites in a **`3-Angle Variant Tournament`**. In-panel AI actions use `Speedgrapher`'s built-in Gemini or Vertex AI client and stage **`✓ Accept Change`** and **`✕ Reject`** diff cards in memory without writing to disk until you accept a change. If a [Vale](https://vale.sh) rule is too noisy for your project, click **`Mute Rule`** or **`+ Add to Vocab`** on the alert card, or open **`⚙️` Settings** to manage AI models, rules, and custom vocabulary terms.

For blog posts and web docs, click **`SEO & GEO`** in the top bar to open the search audit popover. You can compare your human `summary` teaser against your search `description` tag, switch between `Auto`, `Doc`, and `Web Page` profiles, inspect the SEO and GEO checklists, and run **`Fix SEO`** to stage front matter updates.

### 3. Reviewer mode

Reviewer mode locks direct text editing. It displays all `<!-- review: ... -->` comment threads inline below their paragraphs alongside the `Heatmap`, `Slop`, `Vale`, and `Fog` lenses. You can add or edit review notes, resolve finished threads in one click, or click **`Send Comments`** to stage AI fixes for every open note.

### 4. Raw mode

Raw mode opens the full Markdown source in a single plain-text editor, including YAML or TOML front matter and raw HTML comment tags, with live disk sync and `⌘Z` or `⌘Y` undo and redo.

---

## MCP server and command-line tool

### Start the MCP server

Antigravity starts `speedgrapher mcp` for you through [`mcp_config.json`](mcp_config.json). You can also run the stdio server or check the binary version in your shell:

```bash
# Start the stdio Model Context Protocol server
speedgrapher mcp

# Print the installed speedgrapher version
speedgrapher version
```

| MCP tool | Target score | What the tool checks |
| :--- | :--- | :--- |
| **`fog`** | **11 to 15** | Computes file and per-paragraph Gunning Fog scores, complex word spans, undefined acronyms, and corporate jargon counts. |
| **`slop`** | **Under 20** | Scores canned phrases, AI buzzwords, filler words, sentence rhythm, and passive voice on a 0 to 100 scale, tuned on pre-2021 human prose. |
| **`vale`** | **0 warnings** | Lints grammar and style with [Vale](https://vale.sh) using the bundled `Google`, `proselint`, and `write-good` rule sets. |
| **`seo`** | **85 or higher** | Audits titles, `summary` versus `description` tags, lead blocks, heading order, image `alt` text, and links for web pages and docs. |

### Run checks from your shell

Use the `speedgrapher` command-line tool in local scripts or build checks:

```bash
# Run fog, slop, vale, and seo in one command and print a combined JSON report
speedgrapher audit '{"path": "/absolute/path/to/article.md", "keyword": "mcp server"}'

# Call single MCP tools from the command line
speedgrapher call fog '{"path": "/absolute/path/to/article.md"}'
speedgrapher call slop '{"path": "/absolute/path/to/article.md"}'
speedgrapher call vale '{"path": "/absolute/path/to/article.md"}'
speedgrapher call seo '{"path": "/absolute/path/to/article.md", "doc_type": "page", "keyword": "mcp server"}'
```

---

## Writing skills

`Speedgrapher` ships with five skills in [`skills/`](skills/) that support you through every writing stage:

| Skill | How it helps you | Skill file |
| :--- | :--- | :--- |
| **`speedgrapher`** | Opens the side panel in Reader, Editor, Reviewer, or Raw mode, handles inline review notes, and routes tasks across the writing skills. | [`skills/speedgrapher/SKILL.md`](skills/speedgrapher/SKILL.md) |
| **`ideate`** | Interviews you one question at a time to gather real logs and trade-offs. Then it outlines blog posts, `README.md` files, and `SKILL.md` files with the inverted pyramid. | [`skills/ideate/SKILL.md`](skills/ideate/SKILL.md) |
| **`draft`** | Turns outlines and notes into clear prose that matches your voice, opens with a 150-word outcome lead, and explains *why* before *how* around code blocks. | [`skills/draft/SKILL.md`](skills/draft/SKILL.md) |
| **`readability`** | Cuts corporate jargon and undefined acronyms using the [Harvard Business Review jargon study](https://hbr.org/2021/03/do-you-have-a-jargon-problem). It also strips AI tropes and fixes paragraph `fog` and `vale` trouble spots. | [`skills/readability/SKILL.md`](skills/readability/SKILL.md) |
| **`publish`** | Resolves or inserts inline review notes, builds a line-indexed scorecard, runs the `seo` gate for `summary` and `description` tags, and guides translations. | [`skills/publish/SKILL.md`](skills/publish/SKILL.md) |

---

## Build and test from source

You need **Go 1.26+**, **Node.js 20+**, and **[Vale](https://vale.sh) v3** to build and test the project from source:

```bash
# Build bin/speedgrapher and install it to $GOPATH/bin
make build

# Build and copy the plugin to ~/.gemini/config/plugins/speedgrapher
make install-plugin

# Run the Go test suite
make test

# Write a coverage profile to coverage.out
make test-cov

# Clean build files
make clean
```

For AI search crawlers and coding agents, [`llms.txt`](llms.txt) provides a short index of the project layout, MCP tools, and writing skills.

---

## License

You can use this project under the Apache License, Version 2.0. See [LICENSE](LICENSE) for full details.

---

## Disclaimer

This is not an officially supported Google product.
