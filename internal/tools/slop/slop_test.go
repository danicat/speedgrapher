// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package slop

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jdkato/prose/v2"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestCalculate(t *testing.T) {
	tests := []struct {
		name               string
		text               string
		wantScoreThreshold float64
	}{
		{
			name:               "empty text",
			text:               "",
			wantScoreThreshold: 0,
		},
		{
			name:               "natural text",
			text:               "This is a simple sentence written by a human being. It doesn't contain any weird words.",
			wantScoreThreshold: 0,
		},
		{
			name:               "heavy slop",
			text:               "We will delve into the multifaceted tapestry of this crucial paradigm. It is a testament to the intricate synergy we can harness to unlock a robust game changer.",
			wantScoreThreshold: 20.0,
		},
		{
			name: "slop with structural cliches and analogies",
			text: `In today's fast-paced world, let's dive in. Think of this engine as a conductor of an orchestra.
At the end of the day, here's the thing: it marks a pivotal moment to fundamentally reshape the paradigm — indeed — remarkably transformative.`,
			wantScoreThreshold: 25.0,
		},
		{
			name: "markdown frontmatter and code blocks stripped",
			text: `---
title: "Delve Tapestry Landscape"
---
` + "```go\nfunc DelveTapestry() {}\n```" + `
` + "`inline delve code`" + `
This is a standard human sentence without excessive jargon.`,
			wantScoreThreshold: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res, err := Calculate(tt.text)
			if err != nil {
				t.Fatalf("Calculate() unexpected error: %v", err)
			}
			if res.OverallScore < tt.wantScoreThreshold && tt.wantScoreThreshold > 0 {
				t.Errorf("Calculate() gotScore = %v, want >= %v", res.OverallScore, tt.wantScoreThreshold)
			}
		})
	}
}

