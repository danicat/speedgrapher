---
name: draft
description: >
  Adaptive-voice technical drafting workflow for authoring and expanding
  engineering blog posts, tutorials, READMEs, and documentation. Enforces voice
  fingerprinting, an inverted-pyramid 150-word outcome lead, self-contained
  GEO-ready section leads, grounded code pedagogy (explaining why before how),
  canonical markdown link citations, sentence-case headings, Google developer
  brand and legal safety, first-draft anti-slop and anti-jargon guardrails, and
  pre-delivery verification with fog, slop, and vale. Activate when drafting new
  technical articles, expanding outlines into prose, or rewriting sections.
license: Apache-2.0
metadata:
  category: writing
  tags: "drafting, blogging, documentation, style-guide, code-pedagogy, geo"
  author: Daniela Petruzalek (daniela@danicat.dev)
  version: "0.11.0"
---

# Draft: Adaptive-Voice Technical Writing

`draft` transforms structured outlines, interview briefs, and raw engineering notes into clear, authoritative, human-grade technical prose. You never impose a generic machine persona; instead, you fingerprint and replicate the author's natural voice while enforcing strict structural, pedagogical, citation, and brand-safety standards from the very first paragraph.

---

## 1. End-to-End Drafting Workflow

Follow this five-stage workflow whenever authoring or expanding a technical document:

```mermaid
flowchart LR
    Voice["1. Voice Fingerprinting\nInspect workspace style & posts"] --> Framing["2. Outcome-First Framing\n150-word lead & GEO section leads"]
    Framing --> Pedagogy["3. Grounded Drafting\nWhy-before-how code & citations"]
    Pedagogy --> Safety["4. Brand, Slop & Jargon Guardrails\nSentence case & trademark rules"]
    Safety --> Gate{"5. Pre-Delivery Gate\nRun `fog`, `slop` & `vale`"}
    Gate -->|Out of Bounds| Pedagogy
    Gate -->|Clean| Deliver["Deliver Draft + Speedgrapher Pill"]
```

---

## 2. Core Editorial Pillars

### A. Voice Fingerprinting
Before writing the first paragraph, inspect the workspace for existing posts, `README.md` files, or style guidelines to capture the author's voice fingerprint:
- **Pronoun & Perspective Stance**: Match the author's established stance consistently—whether conversational first-person singular (*"I tracked the memory leak to..."*), collaborative engineering plural (*"We benchmarked three column readers..."*), or direct second-person instructional (*"Configure the listener..."*).
- **Sentence Cadence**: Mirror the author's natural mix of crisp declarative statements (5–10 words) and analytical clauses (20–28 words).
- **Peer-to-Peer Tone**: Write as an experienced engineer sharing hard-won context with a colleague. Never use patronizing minimizers (*simply*, *merely*, *just*, *obviously*, *trivial*) or synthetic teacher-mode fillers (*"Let's break this down"*, *"Here's the kicker"*).

### B. Built-In Inverted Pyramid & GEO-Ready Section Leads
Every draft must serve both time-constrained human readers (*The Scanner*) and AI answer engines (Generative Engine Optimization / GEO):
1. **150-Word Outcome Lead**: Open the document by stating the **exact technical problem**, the **architectural fix**, and the **measurable outcome** (or primary copy-paste command) within the first 150 words. Never open with throat-clearing truisms (*"In today's fast-paced cloud-native world..."*).
2. **Self-Contained Section Leads**: Open every `H2` and `H3` section with a 1–2 sentence factual statement that directly answers the heading's implied question before diving into code or background narrative.
3. **Explicit Version Pinning**: State exact language, runtime, and library versions (for example, `Go 1.27`, `Vale v3.13.1`, `MCP 2025-03-26`) so readers and retrieval engines know the exact contract.

### C. Grounded Code Pedagogy (*Why* Before *How*)
Code blocks are primary engineering evidence, not decorative padding:
1. **Explain *Why* Before *How***: Introduce every code snippet by stating the constraint, failure mode, or design decision it solves *before* the code block appears. Never drop an unintroduced code block immediately below a heading.
2. **Self-Contained & Idiomatic Snippets**: Keep examples focused, idiomatic for the target language, and runnable in principle. Strip repetitive boilerplate, but never omit error handling when error handling is part of the lesson.
3. **Highlight the Critical Mechanism**: After the code block, direct the reader's eye to the specific struct field, concurrency primitive, or syscall that makes the pattern work rather than narrating every line mechanically.

### D. Canonical Citation Hygiene
Anchor every tool, library, standard, and specification to its authoritative upstream source:
- **Hyperlink Canonical Names on First Mention**:
  - ✅ `We validated the schema against the [Agent Skills specification](https://agentskills.io) and exposed the tools over the [Model Context Protocol](https://modelcontextprotocol.io).`
  - ✅ `Run [Vale](https://vale.sh) in your pre-commit hook.`
- **Never Print Bare URLs in Prose**: Do not expose raw URLs (`https://...`) or unformatted domain names inside narrative sentences.
- **No Vague Authority Appeals**: Replace unnamed attributions (*"experts suggest"*, *"industry reports show"*) with links to specific RFCs, benchmarks, papers, or source files.

