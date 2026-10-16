# Diagnostic Catalog: Status-Signaling Jargon & AI Writing Tropes

This reference catalog accompanies [`skills/readability/SKILL.md`](../SKILL.md). Use these six diagnostic tables during copyediting and deslopification passes to distinguish **functional technical precision** from **status-signaling corporate jargon** and **synthetic LLM tropes**.

---

## 1. Status-Signaling Jargon vs. Functional Precision (HBR Framework)

As demonstrated by Zachariah Brown, Eric M. Anicich, and Adam D. Galinsky in [*"Does Your Office Have a Jargon Problem?"*](https://hbr.org/2021/03/do-you-have-a-jargon-problem) (*Harvard Business Review*, March 2021), communicators experiencing lower status or evaluative insecurity compensate by packing text with abstract corporate buzzwords, bureaucratic nominalizations, and unexpanded acronyms to project competence—even though readers consistently find plain, concrete language clearer and more authoritative.

Use this table to separate **Functional Precision** (exact engineering primitives that must stay) from **Status-Signaling Jargon** (opaque abstractions that must be cut or expanded):

| Jargon Category | Status-Signaling Jargon / Tripwire (❌) | Why It Hurts Readability | Plain-English / Functional Precision Rewrite (✅) |
| :--- | :--- | :--- | :--- |
| **Bureaucratic Noun Stack** | *orchestration layer validation methodology* / *resource utilization optimization strategy* | Chains 4–5 abstract nouns together (`fog` inflation) while hiding the actor and the verb. | *how the coordinator validates requests* / *reducing memory usage* |
| **Corporate Buzzword Verb** | *operationalize* / *incentivize* / *synergize* / *architect* (as a vague verb) / *leverage* / *utilize* | Adds multi-syllable corporate padding where a single-syllable verb states the exact action. | *run in production* / *encourage* / *combine* / *design* / *use* |
| **Undefined Acronym Soup** | *"Our E2E control plane enforces SLOs via eBPF CIL hooks across L7 proxies."* | Assumes every reader shares internal team shorthand, creating an immediate comprehension barrier for *The Scanner*. | *"Our end-to-end (E2E) control plane enforces service-level objectives (SLOs) using extended Berkeley Packet Filter (eBPF) hooks across Layer 7 HTTP proxies."* |
| **Abstract System Euphemism** | *single pane of glass* / *north star architecture* / *holistic ecosystem* / *value-add telemetry* | Substitutes slide-deck slogans for concrete system boundaries and data flows. | *a unified Grafana dashboard* / *target storage layout* / *OpenTelemetry span pipeline* |
| **Nominalized Action** | *perform an assessment of* / *conduct an investigation into* / *make a determination regarding* | Turns a direct verb into a multi-syllable noun phrase tied to a weak helper verb. | *assess* / *investigate* / *decide* |
| **Functional Precision (KEEP)** | `mutex`, `goroutine`, `idempotent`, `CRC32C checksum`, `p99 latency`, `B-tree page split`, `mTLS` | Names an exact, irreducible computer science primitive or protocol contract with no simpler synonym. | **Keep the term**, and provide a brief inline parenthetical or clause of context on first mention if the audience spans multiple domains. |

---

## 2. Lexical Slop & Inflated Verbs/Nouns

Large language models substitute concrete technical mechanisms with ornate spatial metaphors or promotional hyperbole. Replace every match with an exact system noun, metric, or direct verb:

| Category | Pattern / Tell | Why It Weakens Technical Prose | Bad Example (❌) | Clean Human Rewrite (✅) |
| :--- | :--- | :--- | :--- | :--- |
| **Inflated Verb** | *delve* / *delve into* | Signals synthetic transition padding rather than direct technical inspection. | Let's delve into how the scheduler allocates worker goroutines. | Let's examine how the scheduler allocates worker goroutines. |
| **Ornate Noun** | *tapestry* / *landscape* | Replaces concrete system boundaries or toolchains with vague spatial metaphors. | Navigating the complex landscape of distributed tracing requires a rich tapestry of telemetry tools. | Implementing distributed tracing requires coordinated OpenTelemetry collectors and span exporters. |
| **Grandiose Noun** | *paradigm* / *synergy* | Claims conceptual revolution where a specific architectural change or integration occurred. | This event-driven paradigm creates synergy between the billing and inventory services. | Event-driven messaging decouples the billing service from inventory database writes. |
| **Rhetorical Noun** | *testament* / *beacon* / *catalyst* | Injects promotional hyperbole into factual engineering analysis. | The sub-millisecond p99 latency stands as a testament to our zero-allocation parser. | Our zero-allocation parser keeps p99 latency under one millisecond. |
| **Corporate Verb** | *leverage* / *utilize* / *harness* | Adds syllable count and bureaucratic distance where *use* is clearer and faster to read. | We utilize eBPF probes to leverage kernel-level socket filtering. | We use eBPF probes to filter packets at the socket layer. |
| **Unverified Adjective** | *robust* / *seamless* / *transformative* | Asserts quality without specifying the failure mode handled, integration mechanism, or measurable impact. | The SDK provides a robust, seamless, and transformative authentication workflow. | The SDK retries expired OAuth tokens automatically without dropping active requests. |
| **Filler Adverbial** | *It's worth noting* / *Notably* / *Importantly* | Announces that a claim matters instead of demonstrating its technical consequence through position or evidence. | It's worth noting that write transactions lock the entire SQLite database file in rollback mode. | In rollback journal mode, write transactions lock the entire SQLite database file. |

---

## 3. "Magic" Adverbs

Models attach intensifying or minimizing adverbs to ordinary technical actions—either to manufacture drama (*quietly*, *deeply*, *fundamentally*) or to trivialize implementation effort (*merely*, *simply*):

| Category | Pattern / Tell | Why It Weakens Technical Prose | Bad Example (❌) | Clean Human Rewrite (✅) |
| :--- | :--- | :--- | :--- | :--- |
| **False Subtlety** | *quietly* | Anthropomorphizes background processes or infrastructure components to manufacture drama. | The garbage collector quietly orchestrates memory reclamation across heap arenas. | The garbage collector reclaims unused heap arenas concurrently with application threads. |
| **Inflated Depth** | *deeply* / *fundamentally* | Substitutes an intensifier for an explanation of *how* a component is coupled or altered. | The storage engine is deeply integrated and fundamentally reshapes query execution. | The storage engine pushes predicate filters directly down to the Parquet row-group reader. |
| **Patronizing Minimizer** | *merely* / *simply* / *just* / *obviously* | Dismisses operational complexity and alienates readers troubleshooting edge cases. | Simply configure the mutual TLS certificates and the proxy merely forwards the traffic. | Configure the client and server TLS certificates so the proxy can verify peers before forwarding traffic. |

---

## 4. Structural Clichés

Synthetic prose relies heavily on formulaic rhetorical pivots that frame routine technical explanations as dramatic reveals:

| Category | Pattern / Tell | Why It Weakens Technical Prose | Bad Example (❌) | Clean Human Rewrite (✅) |
| :--- | :--- | :--- | :--- | :--- |
| **Negative Parallelism** | *It's not X — it's Y* / *Not because X, but because Y* | Manufactures artificial contrast by negating a strawman before stating the actual point. | Caching isn't an optimization — it's an architectural dependency. | Our read path depends on Redis remaining warm to stay within the 50 ms SLA. |
| **Dramatic Countdown** | *Not X. Not Y. Just Z.* | Delays the core metric or conclusion behind two redundant negative fragments. | Not ten milliseconds. Not five milliseconds. Just 400 microseconds per RPC call. | Each RPC call completes in 400 microseconds. |
| **Self-Answering Question** | *The result? Devastating.* / *The X? A Y.* | Stages a synthetic Q&A monologue instead of connecting cause and effect in a single clause. | We deployed the unindexed migration during peak traffic. The result? Complete connection pool exhaustion. | Deploying the unindexed migration during peak traffic exhausted the PostgreSQL connection pool in 40 seconds. |
| **False Suspense** | *Here's the kicker* / *Here's where it gets interesting* | Promises a dramatic twist before delivering a standard engineering observation. | Here's the kicker: the slice header still points to the underlying backing array. | Because the slice header retains a pointer to the original backing array, the garbage collector cannot free the buffer. |
| **False Range** | *From X to Y* (non-contiguous endpoints) | Implies a continuous spectrum between two arbitrary items that do not share a scale. | The linter catches everything from unused variables to architectural drift and security posture. | The linter flags unused variables, forbidden package imports, and hardcoded credentials. |
| **Copula Evasion** | *serves as* / *stands as* / *marks* / *represents* | Evades simple *is* or *are* verbs due to repetition-penalty biases, producing stiff, indirect sentences. | Envoy serves as the ingress gateway and represents our primary rate-limiting boundary. | Envoy is our ingress gateway and enforces per-tenant rate limits. |
| **Trailing Participle** | *, highlighting / underscoring / reflecting...* | Appends a generic `-ing` participial clause that asserts vague significance instead of technical detail. | We migrated to gRPC, underscoring our commitment to high-performance microservices. | We migrated from JSON-over-HTTP to gRPC, cutting serialization CPU overhead by 38%. |
| **Invented Compound Label** | *the [noun] paradox / trap / creep / divide* | Coins an ungrounded sociological label as rhetorical shorthand instead of analyzing the mechanism. | Teams adopting microservice meshes often fall into the observability inversion trap. | Adding sidecar proxies without sampling policies can double telemetry ingestion costs. |

---

## 5. Cadence & Formatting Tells

Even when individual words are clean, uniform sentence rhythm and rigid markdown templates reveal unedited machine generation:

| Category | Pattern / Tell | Why It Weakens Technical Prose | Bad Example (❌) | Clean Human Rewrite (✅) |
| :--- | :--- | :--- | :--- | :--- |
| **Uniform Sentence Length** | Monotonous 15–20 word sentences (Low Coefficient of Variation) | Produces a flat, hypnotic cadence that fatigues readers and obscures emphasis. | The client sends a request to the coordinator node. The coordinator hashes the partition key using CRC32. The hash determines which replica owns the record. | The client sends a request to the coordinator node, which hashes the partition key with CRC32 to locate the owning replica. |
| **Staccato Fragment Chains** | Standalone gerund or noun fragments used for punchiness | Breaks syntactic flow into repetitive telegraphic bursts that mimic promotional copy. | Fixing flaky tests. Updating CI runners. Pruning container layers. Every cycle counts. | We cut CI build times by fixing flaky tests, upgrading runners, and pruning unused container layers. |
| **Tricolon Addiction** | Back-to-back rule-of-three lists or parallel clauses | Turns technical prose into predictable three-beat slogans. | It is fast, reliable, and scalable. It handles ingestion, transformation, and delivery. | The pipeline ingests webhook events, validates their signatures, and writes them to BigQuery. |
| **Anaphora Loops** | Repeating the exact same opening phrase across 3+ sentences | Creates a speech-writing cadence inappropriate for engineering documentation. | You need deterministic builds. You need reproducible environments. You need hermetic test runners. | Deterministic builds require pinned dependencies, reproducible container images, and hermetic test runners. |
| **Bold-First Bullet Listicles** | Every bullet item begins with `**Keyword**: Description` | Converts analytical explanations into mechanical feature catalogs. | - **Performance**: Uses memory-mapped files.<br>- **Safety**: Validates checksums on read. | The engine maps segment files directly into memory and verifies CRC32C checksums on every page read. |
| **Excessive Em-Dashes** | Multiple `—` or `--` pivots per paragraph | Replaces precise conjunctions, parentheses, or periods with breathless parenthetical splices. | The parser — which we rewrote in Go — processes 2 GB/s — without heap allocations. | Rewritten in Go, the parser processes 2 GB/s without heap allocations. |
| **Fractal Signposting** | *Let's break this down* / *In this section* / *In conclusion* | Announces structural transitions instead of letting headings and logical flow guide the reader. | Let's break this down step by step. In conclusion, we have seen how Raft elections work. | When a follower's election timer expires without receiving a heartbeat, it increments its term and requests votes. |
| **Disguised Listicle** | Paragraphs starting with *First, ... Second, ... Third, ...* | Wraps a bulleted list in repetitive ordinal prose without adding narrative transition. | The first bottleneck is DNS resolution. The second bottleneck is TLS handshakes. The third bottleneck is head-of-line blocking. | Connection setup stalls at three stages: uncached DNS lookups, full TLS handshakes, and HTTP/1.1 head-of-line blocking. |

---

## 6. Tone & Persona Tells

Technical readers trust specific, verifiable engineering evidence. Synthetic tone tells undermine credibility by inflating stakes, faking intimacy, or hiding behind unnamed authorities:

| Category | Pattern / Tell | Why It Weakens Technical Prose | Bad Example (❌) | Clean Human Rewrite (✅) |
| :--- | :--- | :--- | :--- | :--- |
| **Grandiose Stakes** | *Reshapes how we think about computing* / *Defines the next era* | Elevates a localized engineering topic to civilizational importance. | Structured concurrency defines the next era of software engineering and reshapes how we think about threads. | Structured concurrency binds child goroutine lifetimes to a lexical scope, preventing leaked background workers. |
| **Manufactured Vulnerability** | *And yes, if we're being honest...* / *This isn't a rant, it's a diagnosis* | Simulates personal candor through polished, risk-free rhetorical asides. | And yes, if we're being completely honest, our initial schema design was naive. | Our initial schema stored event payloads as unindexed JSON blobs, which caused full table scans once the table reached 10 million rows. |
| **Throat-Clearing Openings** | *In today's fast-paced world...* / *Imagine a world where...* | Wastes the first paragraph on truisms before introducing the actual technical problem. | In today's fast-paced cloud-native world, microservices generate massive volumes of logs. | Our Kubernetes cluster emits 4 TB of JSON logs per day, costing \$18,000 a month in ingestion fees. |
| **Patronizing Analogy** | *Think of it as a Swiss Army knife / highway system...* | Interrupts technical explanations with clichés that are less accurate than the mechanism itself. | Think of a mutex like a single-occupancy restroom key shared by threads. | A mutex serializes access to shared memory so only one goroutine can mutate the struct at a time. |
| **Vague Attribution** | *Experts argue...* / *Industry reports suggest...* | Appeals to unnamed authority instead of citing a specific benchmark, RFC, or incident report. | Industry experts argue that tail latency matters more than average latency in distributed systems. | As Dean and Barroso demonstrated in *[The Tail at Scale](https://cacm.acm.org/magazines/2013/2/160173-the-tail-at-scale/fulltext)*, a single slow shard degrades p99 response time across fan-out queries. |
| **Formulaic Concession** | *Despite these challenges, X continues to thrive* | Dismisses real operational trade-offs with a synthetic optimistic wrap-up. | Despite these memory overhead challenges, WebAssembly continues to thrive at the edge. | Because each WebAssembly instance reserves a minimum 64 KiB linear memory page, we pool warm instances rather than cold-starting one per request. |
