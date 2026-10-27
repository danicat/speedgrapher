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

// Package slop provides a tool to calculate a "slop score" for text.
// The slop score is a heuristic that counts overused LLM clichés.
package slop

import (
	"context"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"

	"github.com/danicat/speedgrapher/internal/tools/fog"
	"github.com/jdkato/prose/v2"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

var (
	lexicalSlopWords = []string{
		"delve", "tapestry", "landscape", "nuance", "testament", "beacon", "catalyst",
		"paradigm", "realm", "embark", "journey", "navigating", "intricate", "myriad",
		"unleash", "unprecedented", "game-changing", "revolutionary", "supercharge",
		"unlock", "groundbreaking", "disruptive", "pioneering", "stellar", "killer feature",
		"powerhouse", "synergy", "holistic", "leverage", "robust", "transformative",
		"seamless", "cutting-edge", "next-gen", "paramount", "optimal", "dynamic",
		"proactive", "accelerator", "bleeding edge", "invaluable", "scarce",
		"boilerplate", "wired up", "strategic", "real-world", "capabilities",
		"specialised", "procedural", "deterministic", "rigorous", "relentless",
		"quietly", "deeply", "fundamentally", "remarkably", "arguably",
		"certainly", "utilize", "streamline", "harness", "ecosystem", "framework",
		"multifaceted", "ever-evolving", "fast-paced", "pivotal", "indelible", "transcendent",
	}

	// lexicalInflectionPatterns matches morphological inflections (plurals, -ing, -ed, -es)
	// of core AI lexical tells so inflected forms like "delving", "leveraged", "utilizing",
	// "underscoring", "fostering", and "tapestries" do not evade detection.
	lexicalInflectionPatterns = []string{
		`delv(?:e|es|ed|ing)`,
		`tapestr(?:y|ies)`,
		`landscapes?`,
		`nuances?`,
		`testaments?`,
		`beacons?`,
		`catalysts?`,
		`paradigms?`,
		`realms?`,
		`embark(?:s|ed|ing)?`,
		`journeys?`,
		`navigat(?:e|es|ed|ing)`,
		`myriads?`,
		`unleash(?:es|ed|ing)?`,
		`supercharg(?:e|es|ed|ing)`,
		`unlock(?:s|ed|ing)?`,
		`powerhouses?`,
		`synerg(?:y|ies)`,
		`leverag(?:e|es|ed|ing)`,
		`utiliz(?:e|es|ed|ing)`,
		`streamlin(?:e|es|ed|ing)`,
		`harness(?:es|ed|ing)?`,
		`ecosystems?`,
		`frameworks?`,
		`accelerators?`,
		`underscor(?:e|es|ed|ing)`,
		`showcas(?:e|es|ed|ing)`,
		`foster(?:s|ed|ing)?`,
		`bolster(?:s|ed|ing)?`,
		`cultivat(?:e|es|ed|ing)`,
		`embody(?:ing)?|embodies|embodied`,
		`captivat(?:e|es|ed|ing)`,
		`game-changer|game\s+changer`,
	}

	clichePatterns = []string{
		`(?i)in today'?s .* world`, `(?i)let'?s dive in`, `(?i)whether you'?re`, `(?i)look no further`,
		`(?i)at the end of the day`, `(?i)only time will tell`, `(?i)in this article, we`,
		`(?i)this post details`, `(?i)let'?s have a closer look`, `(?i)let'?s take a closer look`,
		`(?i)the key to success`, `(?i)hope you enjoyed this article`, `(?i)leave your comments below`,
		`(?i)feel free to reach out`, `(?i)a crucial aspect`,
		`(?i)\bthe[ \t]+(?:[a-z0-9\-]+[ \t]+){0,4}[a-z0-9\-]+[ \t]*:[ \t]*the[ \t]+(?:[a-z0-9\-]+[ \t]+){0,4}[a-z0-9\-]+\b`,
		`(?i)\b(?:[a-z0-9\-]+[ \t]+){1,5}\(the[ \t]+(?:[a-z0-9\-]+[ \t]+){0,4}[a-z0-9\-]+\)`,
		`(?i)\b[a-z0-9]+(?:\s*(?:—|–|--)\s*|\s+-\s+)[a-z0-9]+(?:\s+[a-z0-9]+){0,6}(?:\s*(?:—|–|--)\s*|\s+-\s+)[a-z0-9]+\b`,
		`(?i)serves as`, `(?i)stands as`, `(?i)marks a pivotal moment`, `(?i)represents a`,
		`(?i)\bmark(?:s|ed|ing) a (?:pivotal|crucial|significant|key|defining) (?:moment|shift|turning point|step)\b`,
		`(?i)\brepresent(?:s|ed|ing) a (?:significant|major|paradigm|fundamental|pivotal) shift\b`,
		`(?i)\bplay(?:s|ed|ing) a (?:crucial|pivotal|vital|key|central|significant|instrumental) role\b`,
		`(?i)\bis a (?:testament|reminder)\b`,
		`(?i)\b(?:further )?enhancing its (?:significance|role|reputation|status|appeal)\b`,
		`(?i)\bas a (?:dynamic|vibrant|major|regional|key|vital) hub\b`,
		`(?i)\b(?:against|amidst) the backdrop of\b`,
		`(?i)\bboth [a-z]+ and [a-z]+ alike\b`,
		`(?i)\b(?:rich|vibrant) cultural heritage\b`,
		`(?i)\bfoster(?:s|ed|ing) a sense of\b`,
		`(?i)\b(?:underscor|highlight|emphasiz|reflect|symboliz|demonstrat|illustrat)ing (?:its|the|their) (?:ongoing|enduring|lasting|continued|broader|growing|historical|cultural|critical|vital)?\s*(?:importance|significance|relevance|legacy|influence|role|impact|commitment)\b`,
		`(?i)it'?s not .*,? it'?s`, `(?i)not because .*,? but because`,
		`(?i)not .*\.? not .*\.? just`, `(?i)not a .*\.? not a .*\.? a`,
		`(?i)the result\?`, `(?i)the worst part\?`, `(?i)the scary part\?`,
		`(?i)it'?s worth noting`, `(?i)it bears mentioning`, `(?i)importantly,`, `(?i)interestingly,`, `(?i)notably,`,
		`(?i)highlighting its importance`, `(?i)reflecting broader trends`, `(?i)contributing to the development of`,
		`(?i)from [^.?!]+ to [^.?!]+ to [^.?!]+`,
		`(?i)here'?s the kicker`, `(?i)here'?s the thing`, `(?i)here'?s where it gets interesting`, `(?i)here'?s what most people miss`,
		`(?i)imagine a world where`, `(?i)in that world`,
		`(?i)and yes, since we'?re being honest`, `(?i)this is not a rant`,
		`(?i)the reality is simpler`, `(?i)history is unambiguous`, `(?i)history is clear`, `(?i)the truth is simple`,
		`(?i)fundamentally reshape`, `(?i)define the next era`,
		`(?i)let'?s break this down`, `(?i)let'?s unpack`, `(?i)let'?s explore`,
		`(?i)experts argue`, `(?i)industry reports suggest`, `(?i)observers have cited`,
		`(?i)supervision paradox`, `(?i)acceleration trap`, `(?i)workload creep`,
		`(?i)despite its .* challenges`, `(?i)despite these challenges`, `(?i)despite their promising`,
		`(?i)in conclusion,`, `(?i)to sum up,`, `(?i)in summary,`,
	}

	analogyBridges = []string{
		`(?i)think of .* as`, `(?i)akin to`, `(?i)similar to`, `(?i)like a`, `(?i)imagine a`,
		`(?i)think of it like`, `(?i)it'?s like a`,
	}

	analogyTargets = []string{
		"orchestra", "conductor", "blueprint", "engine", "symphony", "canvas", "maestro", "brain",
	}

	// fillerWords captures synthetic/pompous adverbial qualifiers and hollow intensifiers
	// characteristic of LLM puffery, while excluding natural spoken-English words ("very",
	// "really", "actually", "simply", "merely") common in conversational human essays.
	fillerWords = map[string]bool{
		"extremely": true, "incredibly": true, "truly": true,
		"undeniably": true, "unquestionably": true, "utterly": true,
		"essentially": true, "virtually": true, "practically": true,
		"arguably": true, "definitely": true, "absolutely": true,
		"vastly": true, "deeply": true, "fundamentally": true, "remarkably": true,
		"significantly": true, "substantially": true, "ultimately": true,
		"importantly": true, "interestingly": true, "notably": true,
		"seamlessly": true, "effortlessly": true, "meticulously": true,
		"thoughtfully": true, "consistently": true, "inherently": true, "intrinsically": true,
	}

	fillerPhrasesRegex = regexp.MustCompile(`(?i)\b(?:in order to|due to the fact that|for the purpose of|in the event that|at this point in time|in the process of|with regard to|with respect to|in terms of|as a matter of fact|it goes without saying|needless to say|by and large|first and foremost|each and every|a wide range of|a diverse range of|a variety of)\b`)

	passiveExceptions = map[string]bool{
		"based": true, "related": true, "concerned": true, "interested": true, "tired": true,
		"excited": true, "supposed": true, "united": true, "complicated": true, "automated": true,
		"dedicated": true, "distributed": true, "isolated": true, "deprecated": true, "required": true,
		"declared": true, "scoped": true, "informed": true, "disabled": true, "enabled": true,
	}

	// concreteTechNouns exempts standard concrete software/engineering nouns from abstract nominalization penalties.
	concreteTechNouns = map[string]bool{
		"function": true, "functions": true, "variable": true, "variables": true,
		"argument": true, "arguments": true, "document": true, "documents": true,
		"statement": true, "statements": true, "condition": true, "conditions": true,
		"iteration": true, "iterations": true, "location": true, "locations": true,
		"position": true, "positions": true, "instance": true, "instances": true,
		"interface": true, "interfaces": true, "sequence": true, "sequences": true,
		"reference": true, "references": true, "allocation": true, "allocations": true,
		"optimization": true, "optimizations": true, "expression": true, "expressions": true,
		"application": true, "applications": true, "environment": true, "environments": true,
		"collection": true, "collections": true, "configuration": true, "configurations": true,
		"connection": true, "connections": true, "operation": true, "operations": true,
		"implementation": true, "implementations": true, "information": true,
		"performance": true, "difference": true, "differences": true,
		"experience": true, "architecture": true, "propagation": true,
		"documentation": true, "annotation": true, "annotations": true,
		"extension": true, "extensions": true, "definition": true, "definitions": true,
	}
)

var (
	lexicalSlopRegex   = buildLexicalRegex()
	structuralRegex    = regexp.MustCompile(strings.Join(append(clichePatterns, analogyBridges...), "|"))
	bridgeRegexes      = buildBridgeRegexes()
	passiveVoiceRegex  = regexp.MustCompile(`(?i)\b(?:is|are|was|were|be|been|being)\s+(?:[a-z]+ly\s+)?([a-z]{4,}ed|written|built|made|done|given|taken|shown|known|seen|found|sent|kept|held|brought|thought|bought|caught|taught|sold|told|paid|laid|driven|broken|chosen|spoken|stolen|woven|frozen|forgotten|forgiven|hidden|ridden|risen|shaken|fallen|beaten|eaten|bitten|drawn|blown|grown|thrown|flown|worn|torn|sworn|borne|begun|drunk|shrunk|sung|sunk|sprung|stung|swung|wrung|clung|flung|slung|spun|strung|hung|dug|stuck|struck)\b`)
	frontmatterRegex   = regexp.MustCompile(`(?m)\A(?:\s*\n)*(?:---[\s\S]*?^(?:---|\.\.\.)|\+\+\+[\s\S]*?^\+\+\+)`)
	codeBlockRegex     = regexp.MustCompile("(?s)(?:```[\\s\\S]*?```|~~~[\\s\\S]*?~~~)")
	htmlCommentRegex   = regexp.MustCompile(`(?s)<!--.*?-->`)
	mdTableSepRegex    = regexp.MustCompile(`(?m)^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$`)
	hrLineRegex           = regexp.MustCompile(`^(?:\*\s*){3,}$|^(?:-\s*){3,}$|^(?:_\s*){3,}$`)
	mdHugoImageRegex      = regexp.MustCompile(`(?s)!\[([^\]]*)\]\(\s*\{\{.*?\}\}\s*\)`)
	mdHugoLinkRegex       = regexp.MustCompile(`(?s)\[([^\]]+)\]\(\s*\{\{.*?\}\}\s*\)`)
	mdHugoLinkURLSpanRe   = regexp.MustCompile(`(?s)\]\(\s*\{\{.*?\}\}\s*\)`)
	mdImageRegex          = regexp.MustCompile(`!\[([^\]]*)\]\([^\)]+\)`)
	mdLinkRegex           = regexp.MustCompile(`\[([^\]]+)\]\([^\)]+\)`)
	mdLinkURLSpanRegex    = regexp.MustCompile(`\]\([^\)]+\)`)
	inlineCodeRegex       = regexp.MustCompile("`([^`]+)`")
	shortcodeRegex        = regexp.MustCompile(`(?s)\{\{.*?\}\}`)
	htmlTagRegex          = regexp.MustCompile(`(?s)<[^>]*>`)
	nonAlphaNumRegex   = regexp.MustCompile(`(?i)[^a-z0-9\s]`)
	sentenceSplitRe    = regexp.MustCompile(`[.!?]+(?:\s+|$)`)
	multiSpaceCollapse = regexp.MustCompile(`\s{2,}`)

	newProseDocument = func(text string) (*prose.Document, error) {
		return prose.NewDocument(text)
	}

	lexicalSuggestions = map[string]string{
		"utilize":        "use",
		"utilizes":       "uses",
		"utilized":       "used",
		"utilizing":      "using",
		"leverage":       "use",
		"leverages":      "uses",
		"leveraged":      "used",
		"leveraging":     "using",
		"delve":          "explore",
		"delves":         "explores",
		"delved":         "explored",
		"delving":        "exploring",
		"robust":         "reliable",
		"seamless":       "smooth",
		"transformative": "significant",
		"optimal":        "ideal",
		"streamline":     "simplify",
		"streamlines":    "simplifies",
		"streamlined":    "simplified",
		"streamlining":   "simplifying",
		"harness":        "use",
		"harnesses":      "uses",
		"harnessed":      "used",
		"harnessing":     "using",
		"paradigm":       "model",
		"paradigms":      "models",
		"landscape":      "field",
		"landscapes":     "fields",
		"tapestry":       "mix",
		"tapestries":     "mixes",
		"testament":      "proof",
		"catalyst":       "driver",
		"catalysts":      "drivers",
		"synergy":        "collaboration",
		"synergies":      "collaborations",
		"holistic":       "complete",
		"paramount":      "critical",
		"invaluable":     "useful",
		"capabilities":   "features",
		"deterministic":  "predictable",
		"rigorous":       "strict",
		"unleash":        "enable",
		"unleashes":      "enables",
		"unleashed":      "enabled",
		"unleashing":     "enabling",
		"unlock":         "enable",
		"unlocks":        "enables",
		"unlocked":       "enabled",
		"unlocking":      "enabling",
		"supercharge":    "speed up",
		"supercharges":   "speeds up",
		"supercharged":   "sped up",
		"supercharging":  "speeding up",
		"groundbreaking": "new",
		"pioneering":     "early",
		"myriad":         "many",
		"intricate":      "complex",
		"embark":         "start",
		"embarks":        "starts",
		"embarked":       "started",
		"embarking":      "starting",
		"navigating":     "handling",
		"navigate":       "handle",
		"navigates":      "handles",
		"navigated":      "handled",
		"underscore":     "show",
		"underscores":    "shows",
		"underscored":    "showed",
		"underscoring":   "showing",
		"showcase":       "show",
		"showcases":      "shows",
		"showcased":      "showed",
		"showcasing":     "showing",
		"foster":         "build",
		"fosters":        "builds",
		"fostered":       "built",
		"fostering":      "building",
		"bolster":        "strengthen",
		"bolsters":       "strengthens",
		"bolstered":      "strengthened",
		"bolstering":     "strengthening",
		"multifaceted":   "complex",
		"pivotal":        "key",
		"realm":          "area",
		"realms":         "areas",
		"quietly":        "",
		"deeply":         "",
		"fundamentally":  "",
		"remarkably":     "",
		"arguably":       "",
		"certainly":      "",
	}

	structuralSuggestions = map[string]string{
		"serves as":             "is",
		"stands as":             "is",
		"is a testament":        "shows",
		"is a reminder":         "reminds us",
		"it's worth noting":     "",
		"it worth noting":       "",
		"it bears mentioning":   "",
		"importantly,":          "",
		"interestingly,":        "",
		"notably,":              "",
		"in conclusion,":        "",
		"to sum up,":            "",
		"in summary,":           "",
		"let's dive in":         "",
		"lets dive in":          "",
		"let's break this down": "",
		"lets break this down":  "",
		"let's unpack":          "",
		"lets unpack":           "",
		"let's explore":         "",
		"lets explore":          "",
		"at the end of the day": "ultimately",
		"a crucial aspect":      "a key part",
	}
)

func buildLexicalRegex() *regexp.Regexp {
	patterns := make([]string, 0, len(lexicalInflectionPatterns)+len(lexicalSlopWords))
	for _, pat := range lexicalInflectionPatterns {
		patterns = append(patterns, `\b(?:`+pat+`)\b`)
	}
	for _, word := range lexicalSlopWords {
		patterns = append(patterns, `\b`+regexp.QuoteMeta(word)+`\b`)
	}
	return regexp.MustCompile("(?i)" + strings.Join(patterns, "|"))
}

func buildBridgeRegexes() []*regexp.Regexp {
	regexes := make([]*regexp.Regexp, 0, len(analogyBridges))
	for _, b := range analogyBridges {
		regexes = append(regexes, regexp.MustCompile(b))
	}
	return regexes
}

func normalizeSmooth(val, perfectVal, slopVal float64) float64 {
	var x float64
	if perfectVal < slopVal {
		if val <= perfectVal {
			return 0.0
		}
		if val >= slopVal {
			return 100.0
		}
		x = (val - perfectVal) / (slopVal - perfectVal)
	} else {
		if val >= perfectVal {
			return 0.0
		}
		if val <= slopVal {
			return 100.0
		}
		x = (perfectVal - val) / (perfectVal - slopVal)
	}
	return math.Round(math.Pow(x, 1.2)*100.0*100) / 100
}

type CriteriaResult struct {
	Score float64 `json:"score"`
	Raw   float64 `json:"raw"`
}

// SlopFinding represents a single line-indexed AI trope, lexical tell, or passive span found in the text.
type SlopFinding struct {
	Line       int    `json:"line"`
	Span       [2]int `json:"span"`
	Category   string `json:"category"` // "lexical" | "structural" | "passive"
	Match      string `json:"match"`
	Message    string `json:"message"`
	Suggestion string `json:"suggestion,omitempty"`
	Before     string `json:"before,omitempty"`
	After      string `json:"after,omitempty"`
}

// SentenceRhythmItem represents the word count and cadence band of an individual sentence.
type SentenceRhythmItem struct {
	SentenceIndex int    `json:"sentence_index"`
	Line          int    `json:"line"`
	WordCount     int    `json:"word_count"`
	Band          string `json:"band"` // "short" | "medium" | "long"
	Text          string `json:"text,omitempty"`
}

// ParagraphSlop holds per-block AI slop and cadence telemetry.
type ParagraphSlop struct {
	BlockIndex      int     `json:"block_index"`
	BlockType       string  `json:"block_type"`
	StartLine       int     `json:"start_line"`
	EndLine         int     `json:"end_line"`
	WordCount       int     `json:"word_count"`
	SlopScore       float64 `json:"slop_score"`
	LexicalCount    int     `json:"lexical_count"`
	StructuralCount int     `json:"structural_count"`
	PassiveCount    int     `json:"passive_count"`
	FillerRatio     float64 `json:"filler_ratio"`
	RhythmCV        float64 `json:"rhythm_cv"`
	SentenceLengths []int   `json:"sentence_lengths"`
	HeatmapTint     string  `json:"heatmap_tint"` // "green" | "amber" | "red"
}

type SlopResult struct {
	LexicalSlop       CriteriaResult       `json:"lexical_slop"`
	FillerWords       CriteriaResult       `json:"filler_words"`
	StructuralCliches CriteriaResult       `json:"structural_cliches"`
	RhythmVariance    CriteriaResult       `json:"rhythm_variance"`
	SyntacticVoice    CriteriaResult       `json:"syntactic_voice"`
	OverallScore      float64              `json:"overall_slop_score"`
	Findings          []SlopFinding        `json:"findings,omitempty"`
	SentenceRhythm    []SentenceRhythmItem `json:"sentence_rhythm,omitempty"`
	Paragraphs        []ParagraphSlop      `json:"paragraphs,omitempty"`
}

func maskPreserveNewlines(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			b.WriteByte('\n')
		} else {
			b.WriteByte(' ')
		}
	}
	return b.String()
}