func TestCalculate_ProseErrorFailsFast(t *testing.T) {
	orig := newProseDocument
	defer func() { newProseDocument = orig }()

	newProseDocument = func(_ string) (*prose.Document, error) {
		return nil, errors.New("synthetic prose failure")
	}

	_, err := Calculate("This is a sentence.")
	if err == nil {
		t.Fatal("expected error when prose.NewDocument fails, got nil")
	}
	if !strings.Contains(err.Error(), "failed to initialize prose POS document") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestCalculate_FindingsAndTableDashes(t *testing.T) {
	text := `---
title: "Delve into Frontmatter"
---
# Heading

We utilize this tool. It serves as a fast parser.

| Column A | Column B | Column C |
| :--- | :---: | ---: |
| 1 | 2 | 3 |
`
	res, err := Calculate(text)
	if err != nil {
		t.Fatalf("Calculate() error: %v", err)
	}

	if len(res.Findings) != 2 {
		t.Fatalf("expected 2 findings (1 lexical, 1 structural), got %d: %+v", len(res.Findings), res.Findings)
	}

	lex := res.Findings[0]
	if lex.Category != "lexical" || lex.Line != 6 || strings.ToLower(lex.Match) != "utilize" || lex.Suggestion != "use" {
		t.Errorf("unexpected lexical finding: %+v", lex)
	}

	st := res.Findings[1]
	if st.Category != "structural" || st.Line != 6 || strings.ToLower(st.Match) != "serves as" || st.Suggestion != "is" {
		t.Errorf("unexpected structural finding: %+v", st)
	}

	// Verify table dashes alone produce 0 structural cliches
	tableOnly := "Simple prose sentence here.\n\n| A | B | C |\n| :--- | :--- | :--- |\n| x | y | z |\n"
	tableRes, err := Calculate(tableOnly)
	if err != nil {
		t.Fatalf("Calculate(tableOnly) error: %v", err)
	}
	if tableRes.StructuralCliches.Raw != 0 {
		t.Errorf("expected 0 structural cliche density for markdown table, got %v", tableRes.StructuralCliches.Raw)
	}
}

func TestNormalizeSmooth(t *testing.T) {
	// val <= perfectVal (where perfect < slop) -> 0
	if got := normalizeSmooth(0.5, 1.0, 8.0); got != 0.0 {
		t.Errorf("expected 0.0, got %f", got)
	}
	// val >= slopVal -> 100
	if got := normalizeSmooth(9.0, 1.0, 8.0); got != 100.0 {
		t.Errorf("expected 100.0, got %f", got)
	}
	// reversed scale: perfectVal > slopVal
	if got := normalizeSmooth(0.8, 0.75, 0.35); got != 0.0 {
		t.Errorf("expected 0.0, got %f", got)
	}
	if got := normalizeSmooth(0.2, 0.75, 0.35); got != 100.0 {
		t.Errorf("expected 100.0, got %f", got)
	}
}

func TestHandleSlop(t *testing.T) {
	ctx := context.Background()

	t.Run("Valid Text input", func(t *testing.T) {
		cfg := Config{}
		params := SlopParams{
			Text: "We will delve into the multifaceted tapestry of this paradigm. It is a testament to the intricate synergy.",
		}
		_, res, err := handleSlop(cfg, params)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res == nil {
			t.Fatal("expected non-nil result")
		}
		if res.OverallScore < 10.0 {
			t.Errorf("expected slop score >= 10, got %f", res.OverallScore)
		}
	})

	t.Run("Valid Path input with absolute path", func(t *testing.T) {
		tempDir := t.TempDir()
		filePath := filepath.Join(tempDir, "sample.md")
		content := "In today's fast-paced world, we delve into the intricate tapestry of paradigms."
		if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
			t.Fatalf("failed to write temp file: %v", err)
		}

		cfg := Config{}
		params := SlopParams{Path: filePath}
		_, res, err := handleSlop(cfg, params)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res == nil {
			t.Fatal("expected non-nil result")
		}
		if res.OverallScore < 10.0 {
			t.Errorf("expected slop score >= 10, got %f", res.OverallScore)
		}
	})

	t.Run("Valid Path input with relative path and WorkspaceDir", func(t *testing.T) {
		tempDir := t.TempDir()
		subDir := filepath.Join(tempDir, "docs")
		if err := os.MkdirAll(subDir, 0755); err != nil {
			t.Fatalf("failed to create sub dir: %v", err)
		}
		filePath := filepath.Join(subDir, "article.md")
		content := "This is a clean and straightforward piece of technical writing."
		if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
			t.Fatalf("failed to write temp file: %v", err)
		}

		cfg := Config{WorkspaceDir: tempDir}
		params := SlopParams{Path: "docs/article.md"}
		_, res, err := handleSlop(cfg, params)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res == nil {
			t.Fatal("expected non-nil result")
		}
	})

	t.Run("Valid Path input with relative path and empty WorkspaceDir", func(t *testing.T) {
		tempDir := t.TempDir()
		filePath := filepath.Join(tempDir, "rel_slop.txt")
		content := "Human written document without robotic phrases."
		if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
			t.Fatalf("failed to write temp file: %v", err)
		}

		cwd, err := os.Getwd()
		if err != nil {
			t.Fatalf("failed to get cwd: %v", err)
		}
		relPath, err := filepath.Rel(cwd, filePath)
		if err != nil {
			t.Fatalf("failed to get rel path: %v", err)
		}

		cfg := Config{}
		params := SlopParams{Path: relPath}
		_, res, err := handleSlop(cfg, params)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res == nil {
			t.Fatal("expected non-nil result")
		}
	})

	t.Run("Text takes precedence over Path when both provided", func(t *testing.T) {
		tempDir := t.TempDir()
		filePath := filepath.Join(tempDir, "unused.txt")
		if err := os.WriteFile(filePath, []byte("Delve into tapestry of paradigms."), 0644); err != nil {
			t.Fatalf("failed to write temp file: %v", err)
		}

		cfg := Config{}
		params := SlopParams{
			Text: "Simple clean text.",
			Path: filePath,
		}
		_, res, err := handleSlop(cfg, params)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.LexicalSlop.Score != 0 {
			t.Errorf("expected 0 lexical slop score from direct text, got %f", res.LexicalSlop.Score)
		}
	})

	t.Run("Missing text and path", func(t *testing.T) {
		cfg := Config{}
		params := SlopParams{}
		_, _, err := handleSlop(cfg, params)
		if err == nil {
			t.Error("expected error for empty text and path, got nil")
		}
	})

	t.Run("Nonexistent file path", func(t *testing.T) {
		cfg := Config{}
		params := SlopParams{Path: "/nonexistent/path/does_not_exist.txt"}
		_, _, err := handleSlop(cfg, params)
		if err == nil {
			t.Error("expected error for nonexistent file path, got nil")
		}
	})

	t.Run("Empty file", func(t *testing.T) {
		tempDir := t.TempDir()
		filePath := filepath.Join(tempDir, "empty.txt")
		if err := os.WriteFile(filePath, []byte(""), 0644); err != nil {
			t.Fatalf("failed to write temp file: %v", err)
		}

		cfg := Config{}
		params := SlopParams{Path: filePath}
		_, res, err := handleSlop(cfg, params)
		if err != nil {
			t.Fatalf("unexpected error for empty file: %v", err)
		}
		if res == nil || res.OverallScore != 0 {
			t.Errorf("expected zeroed SlopResult for empty file, got %+v", res)
		}
	})

	t.Run("makeSlopHandler closure", func(t *testing.T) {
		handler := makeSlopHandler(Config{})
		_, res, err := handler(ctx, nil, SlopParams{Text: "Testing slop handler closure."})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res == nil {
			t.Fatal("expected non-nil result")
		}
	})
}

