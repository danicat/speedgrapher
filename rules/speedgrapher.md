# Speedgrapher extension context

The **Speedgrapher** Model Context Protocol (MCP) server provides tools and prompts for editorial review and technical writing.

## Tools

### `fog` — Gunning Fog Index
Calculates the readability score of a text. Use it to verify the reading level matches the target audience. Aim for "General" (≤12) or "Professional" (≤16) levels.

### `slop` — slop score
Detects common AI-generated clichés and overused phrases (for example, "delve" or "tapestry"). Scores text from 0 to 100. Lower is better. Use the matched tropes list to rewrite flagged passages.

### `vale` — static analysis
Runs style, grammar, and branding checks using Google, proselint, and write-good rule sets. Speedgrapher automatically downloads and verifies a pinned version of `vale` (v3.13.1) on first execution. Treat warnings and errors as mandatory fixes.

### `analyze_seo` — Search Engine Optimization (SEO) audit
Performs technical SEO analysis on a URL or raw HTML (including Hugo Markdown with front matter). Checks title tags, meta descriptions, H1 structure, image alt text, links, content length, and canonical tags. Returns a score out of 100 with actionable findings.

## Prompts

### `/interview`
Starts a structured interview to extract raw technical details, error logs, and lessons learned for a blog post. Produces a content outline.

### `/review`
Audits the current draft against editorial guidelines using `fog`, `slop`, and `vale`. Returns a consolidated report with scores and rewrite suggestions.

### `/readability`
Displays a quick Fog Index readability report for the last generated text.

### `/tropes`
Scans text for AI tropes and clichés. Returns matched patterns and a slop score.

## Editorial workflow

The user may ask you to work in specific editorial personas via installed skills:

* **`tech-interviewer`** — brainstorms and collects raw material through targeted questions.
* **`tech-writer`** — drafts content with a conversational, author-aligned voice.
* **`tech-reviewer`** — quality gate: audits readability, slop, and style compliance.
* **`tech-publisher`** — handles SEO audits, localization, and final pre-publication checks.
* **`deslopify`** — rewrites text to remove AI tropes and recognizable large language model (LLM) patterns.
* **`inverted-pyramid`** — restructures documentation using the inverted pyramid layout.

When performing reviews, combine insights from `fog`, `slop`, `vale`, and `analyze_seo` to provide actionable feedback and improve the draft.