func maskHTMLComments(raw string) string {
	return htmlCommentRegex.ReplaceAllStringFunc(raw, maskPreserveNewlines)
}

func maskInlineSpans(line string) string {
	masked := inlineCodeRegex.ReplaceAllStringFunc(line, func(m string) string {
		return strings.Repeat(" ", len(m))
	})
	masked = mdHugoLinkURLSpanRe.ReplaceAllStringFunc(masked, func(m string) string {
		return "]" + strings.Repeat(" ", len(m)-1)
	})
	masked = mdLinkURLSpanRegex.ReplaceAllStringFunc(masked, func(m string) string {
		return "]" + strings.Repeat(" ", len(m)-1)
	})
	masked = shortcodeRegex.ReplaceAllStringFunc(masked, maskPreserveNewlines)
	masked = htmlTagRegex.ReplaceAllStringFunc(masked, maskPreserveNewlines)
	return masked
}

func applyCase(match, replacement string) string {
	if replacement == "" || match == "" {
		return replacement
	}
	r := []rune(match)[0]
	if unicode.IsUpper(r) {
		repRunes := []rune(replacement)
		repRunes[0] = unicode.ToUpper(repRunes[0])
		return string(repRunes)
	}
	return replacement
}

func buildPreview(rawLine string, startIdx, endIdx int, replacement string, hasReplacement bool) (string, string) {
	if !hasReplacement || startIdx < 0 || endIdx > len(rawLine) || startIdx >= endIdx {
		return "", ""
	}
	before := strings.TrimSpace(rawLine)
	var after string
	if replacement != "" {
		cased := applyCase(rawLine[startIdx:endIdx], replacement)
		after = strings.TrimSpace(rawLine[:startIdx] + cased + rawLine[endIdx:])
	} else {
		removed := rawLine[:startIdx] + rawLine[endIdx:]
		after = strings.TrimSpace(multiSpaceCollapse.ReplaceAllString(removed, " "))
	}
	return before, after
}