func TestRegister(t *testing.T) {
	t.Run("Register without cfg", func(t *testing.T) {
		server := mcp.NewServer(&mcp.Implementation{Name: "test-server"}, nil)
		Register(server)
	})

	t.Run("Register with cfg", func(t *testing.T) {
		server := mcp.NewServer(&mcp.Implementation{Name: "test-server"}, nil)
		Register(server, Config{WorkspaceDir: "/tmp/test"})
	})
}

func TestCalculate_HyphenatedWordsNotFlagged(t *testing.T) {
	text := "Compare the outputs side-by-side and inspect them line-by-line. Follow the step-by-step guide for open-source-security."
	res, err := Calculate(text)
	if err != nil {
		t.Fatalf("Calculate() error: %v", err)
	}
	for _, f := range res.Findings {
		if f.Category == "structural" {
			t.Errorf("hyphenated compound word falsely flagged as structural cliche: %+v", f)
		}
	}
	if res.StructuralCliches.Raw != 0 {
		t.Errorf("expected 0 structural cliche density for hyphenated words, got %v", res.StructuralCliches.Raw)
	}

	// Verify actual parenthetical double dashes ARE flagged
	dashText := "The engine — in fact — runs fast and the parser -- by design -- avoids allocations."
	dashRes, err := Calculate(dashText)
	if err != nil {
		t.Fatalf("Calculate(dashText) error: %v", err)
	}
	structFound := 0
	for _, f := range dashRes.Findings {
		if f.Category == "structural" {
			structFound++
		}
	}
	if structFound < 2 {
		t.Errorf("expected parenthetical double dashes to be flagged as structural cliches, got %d findings: %+v", structFound, dashRes.Findings)
	}
}

