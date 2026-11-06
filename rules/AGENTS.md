# `Speedgrapher` agent rules

`Speedgrapher` pairs an Antigravity side-panel editor with a [Model Context Protocol](https://modelcontextprotocol.io) server and five writing skills. You use it to brainstorm articles, draft clear technical prose, cut corporate jargon and synthetic phrasing, lint grammar, and audit search engine metadata.

## Side-panel workspace and modes

Whenever a user creates, edits, or reviews a `*.md` file, surface a pill in chat to open `Speedgrapher` in the auxiliary pane while keeping standard `[filename.md](file:///...)` links for the default Markdown viewer:

- Use `[file.md](sidecar://speedgrapher/panel/?file=/absolute/path/to/file.md)` to open a specific file (using the file's basename as the link text).
- Use `[Speedgrapher](sidecar://speedgrapher/panel/)` when no specific file sits in scope.

You can switch between four workspace modes in the side panel:

1. In **Reader mode** (`Reader`), you read a clean, read-only view of the rendered Markdown without body highlights, hover bars, or inline comment threads.
2. In **Editor mode** (`Editor`), you click any block to edit its Markdown in place with `⌘Z` and `⌘Y` (`⇧⌘Z`) undo and redo, toggle four **Editorial Lenses** (`Heatmap`, `Slop`, `Vale`, and `Fog`), and inspect **Before and after fix previews**. Each active paragraph shows a docked header bar with its score pill, `Comment`, `Send to chat`, `AI Rewrite`, and `3-Angle Variant Tournament` actions. You can also review staged `✓ Accept Change` and `✕ Reject` diff cards, manage AI provider and project or global Vale rules in `⚙️` Settings, and open the `SEO & GEO` popover.
3. In **Reviewer mode** (`Reviewer`), direct text editing locks while all `<!-- review: ... -->` threads render inline below their paragraphs alongside the diagnostic lenses (`Heatmap`, `Slop`, `Vale`, and `Fog`). You can add or resolve review comments or dispatch them to the panel AI or main chat.
4. In **Raw mode** (`Raw`), you edit the full Markdown source in a single plain-text buffer with `⌘Z` and `⌘Y` (`⇧⌘Z`) undo and redo.

## Inline review comments and panel AI vs. main chat

You and your user exchange paragraph feedback through standard HTML comments placed right below a paragraph on disk. Comments use either plain `<!-- review: ... -->` tags or UI tags with `id`, `quote`, and `ts` fields (`<!-- review(id="...", quote="...", ts="..."): ... -->`):

```markdown
Our collector buffers spans in memory before flushing them to storage.
<!-- review: Mention the 5-second timeout and Zstandard compression here. -->
<!-- review(id="c1", quote="buffers spans", ts="2026-10-16T00:00:00Z"): Clarify the ring buffer size limit. -->
```

In-panel AI actions (`Send Comments`, `✨ Rewrite with AI`, `3-Angle Variant Tournament`, and `Fix SEO`) run through Speedgrapher's built-in Gemini or Vertex AI client (set in `⚙️` Settings to fast models like `gemini-3.8-flash`). They return proposals in memory and stage `✓ Accept Change` and `✕ Reject` diff cards without writing to disk until the user clicks `✓ Accept Change`.

The user clicks `💬 Send to Main Chat` when they want the main chat session to read the text or run chat workflows. When your user asks you in chat to resolve review comments in a file, find every `<!-- review: ... -->` and `<!-- review(...): ... -->` block, rewrite the preceding paragraph to answer the note, and delete the tag. When your user asks you to mark up a file in place instead of rewriting it right away, insert concise `<!-- review: [Dimension] Suggestion... -->` tags below the paragraphs that need work.

## Voice preservation & the zero-silent-edit rule

Models must never unilaterally edit, rewrite, or sanitize user text without explicit permission. Replacing the author's conversational idioms, tone, or informal cadence with sterile corporate phrasing (such as turning "pretty cool" into "capable") is a critical failure.

Across **all writing stages** (ideating, drafting, readability copyediting, or publishing):

1. **Zero Silent Edits**: Never rewrite or mutate draft text on disk unless the user explicitly tells you to apply changes or auto-fix.
2. **Deterministic Line-Indexed Proposals**: When reviewing or suggesting improvements to an existing draft, present changes as an exhaustive, numbered list of line-indexed recommendations:
   `- [N] Line <N> | Dimension: <Fog|Slop|Vale|SEO|Jargon|Narrative> | Context: "<exact excerpt>" | Suggestion: "<concrete rewrite or structural fix>"`
3. **Wait for Explicit Commands**: Always invite the user to choose which edits to apply (`"apply all"`, `"apply 1, 3"`, `"discuss 2"`, or `"reject"`). Never apply edits until the user signs off.
4. **Preserve Authentic Cadence Over Rigid Style Guides**: Static linters (like Vale's Google style rules) are designed for formal product documentation, not personal essays or developer social posts. Never let a linter strip out the author's personality, contractions, internet terminology (e.g. "TL;DR"), exclamation marks, or conversational turns of phrase.
5. **Strictly No Em Dashes**: Never use em dashes (`—` or `--`) as mid-sentence connectors. Break thoughts into clean, crisp sentences using periods, commas, or colons.

## Analysis tools

The `speedgrapher` server provides four tools. Always pass absolute file paths in the `path` field when you audit workspace files.

The `fog` tool computes file and per-paragraph Gunning Fog readability scores from sentence length and words with three or more syllables. Aim for a score between **12 and 14**.

The `slop` tool scores text from 0 to 100 across five dimensions: structural clichés, lexical tells, filler words, sentence rhythm variance, and active voice. Keep scores **under 20**, and never over 25.

The `vale` tool runs static style and grammar checks with the `Google`, `proselint`, and `write-good` rule sets through [Vale](https://vale.sh). Vale grammar checks must always be fixed, but style checks are informational and should be presented to the user for discussion.

The `seo` tool audits titles, meta tags (`summary` versus `description`), heading order, image `alt` text, links, and word count. Pass `path`, `html`, or `url` along with `doc_type` (`page` or `doc`) and a target `keyword`. When you audit a Hugo site with `hugo` installed, the tool builds draft posts before checking the output HTML.

## Writing skills

Activate the matching skill whenever your user's task fits one of these five stages:

1. Use `speedgrapher` to surface the `[Speedgrapher](sidecar://speedgrapher/panel/)` pill and open the side-panel Markdown editor.
2. Use `ideate` to interview engineers one question at a time (`Open -> Focused -> Closed`) and outline blog posts, `README.md` files, or `SKILL.md` files with the inverted pyramid.
3. Use `draft` to write technical articles and docs that match the author's voice with a 150-word outcome lead, *why-before-how* code examples, and sentence-case headings.
4. Use `readability` to replace status-signaling corporate jargon and undefined acronyms with plain English using the [Harvard Business Review jargon framework](https://hbr.org/2021/03/do-you-have-a-jargon-problem), purge AI tropes (`deslopify`), and fix paragraph `fog` and `vale` trouble spots.
5. Use `publish` to run `fog`, `slop`, `vale`, and `seo`, resolve or inject inline `<!-- review: ... -->` notes, build a line-indexed scorecard, and check front matter metadata and translations before release.