func countFillers(text string, words []string) float64 {
	count := 0.0
	for _, w := range words {
		if fillerWords[strings.ToLower(w)] {
			count++
		}
	}
	phraseMatches := fillerPhrasesRegex.FindAllString(text, -1)
	count += float64(len(phraseMatches)) * 1.5
	return count
}

func computeRhythmMetrics(lens []float64) (cv float64, score float64) {
	if len(lens) <= 1 {
		return 0.0, 0.0
	}
	sum := 0.0
	for _, l := range lens {
		sum += l
	}
	mean := sum / float64(len(lens))
	if mean <= 0 {
		return 0.0, 0.0
	}
	varSum := 0.0
	for _, l := range lens {
		d := l - mean
		varSum += d * d
	}
	cv = math.Round((math.Sqrt(varSum/float64(len(lens)))/mean)*100) / 100
	if len(lens) <= 2 {
		// Two sentences alone cannot establish monotonous multi-sentence cadence.
		return cv, 0.0
	}
	// Calibrated on real-world technical blogs (Go Blog CV ~0.35-0.55) vs uniform AI output (CV ~0.10-0.20).
	score = normalizeSmooth(cv, 0.40, 0.15)
	if len(lens) < 5 {
		// Ramp confidence smoothly from 3 sentences (1/3) and 4 sentences (2/3) to 5+ sentences (1.0).
		score = math.Round(score*(float64(len(lens)-2)/3.0)*100) / 100
	}
	return cv, score
}

