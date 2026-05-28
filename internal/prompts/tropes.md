# AI writing tropes to avoid

Add this file to your AI assistant's system prompt or context to help it avoid common AI writing patterns. Source: tropes.fyi

---

## Word choice

### "Quietly" and other magic adverbs

Overuse of "quietly" and similar adverbs to convey subtle importance or understated power. AI reaches for these adverbs to make mundane descriptions feel significant. Also includes: "deeply", "fundamentally", "remarkably", "arguably".

**Avoid patterns like:**
- "quietly orchestrating workflows, decisions, and interactions"
- "the one that quietly suffocates everything else"
- "a quiet intelligence behind it"

### "Delve" and friends

"Delve" went from an uncommon English word to appearing in a staggering percentage of AI-generated text. Part of a family of overused AI vocabulary including "certainly", "utilize", "leverage" (as a verb), "robust", "streamline", and "harness".

**Avoid patterns like:**
- "Let's delve into the details..."
- "Delving deeper into this topic..."
- "We certainly need to leverage these robust frameworks..."

### "Tapestry" and "landscape"

Overuse of ornate or grandiose nouns where simpler words would do. "Tapestry" is used to describe anything interconnected. "Landscape" is used to describe any field or domain. Other offenders: "paradigm", "synergy", "ecosystem", "framework".

**Avoid patterns like:**
- "The rich tapestry of human experience..."
- "Navigating the complex landscape of modern AI..."
- "The ever-evolving landscape of technology..."

### The "serves as" dodge

Replacing simple "is" or "are" with pompous alternatives like "serves as", "stands as", "marks", or "represents". AI avoids basic copulas because its repetition penalty pushes it toward fancier constructions.

**Avoid patterns like:**
- "The building serves as a reminder of the city's heritage."
- "Gallery 825 serves as LAAA's exhibition space for contemporary art."
- "The station marks a pivotal moment in the evolution of regional transit."

---

## Sentence structure

### Negative parallelism

The "It's not X — it's Y" pattern, often with an em dash. This is the most common AI writing tell. AI uses this to create false profundity by framing everything as a surprising reframe. One in a piece can be effective; ten in a blog post is an insult to the reader. Includes the causal variant "not because X, but because Y" where every explanation is framed as a surprise reveal.

**Avoid patterns like:**
- "It's not bold. It's backwards."
- "Feeding isn't nutrition. It's dialysis."
- "Half the bugs you chase aren't in your code. They're in your head."

### "Not X. Not Y. Just Z."

The dramatic countdown pattern. AI builds tension by negating two or more things before revealing the actual point. This creates a false sense of narrowing down to the truth.

**Avoid patterns like:**
- "Not a bug. Not a feature. A fundamental design flaw."
- "Not ten. Not fifty. Five hundred and twenty-three lint violations across 67 files."
- "not recklessly, not completely, but enough"

### "The X? A Y."

Self-posed rhetorical questions answered immediately in the next sentence or clause. The model asks a question nobody was asking, then answers it for dramatic effect.

**Avoid patterns like:**
- "The result? Devastating."
- "The worst part? Nobody saw it coming."
- "The scary part? This attack vector is perfect for developers."

### Anaphora abuse

Repeating the same sentence opening multiple times in quick succession.

**Avoid patterns like:**
- "They assume that users will pay... They assume that developers will build... They assume that ecosystems will emerge... They assume that..."
- "They could expose... They could offer... They could provide... They could create... They could let... They could unlock..."
- "They have built engines, but not vehicles. They have built power, but not leverage. They have built walls, but not doors."

### Tricolon abuse

Overuse of the rule-of-three pattern, often extended to four or five. A single tricolon is elegant; three back-to-back tricolons are a pattern recognition failure.

**Avoid patterns like:**
- "Products impress people; platforms empower them. Products solve problems; platforms create worlds. Products scale linearly; platforms scale exponentially."
- "identity, payments, compute, distribution"
- "workflows, decisions, and interactions"

### "It's worth noting"

Filler transitions that signal nothing. AI uses these phrases to introduce new points without connecting them to the previous argument. Also includes: "It bears mentioning", "Importantly", "Interestingly", "Notably".

**Avoid patterns like:**
- "It's worth noting that this approach has limitations."
- "Importantly, we must consider the broader implications."
- "Interestingly, this pattern repeats across industries."

### Superficial analyses

Tacking a present participle ("-ing") phrase onto the end of a sentence to inject shallow analysis that says nothing. The model attaches significance, legacy, or broader meaning to mundane facts using phrases like "highlighting its importance", "reflecting broader trends", or "contributing to the development of...".

