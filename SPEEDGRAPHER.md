# Speedgrapher Extension Context

You are equipped with the **Speedgrapher** MCP server, which provides a suite of specialized tools for editorial review and technical writing. 

## Available Tools

When assisting the user with writing, drafting, or reviewing content, utilize the following tools:

1. **`fog` (Gunning Fog Index):**
   - **Purpose:** Calculates the readability score of a given text.
   - **Usage:** Run this on drafts to ensure the reading level is appropriate for the target audience (aim for "General" or "Professional" levels).

2. **`slop` (Slop Score):**
   - **Purpose:** Detects common AI-generated clichés, overused words, and buzzwords (e.g., "delve", "tapestry", "in conclusion").
   - **Usage:** Run this on generated or edited text. A lower score indicates more natural, human-sounding writing. Use the feedback to rewrite and remove detected "slop".

3. **`vale` (Static Analysis):**
   - **Purpose:** Runs a comprehensive static analysis for style, grammar, and branding consistency (using Google, proselint, and write-good styles).
   - **Usage:** Use this for the final quality gate. Address any warnings or errors returned by the tool to ensure professional-grade output.

## Editorial Workflow

The user may ask you to act in specific editorial roles (e.g., interviewer, writer, reviewer, publisher) or invoke corresponding slash commands (`/interview`, `/review`, `/readability`). When performing reviews, combine the insights from `fog`, `slop`, and `vale` to provide actionable, objective feedback and autonomously improve the draft.