func isAbstractNominalization(word string) bool {
	lower := strings.ToLower(word)
	if len(lower) < 8 || concreteTechNouns[lower] {
		return false
	}
	suffixes := []string{"tion", "tions", "sion", "sions", "ment", "ments", "ance", "ances", "ence", "ences", "ity", "ities", "ness", "nesses", "ship", "ships", "hood", "hoods"}
	for _, suf := range suffixes {
		if strings.HasSuffix(lower, suf) {
			return true
		}
	}
	return false
}

func combineSlopScores(structScore, lexScore, fillerScore, rhythmScore, voiceScore float64) float64 {
	// Weighted 5-dimension base score:
	// 38% Structural Clichés, 30% Lexical Slop, 12% Filler/Hedges, 10% Rhythm Variance, 10% Syntactic Voice.
	base := (structScore * 0.38) +
		(lexScore * 0.30) +
		(fillerScore * 0.12) +
		(rhythmScore * 0.10) +
		(voiceScore * 0.10)

	// Dominant-tell & co-occurrence synergy boost: when direct AI tells (structural clichés
	// or lexical slop) are heavily present, prevent low filler/rhythm scores from diluting the alert.
	maxTell := math.Max(structScore, lexScore)
	minTell := math.Min(structScore, lexScore)
	if maxTell > 40.0 {
		base += (maxTell - 40.0) * 0.25
	}
	if minTell > 20.0 {
		base += (minTell - 20.0) * 0.22
	}

	// Clean-prose noise floor suppression: when a passage has zero structural clichés
	// and minimal lexical/filler tells (e.g. a human essay using "certainly" or "strategic" once),
	// damp secondary cadence/voice variance so pre-2021 human prose stays in the clean (< 10) range.
	if structScore == 0 && lexScore < 12.0 && fillerScore < 10.0 {
		base *= 0.40
	}

	if base > 100.0 {
		base = 100.0
	}
	return math.Round(base*100) / 100
}