**Avoid patterns like:**
- "contributing to the region's rich cultural heritage"
- "This etymology highlights the enduring legacy of the community's resistance."
- "underscoring its role as a dynamic hub of activity and culture"

### False ranges

Using "from X to Y" constructions where X and Y aren't on any real scale. In legitimate use, "from X to Y" implies a spectrum with a meaningful middle. AI uses it to list two loosely related things.

**Avoid patterns like:**
- "From innovation to implementation to cultural transformation."
- "From the singularity of the Big Bang to the grand cosmic web."
- "From problem-solving and tool-making to scientific discovery, artistic expression, and technological innovation."

### Gerund fragment litany

After making a claim, AI illustrates it with a stream of verbless gerund fragments — standalone sentences with no grammatical subject. The fragments add nothing except word count and that familiar AI cadence. Humans don't write first drafts this way.

**Avoid patterns like:**
- "Fixing small bugs. Writing straightforward features. Implementing well-defined tickets."
- "Reviewing pull requests. Debugging edge cases. Attending architecture meetings."
- "Shipping faster. Moving quicker. Delivering more."

---

## Paragraph structure

### Short punchy fragments

Excessive use of very short sentences or sentence fragments as standalone paragraphs for manufactured emphasis. RLHF training has pushed models toward "writing for readability" aimed at the lowest common denominator. It's an inhuman style that doesn't match how humans think or speak.

**Avoid patterns like:**
- "He published this. Openly. In a book. As a priest."
- "These weren't just products. And the software side matched. Then it professionalised. But I adapted."
- "Platforms do."

### Listicle in a trench coat

Numbered or labeled points dressed up as continuous prose. The model writes what is essentially a listicle but wraps each point in a paragraph that starts with "The first... The second... The third..." to disguise the format.

**Avoid patterns like:**
- "The first wall is the absence of a free, scoped API... The second wall is the lack of delegated access... The third wall is the absence of scoped permissions..."
- "The second takeaway is that... The third takeaway is that... The fourth takeaway is that..."

---

## Tone

### "Here's the kicker"

False suspense transitions that promise a revelation but deliver a point that did not need the buildup. The model uses these phrases to manufacture drama before an otherwise unremarkable observation. Also includes: "Here's the thing", "Here's where it gets interesting", "Here's what most people miss".

**Avoid patterns like:**
- "Here's the kicker."
- "Here's the thing about AI adoption."
- "Here's where it gets interesting."

### "Think of it as..."

The patronizing analogy. AI constantly reaches for "Think of it as..." or "It's like a..." to simplify concepts. The model defaults to teacher mode and assumes the reader needs a metaphor to understand anything.

**Avoid patterns like:**
- "Think of it like a highway system for data."
- "Think of it as a Swiss Army knife for your workflow."
- "It's like asking someone to buy a car they're only allowed to sit in while it's parked."

### "Imagine a world where..."

The classic AI invitation to futurism. To sell the argument, the AI begins with "Imagine" followed by a list of wonderful things that will happen if the reader agrees with the premise.

**Avoid patterns like:**
- "Imagine a world where every tool you use has a quiet intelligence behind it..."
- "In that world, workflows stop being collections of manual steps and start becoming orchestrations."

### False vulnerability

Simulated self-awareness or honesty that reads as performative. The model pretends to break the fourth wall or admit a bias, creating a false sense of authenticity. Real vulnerability is specific and uncomfortable; AI vulnerability is polished and risk-free.

**Avoid patterns like:**
- "And yes, I'm openly in love with the platform model"
- "And yes, since we're being honest: I'm looking at you, OpenAI, Google, Anthropic, Meta"
- "This is not a rant; it's a diagnosis"

### "The truth is simple"

Asserting that something is obvious, clear, or simple instead of actually proving it. If you have to tell the reader your point is clear, it very likely isn't.

**Avoid patterns like:**
- "The reality is simpler and less flattering"
- "History is unambiguous on this point"
- "History is clear, the metrics are clear, the examples are clear"

### Grandiose stakes inflation

Everything is the most important thing ever. AI inflates the stakes of every argument to world-historical significance.

**Avoid patterns like:**
- "This will fundamentally reshape how we think about everything."
- "will define the next era of computing"
- "something entirely new"

### "Let's break this down"

The pedagogical voice that assumes the reader needs hand-holding. AI defaults to a teacher-student dynamic even when writing for expert audiences. Also includes: "Let's unpack this", "Let's explore", "Let's dive in".

**Avoid patterns like:**
- "Let's break this down step by step."
- "Let's unpack what this really means."
- "Let's explore this idea further."