func TestCalculate_HTMLCommentsPassiveAndParagraphs(t *testing.T) {
	text := `---
title: "Clean Title"
---
<!-- review(p0): We delve into the tapestry of paradigms and it's worth noting -->
# Overview

We utilize this parser to process payloads.

The configuration file was written by the operator, and the request was rejected by the gateway.
`
	res, err := Calculate(text)
	if err != nil {
		t.Fatalf("Calculate() error: %v", err)
	}

	// Ensure nothing from line 4 HTML comment ("delve", "tapestry", "it's worth noting") was flagged
	var foundUtilize, foundPassive bool
	for _, f := range res.Findings {
		if f.Line == 4 {
			t.Errorf("HTML comment on line 4 should be masked, but got finding: %+v", f)
		}
		if f.Category == "lexical" && strings.EqualFold(f.Match, "utilize") {
			foundUtilize = true
			if f.Line != 7 {
				t.Errorf("expected 'utilize' on line 7, got line %d", f.Line)
			}
			if f.Before == "" || f.After == "" || !strings.Contains(f.After, "use") {
				t.Errorf("expected Before/After preview with 'use', got Before=%q After=%q", f.Before, f.After)
			}
		}
		if f.Category == "passive" {
			foundPassive = true
			if f.Line != 9 {
				t.Errorf("expected passive finding on line 9, got line %d", f.Line)
			}
		}
	}
	if !foundUtilize {
		t.Errorf("expected 'utilize' lexical finding on line 7, got %+v", res.Findings)
	}
	if !foundPassive {
		t.Errorf("expected passive voice finding on line 9, got %+v", res.Findings)
	}
	if len(res.SentenceRhythm) == 0 {
		t.Errorf("expected non-empty SentenceRhythm")
	}
	if len(res.Paragraphs) != 3 {
		t.Fatalf("expected 3 prose blocks (heading, paragraph, paragraph), got %d: %+v", len(res.Paragraphs), res.Paragraphs)
	}
	if res.Paragraphs[2].PassiveCount < 1 {
		t.Errorf("expected paragraph 2 to record PassiveCount >= 1, got %+v", res.Paragraphs[2])
	}
}

