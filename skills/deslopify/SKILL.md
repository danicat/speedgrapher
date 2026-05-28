---
name: deslopify
description: Re-writes text to remove common AI tropes, clichés, and recognizable structural patterns (AI slop) using strict editorial guidelines. Use this skill when the user asks to "deslopify" text or fix AI-sounding writing.
---

# Deslopify

This skill rewrites text to remove common AI tropes, clichés, and recognizable structural patterns. It makes writing sound more human, varied, and authentic.

## Reference material

Read [references/tropes.md](references/tropes.md) to understand the catalog of AI "tells" to avoid. These include:
- "Magic" adverbs like quietly, deeply, and fundamentally.
- Fanciful vocabulary such as delve, tapestry, landscape, robust, seamless, and leverage.
- Structural clichés like negative parallelism ("It's not X — it's Y"), dramatic countdowns ("Not X. Not Y. Just Z."), and unnecessary rhetorical questions ("The result? Devastating.").
- Anaphora and tricolon abuse.
- Padding transitions like "It's worth noting" and false ranges like "From X to Y".
- Pedagogical tones such as "Let's break this down", false vulnerability, and grandiose stakes.
- Excessive em-dashes and bold-first bullet lists.

## Deslopification workflow

1. **Analyze:** Scan the text and identify occurrences of the tropes listed in `tropes.md`.
2. **Strip structure:** Remove rigid AI formatting, fractal summaries, signposted conclusions, and listicle-like paragraphs.
3. **Rewrite:** 
   - Replace complex or grandiose words with simple, direct language.
   - Combine or break up sentences to create a natural, varied rhythm.
   - Remove "serves as" dodges and "Here's the kicker" false suspense.
4. **Review:** Read the final output to ensure it conveys the original message without the distinctive cadence of a large language model. It should sound like a competent human wrote it.