### Vague attributions

Attributing claims to unnamed authorities instead of being specific. AI loves to invoke "experts", "observers", "industry reports", and "several publications" without naming anyone. If you can't name the expert, you don't have a source.

**Avoid patterns like:**
- "Experts argue that this approach has significant drawbacks."
- "Industry reports suggest that adoption is accelerating."
- "Observers have cited the initiative as a turning point."

### Invented concept labels

AI clusters invented compound labels that sound analytical without being grounded. It appends abstract problem-nouns like paradox, trap, creep, divide, vacuum, and inversion to domain words. They function as rhetorical shorthand: name a thing, skip the argument.

**Avoid patterns like:**
- "the supervision paradox"
- "the acceleration trap"
- "workload creep"

---

## Formatting

### Em-dash addiction

Compulsive overuse of em dashes for dramatic pauses, parenthetical asides, and pivot points. A human writer might use 2–3 per piece; AI will use 20+.

**Avoid patterns like:**
- "The problem — and this is the part nobody talks about — is systemic."
- "The tinkerer spirit didn't die of natural causes — it was bought out."
- "Not recklessly, not completely — but enough."

### Bold-first bullets

Every bullet point or list item starts with a bolded phrase or sentence. This is a telltale sign of AI-generated documentation, blog posts, and README files.

**Avoid patterns like:**
- "Every single bullet point begins with a bold keyword."
- "**Security**: Environment-based configuration with..."
- "**Performance**: Lazy loading of expensive resources..."

### Unicode decoration

Use of unicode arrows (→), smart/curly quotes, and other special characters that can't be easily typed on a standard keyboard. Real writers typing in a text editor produce straight quotes and -> or =>.

**Avoid patterns like:**
- "Input → Processing → Output"
- "This leads to better outcomes → which means higher engagement"
- "“Smart quotes” instead of straight \"quotes\" that you’d actually type"

---

## Composition

### Fractal summaries

"What I'm going to tell you; what I'm telling you; what I just told you" applied at every level of the document. Every subsection and section gets a summary.

**Avoid patterns like:**
- "In this section, we'll explore... [3000 words later] ...as we've seen in this section."
- "A conclusion that restates every point already made in the previous 3000 words"
- "And so we return to where we began."

### The dead metaphor

Latching onto a single metaphor and repeating it across the entire piece. A human writer would move on. AI will repeat the same metaphor 5–10 times.

**Avoid patterns like:**
- "The ecosystem needs ecosystems to build ecosystem value."
- "Walls and doors used 30+ times in the same article"
- "Every paragraph finds a way to say \"primitives\" again"

### Historical analogy stacking

Rapid-fire listing of historical companies or tech revolutions to build false authority. This is especially common in technical writing.

**Avoid patterns like:**
- "Apple didn't build Uber. Facebook didn't build Spotify. Stripe didn't build Shopify."
- "Every major technological shift followed the same pattern."
- "Take Spotify... Or consider Uber... Airbnb followed a similar path..."

### One-point dilution

Making a single argument and restating it in 10 different ways across thousands of words. The model pads a simple thesis to feel "comprehensive" by rephrasing the same idea with different metaphors, examples, and framings.

**Avoid patterns like:**
- "The same point, restated eight ways across 4000 words."
- "Each section rephrases the thesis with a different metaphor but adds nothing new"

### Content duplication

Repeating entire sections or paragraphs verbatim within the same piece. This happens when the model loses track of what it has already written.

**Avoid patterns like:**
- "The same section appeared twice, word-for-word identical."
- "Paragraph 3 and paragraph 17 are the same sentence reworded"

### The signposted conclusion

Explicitly announcing the conclusion with "In conclusion", "To sum up", or "In summary". Competent writing doesn't need to tell you it's concluding. The reader can feel it.

**Avoid patterns like:**
- "In conclusion, the future of AI depends on..."
- "To sum up, we've explored three key themes..."
- "In summary, the evidence suggests..."

### "Despite its challenges..."

The rigid formula where AI acknowledges problems only to immediately dismiss them. Always follows the same beat: "Despite its [positive words], [subject] faces challenges..." then ends with "Despite these challenges, [optimistic conclusion].".

**Avoid patterns like:**
- "Despite these challenges, the initiative continues to thrive."
- "Despite its industrial and residential prosperity, Korattur faces challenges typical of urban areas."
- "Despite their promising applications, pyroelectric materials face several challenges."

---

Remember: any of these patterns used once might be fine. The problem is when multiple tropes appear together or when a single trope is used repeatedly. Write like a human: varied, imperfect, specific.