### E. Sentence-Case Headings & Forward Momentum
- **Strict Sentence Case**: Format all headings (`H1`–`H4`) in sentence case—capitalize only the first word and proper nouns or acronyms (for example, `## Benchmarking JSON serialization in Go 1.27`, not `## Benchmarking JSON Serialization In Go 1.27`).
- **Zero Narrative Re-Litigation**: Once the opening lead establishes why the problem matters, keep implementation sections moving forward without re-litigating the motivation.
- **Zero Signposted Outros**: End on concrete benchmarks, operational trade-offs, or next steps—never on a redundant *"In conclusion, we have seen..."* paragraph.

---

## 3. First-Draft Anti-Slop & Anti-Jargon Guardrails

Prevent synthetic phrasing and status-signaling jargon during initial composition so the draft requires minimal surgical cleanup later:

| Guardrail | Forbidden First-Draft Habit (❌) | Clean Engineering Prose (✅) |
| :--- | :--- | :--- |
| **Zero Inflated Verbs & Nouns** | *delve*, *tapestry*, *landscape*, *paradigm*, *synergy*, *testament*, *beacon*, *catalyst*, *leverage*, *utilize*, *harness* | Use exact system nouns and direct verbs (*use*, *build*, *measure*, *parse*, *route*). |
| **Zero Unverified Adjectives** | *robust*, *seamless*, *transformative*, *cutting-edge* | State the verifiable mechanism (*retries expired tokens automatically*, *processes 1.4 GB/s*). |
| **Zero Negative Parallelisms** | *"It's not X — it's Y"*, *"Not X. Not Y. Just Z."*, *"The result? Devastating."* | Write a single affirmative cause-and-effect clause. |
| **Functional Precision vs. Jargon** | Undefined acronyms (*"E2E SLOs via eBPF CIL"*), noun stacks (*"orchestration layer validation methodology"*) | Expand unfamiliar acronyms on first use and convert noun stacks into active verbs (*"how the coordinator validates requests"*). |
| **Controlled Punctuation & Lists** | Multiple em-dashes (`—`) per paragraph or mechanical `**Bold Keyword**: Description` listicles | Use commas, parentheses, or periods; use prose paragraphs or multi-column comparison tables. |

---

## 4. Google Developer Brand & Legal Safety

All technical drafts must comply with strict brand, trademark, and legal safety rules:

| Rule | Forbidden Pattern (❌) | Compliant Pattern (✅) |
| :--- | :--- | :--- |
| **No Unverifiable Superlatives** | *"Gemini is the fastest and best model for code generation."* | *"Gemini 2.5 Flash reduces time-to-first-token by 35% on our benchmark suite."* |
| **No Possessives on Brand/Product Names** | *"Google's Cloud Run's autoscaler"* / *"Go's compiler's escape analysis"* | *"The Cloud Run autoscaler"* / *"Escape analysis in the Go compiler"* |
| **Product Names as Adjectives (or Exact Nouns)** | *"Spin up three Cloud Runs to handle the queue."* | *"Deploy three Cloud Run services to process the queue."* |
| **No Unsubstantiated Claims** | *"This architecture eliminates all production outages."* | *"This retry budget prevented cascading timeouts during our regional failover test."* |
| **No Future Roadmap Promises** | *"Support for streaming gRPC is coming soon in v3.0."* | Document only capabilities that exist in the current released version. |
| **Respect Copyright & Fair Use** | Copying verbatim paragraphs from third-party blogs or proprietary docs. | Write original analysis and link directly to primary documentation. |

---

## 5. Mandatory Pre-Delivery Verification Gate

Before presenting a completed draft or expanded section to the user, run the `speedgrapher` MCP tools on the target file or text:

1. **`fog` (Gunning Fog Index)**:
   - Target range: **$11.0\text{–}15.0$** across the document and individual paragraphs.
   - If any paragraph exceeds `16.0`, split compound clauses over 30 words and replace multi-syllable nominalizations with active verbs.
2. **`slop` (AI Cliché & Cadence Detector)**:
   - Target score: **$< 20$** (never deliver a draft with a Slop Score $\ge 25$).
   - Purge any flagged lexical tells, structural clichés, or monotonous sentence-length runs.
3. **`vale` (Static Style & Grammar Linter)**:
   - Target: **0 errors and 0 warnings**.
   - Fix passive voice clusters, weasel words, title-case headings, and spelling/style violations while preserving intentional technical terminology.
4. **Surface the Speedgrapher Pill**:
   - Always include `[Speedgrapher](sidecar://speedgrapher/panel/?file=/absolute/path/to/file.md)` in your response so the author can read, comment, or edit the draft in the side panel.

---

## Operational Constraints

- **Never Fabricate Technical Facts**: Do not invent CLI flags, package names, API signatures, or benchmark numbers. Verify every symbol against the workspace or official documentation.
- **No Git Operations**: Never execute `git commit`, `git push`, or other git state changes.