func extractFindings(rawText string, hasAnalogyTarget bool) []SlopFinding {
	var findings []SlopFinding
	maskedComments := maskHTMLComments(rawText)
	origLines := strings.Split(rawText, "\n")
	lines := strings.Split(maskedComments, "\n")

	inFrontmatter := false
	frontmatterDelim := ""
	inFence := false
	fenceMarker := ""
	seenContent := false

	for idx, rawLine := range lines {
		lineNum := idx + 1
		trimmed := strings.TrimSpace(rawLine)

		if !seenContent && trimmed == "" {
			continue
		}
		if !seenContent && idx == 0 && (trimmed == "---" || trimmed == "+++") {
			inFrontmatter = true
			frontmatterDelim = trimmed
			seenContent = true
			continue
		}
		seenContent = true

		if inFrontmatter {
			if trimmed == frontmatterDelim || (frontmatterDelim == "---" && trimmed == "...") {
				inFrontmatter = false
			}
			continue
		}

		if !inFence {
			if strings.HasPrefix(trimmed, "```") {
				inFence = true
				fenceMarker = "```"
				continue
			}
			if strings.HasPrefix(trimmed, "~~~") {
				inFence = true
				fenceMarker = "~~~"
				continue
			}
		} else {
			if strings.HasPrefix(trimmed, fenceMarker) {
				inFence = false
				fenceMarker = ""
			}
			continue
		}

		if trimmed == "" || mdTableSepRegex.MatchString(rawLine) || hrLineRegex.MatchString(trimmed) {
			continue
		}

		searchLine := maskInlineSpans(rawLine)
		displayLine := origLines[idx]

		// 1. Lexical findings
		lexLocs := lexicalSlopRegex.FindAllStringIndex(searchLine, -1)
		for _, loc := range lexLocs {
			matchText := displayLine[loc[0]:loc[1]]
			lowerMatch := strings.ToLower(matchText)
			suggestion, hasSuggestion := lexicalSuggestions[lowerMatch]
			before, after := buildPreview(displayLine, loc[0], loc[1], suggestion, hasSuggestion)
			findings = append(findings, SlopFinding{
				Line:       lineNum,
				Span:       [2]int{loc[0] + 1, loc[1] + 1},
				Category:   "lexical",
				Match:      matchText,
				Message:    "Overused AI vocabulary; replace with direct, concrete language.",
				Suggestion: suggestion,
				Before:     before,
				After:      after,
			})
		}

		// 2. Structural findings
		structLocs := structuralRegex.FindAllStringIndex(searchLine, -1)
		for _, loc := range structLocs {
			matchText := displayLine[loc[0]:loc[1]]
			isBridge := false
			for _, br := range bridgeRegexes {
				if br.MatchString(matchText) {
					isBridge = true
					break
				}
			}
			if isBridge && !hasAnalogyTarget {
				continue
			}

			lowerMatch := strings.ToLower(strings.TrimSpace(matchText))
			suggestion, hasSuggestion := structuralSuggestions[lowerMatch]
			before, after := buildPreview(displayLine, loc[0], loc[1], suggestion, hasSuggestion)
			findings = append(findings, SlopFinding{
				Line:       lineNum,
				Span:       [2]int{loc[0] + 1, loc[1] + 1},
				Category:   "structural",
				Match:      matchText,
				Message:    "Formulaic AI structural cliché or rhetorical pivot.",
				Suggestion: suggestion,
				Before:     before,
				After:      after,
			})
		}

		// 3. Passive voice span findings
		passiveMatches := passiveVoiceRegex.FindAllStringSubmatchIndex(searchLine, -1)
		for _, sub := range passiveMatches {
			fullStart, fullEnd := sub[0], sub[1]
			partStart, partEnd := sub[2], sub[3]
			participle := strings.ToLower(searchLine[partStart:partEnd])
			if passiveExceptions[participle] {
				continue
			}
			matchText := displayLine[fullStart:fullEnd]
			findings = append(findings, SlopFinding{
				Line:     lineNum,
				Span:     [2]int{fullStart + 1, fullEnd + 1},
				Category: "passive",
				Match:    matchText,
				Message:  "Passive voice construction; rewrite with an active subject and direct verb.",
				Before:   strings.TrimSpace(displayLine),
			})
		}
	}

	return findings
}