func TestRealWorldWebCalibrationCorpus(t *testing.T) {
	corpus := []struct {
		name     string
		source   string
		category string // "good" | "borderline" | "bad"
		text     string
		minScore float64
		maxScore float64
	}{
		{
			name:     "JoelSpolsky_2000_Netscape",
			source:   "https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/ (Joel Spolsky, April 2000)",
			category: "good",
			text:     `Netscape 6.0 is finally going into its first public beta. There never was a version 5.0. The last major release, version 4.0, was released almost three years ago. Three years is an awfully long time in the Internet world. During this time, Netscape sat by, helplessly, as their market share plummeted from over 80% to less than 20%. And it is a bit smarmy of me to criticize them for waiting so long between releases, but you have to admit, three years is a point where your customers start wondering if they shouldn't be switching to something else. They did it by making the single worst strategic mistake that any software company can make: They decided to rewrite the code from scratch.`,
			minScore: 0.0,
			maxScore: 10.0,
		},
		{
			name:     "PaulGraham_2015_WriteLikeYouTalk",
			source:   "https://paulgraham.com/talk.html (Paul Graham, October 2015)",
			category: "good",
			text:     `Here's a simple trick for getting more people to read what you write: write in spoken language. Something comes over most people when they start writing. They write in a different language than they'd use if they were talking to a friend. The sentence structure and even the words are different. No one uses "pen" as a verb in spoken English. You'd feel like an idiot using "pen" instead of "write" in a conversation with a friend. You don't need complex sentences to express complex ideas. When specialists in some abstruse topic talk to one another about ideas in their field, they don't use sentences any more complex than they do when talking about what to have for lunch. They use different words, certainly. But even those they use no more than necessary.`,
			minScore: 0.0,
			maxScore: 10.0,
		},
		{
			name:     "Cloudflare_2015_MillionPackets",
			source:   "https://blog.cloudflare.com/how-to-receive-a-million-packets/ (Marek Majkowski, June 2015)",
			category: "good",
			text:     `Historically, network cards had a single RX queue that was used to pass packets between hardware and kernel. This design had an obvious limitation - it was impossible to deliver more packets than a single CPU could handle. To utilize multicore systems, NICs began to support multiple RX queues. The design is simple: each RX queue is pinned to a separate CPU, therefore, by delivering packets to all the RX queues a NIC can utilize all CPUs. But it raises a question: given a packet, how does the NIC decide to which RX queue to push it? Round-robin balancing is not acceptable, as it might introduce reordering of packets within a single connection. An alternative is to use a hash from packet to decide the RX queue number. The hash is usually counted from a tuple (src IP, dst IP, src port, dst port). This guarantees that packets for a single flow will always end up on exactly the same RX queue, and reordering of packets within a single flow can't happen.`,
			minScore: 0.0,
			maxScore: 10.0,
		},
		{
			name:     "DanLuu_2017_FilesAreHard",
			source:   "https://danluu.com/file-consistency/ (Dan Luu, 2017)",
			category: "good",
			text:     `I haven't used a desktop email client in years. None of them could handle the volume of email I get without at least occasionally corrupting my mailbox. Pine, Eudora, and outlook have all corrupted my inbox, forcing me to restore from backup. How is it that desktop mail clients are less reliable than gmail, even though my gmail account not only handles more email than I ever had on desktop clients, but also allows simultaneous access from multiple locations across the globe? Distributed systems have an unfair advantage, in that they can be robust against total disk failure in a way that desktop clients can't, but none of the file corruption issues I've had have been from total disk failure. Why has my experience with desktop applications been so bad?`,
			minScore: 0.0,
			maxScore: 10.0,
		},
		{
			name:     "GoBlog_2023_Loopvar",
			source:   "https://go.dev/blog/loopvar-preview (David Chase & Russ Cox, 2023)",
			category: "good",
			text:     `Go 1.21 includes a preview of a change to for loop scoping that we plan to ship in Go 1.22, removing one of the most common Go mistakes. Usually, you shouldn't take the address of a variable declared by a for loop, because the variable is reused on each iteration. In Go 1.22, each iteration of the loop will create new variables instead, avoiding accidental sharing bugs. Our goal for this change was to achieve zero backwards compatibility breakage in existing code.`,
			minScore: 0.0,
			maxScore: 10.0,
		},
		{
			name:     "Borderline_MildCorporateSlop",
			source:   "Mildly slop-infused engineering status note",
			category: "borderline",
			text:     `Our team leveraged the new observability framework to streamline trace collection across three regional clusters. While the migration required updating several configuration files, it serves as a solid foundation for future latency improvements. We still need to benchmark memory overhead under peak traffic before enabling the collector by default. Early load tests on staging nodes reduced tail latency by 14 percent without dropping spans.`,
			minScore: 14.0,
			maxScore: 35.0,
		},
		{
			name:     "Wikipedia_AISigns_McAllenTemple",
			source:   "https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing (Special:Diff/1256905241)",
			category: "bad",
			text:     `Situated just a few miles from the border — a line that often represents separation and division — the temple stands as a counter-symbol, emphasizing unity, togetherness, and transcendent faith. In a region where many families and communities span both countries, the temple fosters a sense of connection and shared purpose. Through its inclusive design and symbolic features, the building serves as a bridge across divides, embodying the spirit of unity that underlies its sacred purpose. Its bilingual monument sign underscores its role in bringing together communities from both nations. The architectural elements are thoughtfully imbued with local symbolism, reflecting the rich cultural heritage and landscape of the valley.`,
			minScore: 45.0,
			maxScore: 100.0,
		},
		{
			name:     "Wikipedia_AISigns_Catalonia_Douera",
			source:   "https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing (Special:Diff/1252053288 & 1161677884)",
			category: "bad",
			text:     `The Statistical Institute of Catalonia was officially established in 1989, marking a pivotal moment in the evolution of regional statistics in Spain. The founding of the institute represented a significant shift toward regional statistical independence, enabling the region to develop a framework tailored to its unique socio-economic context. Situated in the central-north region of the country, Douera enjoys close proximity to the capital city, further enhancing its significance as a dynamic hub of activity and culture. With its coastal charm and convenient location, the town captivates both residents and visitors alike, offering a diverse range of experiences against the backdrop of stunning natural beauty.`,
			minScore: 45.0,
			maxScore: 100.0,
		},
		{
			name:     "LLM_TechBlog_Archetype",
			source:   "Formulaic AI technical blog post with 'the X : the Y' colon jargon, analogies, and lexical saturation",
			category: "bad",
			text:     `In today's fast-paced world, navigating the ever-evolving landscape of distributed systems is paramount. Let's dive in and delve into the intricate tapestry of microservices orchestration. Think of the control plane as a conductor of an orchestra, seamlessly harnessing a myriad of dynamic capabilities to supercharge developer productivity. The supervision paradox: the acceleration trap (the silent killer) is not just a minor bottleneck, it's a groundbreaking paradigm shift that fundamentally reshapes how teams utilize cloud-native frameworks. Ultimately, this robust architecture serves as a testament to the transformative power of holistic engineering, underscoring its importance in the modern realm.`,
			minScore: 70.0,
			maxScore: 100.0,
		},
	}

	for _, tc := range corpus {
		t.Run(tc.name, func(t *testing.T) {
			res, err := Calculate(tc.text)
			if err != nil {
				t.Fatalf("Calculate(%s) unexpected error: %v", tc.name, err)
			}
			t.Logf("[%s | %s] Overall=%.2f (Struct=%.1f [raw=%.2f], Lex=%.1f [raw=%.2f], Filler=%.1f [raw=%.4f], Rhythm=%.1f [cv=%.2f], Voice=%.1f [raw=%.4f], Findings=%d)",
				tc.category, tc.name, res.OverallScore,
				res.StructuralCliches.Score, res.StructuralCliches.Raw,
				res.LexicalSlop.Score, res.LexicalSlop.Raw,
				res.FillerWords.Score, res.FillerWords.Raw,
				res.RhythmVariance.Score, res.RhythmVariance.Raw,
				res.SyntacticVoice.Score, res.SyntacticVoice.Raw,
				len(res.Findings),
			)
			if res.OverallScore < tc.minScore || res.OverallScore > tc.maxScore {
				t.Errorf("%s (%s): got OverallScore=%.2f, want in [%.1f, %.1f]",
					tc.name, tc.source, res.OverallScore, tc.minScore, tc.maxScore)
			}
		})
	}
}

func TestCalculate_HugoShortcodeLinksIgnored(t *testing.T) {
	withHugo := `In the [previous article]({{< ref "/posts/20261006-delve-tapestry-pivotal-landscape" >}}), we wrote a simple HTTP server in Go. It reads requests from a socket and writes JSON responses.`
	withStandard := `In the [previous article](https://example.com/post), we wrote a simple HTTP server in Go. It reads requests from a socket and writes JSON responses.`

	resHugo, err := Calculate(withHugo)
	if err != nil {
		t.Fatalf("Calculate(withHugo) unexpected error: %v", err)
	}
	resStandard, err := Calculate(withStandard)
	if err != nil {
		t.Fatalf("Calculate(withStandard) unexpected error: %v", err)
	}

	if len(resHugo.Findings) != len(resStandard.Findings) {
		t.Errorf("expected Hugo shortcode URL contents to be ignored by slop detector: got findings %+v, want %+v", resHugo.Findings, resStandard.Findings)
	}
	if resHugo.OverallScore != resStandard.OverallScore {
		t.Errorf("expected identical slop score with Hugo shortcode link: got %.2f, want %.2f", resHugo.OverallScore, resStandard.OverallScore)
	}
}
