---
name: deslopify
description: Re-writes text to remove common AI tropes, clichés, and recognizable structural patterns (AI slop) using strict editorial guidelines. Use this skill when the user asks to "deslopify" text or fix AI-sounding writing.
---

# Deslopify

This skill rewrites text to remove common AI tropes, clichés, and recognizable structural patterns, making it sound more human, varied, and authentic.

## Reference Material

Read [references/tropes.md](references/tropes.md) to deeply understand the extensive catalog of AI "tells" to avoid, which include:
- "Magic" adverbs (quietly, deeply, fundamentally)
- Fanciful vocabulary (delve, tapestry, landscape, robust, seamless, leverage)
- Structural clichés like negative parallelism ("It's not X -- it's Y"), dramatic countdowns ("Not X. Not Y. Just Z."), and unnecessary rhetorical questions ("The result? Devastating.")
- Anaphora and tricolon abuse
- Padding transitions ("It's worth noting") and false ranges ("From X to Y")
- Pedagogical tone ("Let's break this down"), false vulnerability, and grandiose stakes
- Excessive em-dashes and bold-first bullet lists

## Deslopification Workflow

1. **Analyze:** First, scan the user's text and identify occurrences of the tropes listed in `tropes.md`.
2. **Strip Structure:** Remove the rigid AI formatting, fractal summaries, signposted conclusions, and listicle-like paragraphs.
3. **Rewrite:** 
   - Replace complex or grandiose words with simple, direct language.
   - Combine or break up sentences to create a natural, varied rhythm.
   - Remove "serves as" dodges and "Here's the kicker" false suspense.
4. **Review:** Read the final output to ensure it conveys the original message but lacks the distinctive cadence of an LLM. It should sound like a competent human wrote it.