func extractSentenceRhythm(blocks []fog.ProseBlock) []SentenceRhythmItem {
	var rhythm []SentenceRhythmItem
	for _, blk := range blocks {
		for idx, cleaned := range blk.CleanLines {
			lineNum := min(blk.StartLine+idx, blk.EndLine)
			parts := sentenceSplitRe.Split(cleaned, -1)
			for _, p := range parts {
				pTrim := strings.TrimSpace(p)
				if pTrim == "" {
					continue
				}
				wc := len(strings.Fields(nonAlphaNumRegex.ReplaceAllString(pTrim, "")))
				if wc == 0 {
					continue
				}
				band := "medium"
				if wc < 10 {
					band = "short"
				} else if wc >= 25 {
					band = "long"
				}
				rhythm = append(rhythm, SentenceRhythmItem{
					SentenceIndex: len(rhythm),
					Line:          lineNum,
					WordCount:     wc,
					Band:          band,
					Text:          pTrim,
				})
			}
		}
	}
	return rhythm
}

func computeParagraphSlop(rawText string, findings []SlopFinding) ([]ParagraphSlop, []SentenceRhythmItem) {
	blocks := fog.SegmentBlocks(rawText)
	rhythm := extractSentenceRhythm(blocks)
	paragraphs := make([]ParagraphSlop, 0, len(blocks))

	for _, blk := range blocks {
		blkText := strings.Join(blk.CleanLines, " ")
		words := strings.Fields(nonAlphaNumRegex.ReplaceAllString(blkText, ""))
		wc := len(words)
		if wc == 0 {
			continue
		}

		fillerCount := countFillers(blkText, words)
		fillerRatio := math.Round((fillerCount/float64(wc))*1000) / 1000

		lexCount := 0
		structCount := 0
		passiveCount := 0
		for _, f := range findings {
			if f.Line >= blk.StartLine && f.Line <= blk.EndLine {
				switch f.Category {
				case "lexical":
					lexCount++
				case "structural":
					structCount++
				case "passive":
					passiveCount++
				}
			}
		}

		sentences := sentenceSplitRe.Split(blkText, -1)
		sentenceLengths := []int{}
		var floatLens []float64
		for _, s := range sentences {
			sTrim := strings.TrimSpace(s)
			if sTrim == "" {
				continue
			}
			l := len(strings.Fields(nonAlphaNumRegex.ReplaceAllString(sTrim, "")))
			if l > 0 {
				sentenceLengths = append(sentenceLengths, l)
				floatLens = append(floatLens, float64(l))
			}
		}
		if len(sentenceLengths) == 0 {
			sentenceLengths = []int{wc}
		}

		cv, rhythmScore := computeRhythmMetrics(floatLens)

		effectiveW := math.Max(float64(wc), 80.0)
		lexDensity := (float64(lexCount) / effectiveW) * 1000
		structDensity := (float64(structCount) / effectiveW) * 1000
		lexScore := normalizeSmooth(lexDensity, 6.0, 65.0)
		structScore := normalizeSmooth(structDensity, 1.5, 42.0)
		fillerScore := normalizeSmooth(fillerRatio, 0.008, 0.045)
		passivePenalty := math.Min(100.0, float64(passiveCount)*30.0)

		blkSlop := combineSlopScores(structScore, lexScore, fillerScore, rhythmScore, passivePenalty)

		tint := "green"
		switch {
		case blkSlop >= 25.0 || structCount >= 2 || lexCount >= 3:
			tint = "red"
		case blkSlop >= 15.0 || lexCount+structCount+passiveCount >= 1:
			tint = "amber"
		}

		paragraphs = append(paragraphs, ParagraphSlop{
			BlockIndex:      blk.BlockIndex,
			BlockType:       blk.BlockType,
			StartLine:       blk.StartLine,
			EndLine:         blk.EndLine,
			WordCount:       wc,
			SlopScore:       blkSlop,
			LexicalCount:    lexCount,
			StructuralCount: structCount,
			PassiveCount:    passiveCount,
			FillerRatio:     fillerRatio,
			RhythmCV:        cv,
			SentenceLengths: sentenceLengths,
			HeatmapTint:     tint,
		})
	}

	return paragraphs, rhythm
}

