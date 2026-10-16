# `Speedgrapher` agent rules

`Speedgrapher` pairs an Antigravity side-panel editor with a [Model Context Protocol](https://modelcontextprotocol.io) server and five writing skills. You use it to brainstorm articles, draft clear technical prose, cut corporate jargon and synthetic phrasing, lint grammar, and audit search engine metadata.

## Side-panel workspace and modes

Whenever a user types `/speedgrapher`, or creates, edits, or reviews a `*.md` file, surface a pill in chat to open `Speedgrapher` in the auxiliary pane while keeping standard `[filename.md](file:///...)` links for the default Markdown viewer:

- Use `[Speedgrapher](sidecar://speedgrapher/panel/?file=<path>)` to open a specific file.
- Use `[Speedgrapher](sidecar://speedgrapher/panel/)` when no specific file sits in scope.

You can switch between four workspace modes in the side panel:

1. In **Reader mode** (`Reader`), you read the final rendered Markdown without body highlights or inline comment threads. Click `💬 Comment` on any paragraph to open the comment popup window, or click `Send Comments` to resolve comments with the built-in panel AI.
2. In **Editor mode** (`Editor`), you click any block to edit its Markdown in place with `⌘Z` and `⌘Y` (`⇧⌘Z`) undo and redo, toggle four **Editorial Lenses** (`Heatmap`, `Slop`, `Vale`, and `Fog`), and inspect **Before and after fix previews**. You can also run `✨ Rewrite with AI`, compare a `3-Angle Variant Tournament`, review staged `✓ Accept Change` and `✕ Reject` diff cards, manage AI provider and Vale rules in `⚙️` Settings, and open the `SEO & GEO` popover.
3. In **Reviewer mode** (`Reviewer`), direct text editing locks while all `<!-- review: ... -->` threads render inline below their paragraphs alongside the diagnostic lenses (`Heatmap`, `Slop`, `Vale`, and `Fog`).
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

## Analysis tools

The `speedgrapher` server provides four tools. Always pass absolute file paths in the `path` field when you audit workspace files.

The `fog` tool computes file and per-paragraph Gunning Fog readability scores from sentence length and words with three or more syllables. Aim for a score between **11 and 15**. Split sentences over 30 words and replace multi-syllable noun stacks with active verbs when a paragraph exceeds 16.

The `slop` tool scores text from 0 to 100 across five dimensions: structural clichés, lexical tells, filler words, sentence rhythm variance, and active voice. Keep scores **under 20**, and never over 25.

The `vale` tool runs static style and grammar checks with the `Google`, `proselint`, and `write-good` rule sets through [Vale](https://vale.sh). Fix all `error` and `warning` alerts before release.

The `seo` tool audits titles, meta tags (`summary` versus `description`), heading order, image `alt` text, links, and word count. Pass `path`, `html`, or `url` along with `doc_type` (`page` or `doc`) and a target `keyword`. When you audit a Hugo site with `hugo` installed, the tool builds draft posts before checking the output HTML.

## Writing skills

Activate the matching skill whenever your user's task fits one of these five stages:

1. Use `speedgrapher` to open the side panel, handle inline `<!-- review: ... -->` notes, or route multi-stage writing tasks.
2. Use `ideate` to interview engineers one question at a time (`Open -> Focused -> Closed`) and outline blog posts, `README.md` files, or `SKILL.md` files with the inverted pyramid.
3. Use `draft` to write technical articles and docs that match the author's voice with a 150-word outcome lead, *why-before-how* code examples, and sentence-case headings.
4. Use `readability` to replace status-signaling corporate jargon and undefined acronyms with plain English using the [Harvard Business Review jargon framework](https://hbr.org/2021/03/do-you-have-a-jargon-problem), purge AI tropes (`deslopify`), and fix paragraph `fog` and `vale` trouble spots.
5. Use `publish` to run `fog`, `slop`, `vale`, and `seo`, resolve or inject inline `<!-- review: ... -->` notes, build a line-indexed scorecard, and check front matter metadata and translations before release.