// Calculate computes the AI slop score for the given text.
func Calculate(rawText string) (SlopResult, error) {
	// Strip HTML comments, frontmatter (YAML/TOML), code blocks, markdown table separator lines, and markdown links
	text := maskHTMLComments(rawText)
	text = frontmatterRegex.ReplaceAllString(text, "")
	text = codeBlockRegex.ReplaceAllString(text, "")
	text = mdTableSepRegex.ReplaceAllString(text, "")
	text = mdHugoImageRegex.ReplaceAllString(text, "$1")
	text = mdHugoLinkRegex.ReplaceAllString(text, "$1")
	text = mdImageRegex.ReplaceAllString(text, "$1")
	text = mdLinkRegex.ReplaceAllString(text, "$1")
	// Strip inline code
	text = inlineCodeRegex.ReplaceAllString(text, "$1")
	// Strip Hugo shortcodes before HTML tags so {{< ... >}} is removed cleanly
	text = shortcodeRegex.ReplaceAllString(text, " ")
	text = htmlTagRegex.ReplaceAllString(text, " ")

	words := strings.Fields(nonAlphaNumRegex.ReplaceAllString(text, ""))
	totalW := float64(len(words))
	if totalW == 0 {
		return SlopResult{}, nil
	}

	lowerText := strings.ToLower(text)
	hasAnalogyTarget := false
	for _, t := range analogyTargets {
		if strings.Contains(lowerText, t) {
			hasAnalogyTarget = true
			break
		}
	}

	findings := extractFindings(rawText, hasAnalogyTarget)
	paragraphs, rhythm := computeParagraphSlop(rawText, findings)

	// 1. Lexical & Filler Analysis
	lexSlopCount := float64(len(lexicalSlopRegex.FindAllString(text, -1)))
	fillerCount := countFillers(text, words)

	// Use Bayesian prior floor (80 words) for score normalization so a single hit in a short
	// snippet is weighted proportionally rather than treated as 50+ hits per 1000 words,
	// while keeping Raw as the exact per-1000-words density.
	lexDensity := math.Round((lexSlopCount/totalW)*1000*100) / 100
	effectiveLexDensity := (lexSlopCount / math.Max(totalW, 80.0)) * 1000
	fillerRatio := math.Round((fillerCount/totalW)*10000) / 10000

	// 2. Structural Patterns
	structMatches := structuralRegex.FindAllString(text, -1)
	actualStructCount := 0.0
	for _, m := range structMatches {
		isBridge := false
		for _, br := range bridgeRegexes {
			if br.MatchString(m) {
				isBridge = true
				break
			}
		}

		if isBridge {
			if hasAnalogyTarget {
				actualStructCount++
			}
		} else {
			actualStructCount++
		}
	}

	dashCount := float64(strings.Count(text, "—") + strings.Count(text, "--"))
	dashDensity := (dashCount / totalW) * 1000
	if dashDensity > 5 {
		actualStructCount += math.Floor((dashDensity - 5) / 2)
	}
	structDensity := math.Round((actualStructCount/totalW)*1000*100) / 100
	effectiveStructDensity := (actualStructCount / math.Max(totalW, 80.0)) * 1000

	// 3. Rhythm Variance
	sentences := sentenceSplitRe.Split(text, -1)
	var lens []float64
	for _, s := range sentences {
		if trimmed := strings.TrimSpace(s); trimmed != "" {
			l := float64(len(strings.Fields(trimmed)))
			if l > 0 {
				lens = append(lens, l)
			}
		}
	}
	cv, rhythmScore := computeRhythmMetrics(lens)

	// 4. Syntactic Voice (POS Nominalization Burden + Passive Voice Rate)
	doc, err := newProseDocument(text)
	if err != nil {
		return SlopResult{}, fmt.Errorf("failed to initialize prose POS document: %w", err)
	}
	tokens := doc.Tokens()
	abstractNomCount := 0.0
	for _, tok := range tokens {
		if strings.HasPrefix(tok.Tag, "NN") && isAbstractNominalization(tok.Text) {
			abstractNomCount++
		}
	}
	passiveCount := 0
	for _, f := range findings {
		if f.Category == "passive" {
			passiveCount++
		}
	}
	sentenceCount := math.Max(1.0, float64(len(lens)))
	passiveRate := float64(passiveCount) / sentenceCount
	nomRate := abstractNomCount / totalW
	voiceBurden := math.Round(((passiveRate*0.65)+(nomRate*4.5*0.35))*10000) / 10000
	voiceScore := normalizeSmooth(voiceBurden, 0.08, 0.35)

	res := SlopResult{
		LexicalSlop:       CriteriaResult{Score: normalizeSmooth(effectiveLexDensity, 6.0, 65.0), Raw: lexDensity},
		FillerWords:       CriteriaResult{Score: normalizeSmooth(fillerRatio, 0.008, 0.045), Raw: fillerRatio},
		StructuralCliches: CriteriaResult{Score: normalizeSmooth(effectiveStructDensity, 1.5, 42.0), Raw: structDensity},
		RhythmVariance:    CriteriaResult{Score: rhythmScore, Raw: cv},
		SyntacticVoice:    CriteriaResult{Score: voiceScore, Raw: voiceBurden},
		Findings:          findings,
		SentenceRhythm:    rhythm,
		Paragraphs:        paragraphs,
	}

	res.OverallScore = combineSlopScores(
		res.StructuralCliches.Score,
		res.LexicalSlop.Score,
		res.FillerWords.Score,
		res.RhythmVariance.Score,
		res.SyntacticVoice.Score,
	)
	return res, nil
}

// Config holds configuration options for the slop tool.
type Config struct {
	WorkspaceDir string
}

// Register registers the slop tool with the server.
func Register(server *mcp.Server, cfg ...Config) {
	var c Config
	if len(cfg) > 0 {
		c = cfg[0]
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "slop",
		Description: "Calculates an AI 'slop score' (0-100) using 5 weighted metrics. Calibrated for tech writing.",
	}, makeSlopHandler(c))
}

// SlopParams defines the input parameters for the slop tool.
type SlopParams struct {
	Text string `json:"text,omitempty" jsonschema:"The text to analyze for AI slop."`
	Path string `json:"path,omitempty" jsonschema:"Optional absolute path to a file to analyze. If provided and text is empty, the file content will be read."`
}

// Analyze runs the slop analysis directly.
func Analyze(input SlopParams, cfg ...Config) (*SlopResult, error) {
	var c Config
	if len(cfg) > 0 {
		c = cfg[0]
	}
	_, res, err := handleSlop(c, input)
	return res, err
}

// Handler executes the slop tool logic.
func Handler(ctx context.Context, req *mcp.CallToolRequest, input SlopParams, cfg ...Config) (*mcp.CallToolResult, *SlopResult, error) {
	var c Config
	if len(cfg) > 0 {
		c = cfg[0]
	}
	return handleSlop(c, input)
}

func makeSlopHandler(cfg Config) func(context.Context, *mcp.CallToolRequest, SlopParams) (*mcp.CallToolResult, *SlopResult, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, input SlopParams) (*mcp.CallToolResult, *SlopResult, error) {
		return Handler(ctx, req, input, cfg)
	}
}

func handleSlop(cfg Config, input SlopParams) (*mcp.CallToolResult, *SlopResult, error) {
	text, err := resolveContent(cfg, input.Text, input.Path)
	if err != nil {
		return nil, nil, err
	}
	if text == "" {
		return nil, nil, fmt.Errorf("text cannot be empty")
	}

	res, err := Calculate(text)
	if err != nil {
		return nil, nil, err
	}
	return nil, &res, nil
}

func resolveContent(cfg Config, text, path string) (string, error) {
	if text != "" {
		return text, nil
	}
	if path == "" {
		return "", fmt.Errorf("either text or path must be provided")
	}

	targetPath := path
	if !filepath.IsAbs(targetPath) {
		if cfg.WorkspaceDir != "" {
			targetPath = filepath.Join(cfg.WorkspaceDir, targetPath)
		} else {
			absPath, err := filepath.Abs(targetPath)
			if err != nil {
				return "", fmt.Errorf("failed to resolve path %s: %w", path, err)
			}
			targetPath = absPath
		}
	}
	targetPath = filepath.Clean(targetPath)

	data, err := os.ReadFile(targetPath)
	if err != nil {
		return "", fmt.Errorf("failed to read file %s: %w", path, err)
	}

	return string(data), nil
}
