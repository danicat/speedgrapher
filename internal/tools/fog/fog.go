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

package fog

import (
	"context"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	FogCategoryUnreadable   = "Unreadable: Likely incomprehensible to most readers."
	FogCategoryHardToRead   = "Hard to Read: Requires significant effort, even for experts."
	FogCategoryProfessional = "Professional Audiences: Best for readers with specialized knowledge."
	FogCategoryGeneral      = "General Audiences: Clear and accessible for most readers."
	FogCategorySimplistic   = "Simplistic: May be perceived as childish or overly simple."
)

var (
	punctRegex       = regexp.MustCompile(`[[:punct:]]`)
	sentenceRegex    = regexp.MustCompile(`[.!?]+`)
	wordTokenRe      = regexp.MustCompile(`[A-Za-z]+`)
	mdHugoLinkDestRe = regexp.MustCompile(`(?s)\]\(\s*\{\{.*?\}\}\s*\)`)
	mdLinkDestRe     = regexp.MustCompile(`\]\([^)]*\)`)
)

// Register registers the fog tool with the server.
func Register(server *mcp.Server, cfg ...Config) {
	var c Config
	if len(cfg) > 0 {
		c = cfg[0]
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "fog",
		Description: "Calculates the Gunning Fog Index to estimate the readability of an English text. Lower scores indicate easier reading.",
	}, makeFogHandler(c))
}

// Config holds configuration options for the fog tool.
type Config struct {
	WorkspaceDir string
}

// FogParams defines the input parameters for the fog tool.
type FogParams struct {
	Text string `json:"text,omitempty" jsonschema:"The text to analyze for readability. Must contain at least one sentence."`
	Path string `json:"path,omitempty" jsonschema:"Optional absolute path to a file to analyze. If provided and text is empty, the file content will be read."`
}

// FogFinding represents a single Gunning Fog readability finding (long sentence or polysyllabic word).
type FogFinding struct {
	Line       int    `json:"line"`
	Span       [2]int `json:"span"`
	Category   string `json:"category"` // "long_sentence" | "complex_word"
	Match      string `json:"match"`
	Message    string `json:"message"`
	Suggestion string `json:"suggestion,omitempty"`
	Before     string `json:"before,omitempty"`
	After      string `json:"after,omitempty"`
}

// ParagraphFog holds per-block Gunning Fog readability telemetry.
type ParagraphFog struct {
	BlockIndex             int     `json:"block_index"`
	BlockType              string  `json:"block_type"`
	StartLine              int     `json:"start_line"`
	EndLine                int     `json:"end_line"`
	FogIndex               float64 `json:"fog_index"`
	Classification         string  `json:"classification"`
	TotalWords             int     `json:"total_words"`
	TotalSentences         int     `json:"total_sentences"`
	AverageSentenceLength  float64 `json:"average_sentence_length"`
	ComplexWords           int     `json:"complex_words"`
	PercentageComplexWords float64 `json:"percentage_complex_words"`
	HeatmapTint            string  `json:"heatmap_tint"` // "green" | "amber" | "red"
}

// FogResult defines the structured output for the fog tool.
type FogResult struct {
	FogIndex               float64        `json:"fog_index"`
	Classification         string         `json:"classification"`
	TotalWords             int            `json:"total_words"`
	TotalSentences         int            `json:"total_sentences"`
	AverageSentenceLength  float64        `json:"average_sentence_length"`
	PercentageComplexWords float64        `json:"percentage_complex_words"`
	ComplexWords           int            `json:"complex_words"`
	Findings               []FogFinding   `json:"findings,omitempty"`
	Paragraphs             []ParagraphFog `json:"paragraphs,omitempty"`
}

// Analyze runs the Gunning Fog readability analysis directly.
func Analyze(input FogParams, cfg ...Config) (*FogResult, error) {
	var c Config
	if len(cfg) > 0 {
		c = cfg[0]
	}
	_, res, err := handleFog(c, input)
	return res, err
}

// Handler executes the fog tool logic.
func Handler(ctx context.Context, req *mcp.CallToolRequest, input FogParams, cfg ...Config) (*mcp.CallToolResult, *FogResult, error) {
	var c Config
	if len(cfg) > 0 {
		c = cfg[0]
	}
	return handleFog(c, input)
}

func makeFogHandler(cfg Config) func(context.Context, *mcp.CallToolRequest, FogParams) (*mcp.CallToolResult, *FogResult, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, input FogParams) (*mcp.CallToolResult, *FogResult, error) {
		return Handler(ctx, req, input, cfg)
	}
}

func handleFog(cfg Config, input FogParams) (*mcp.CallToolResult, *FogResult, error) {
	rawText, err := resolveContent(cfg, input.Text, input.Path)
	if err != nil {
		return nil, nil, err
	}

	proseText := stripMarkdownForMetrics(rawText)
	totalWords, complexWords := CountWords(proseText)
	if totalWords == 0 {
		return nil, &FogResult{
			FogIndex:               0,
			Classification:         FogCategorySimplistic,
			TotalWords:             0,
			TotalSentences:         0,
			AverageSentenceLength:  0,
			PercentageComplexWords: 0,
			ComplexWords:           0,
			Findings:               []FogFinding{},
			Paragraphs:             []ParagraphFog{},
		}, nil
	}

	totalSentences := CountSentences(proseText)
	effectiveSentences := totalSentences
	if effectiveSentences == 0 {
		effectiveSentences = 1
	}

	averageSentenceLength := float64(totalWords) / float64(effectiveSentences)
	percentageComplexWords := 100 * (float64(complexWords) / float64(totalWords))
	index := math.Round(0.4*(averageSentenceLength+percentageComplexWords)*100) / 100

	classification := ClassifyFogIndex(index)
	pctRounded := math.Round(percentageComplexWords*100) / 100

	findings, paragraphs := analyzeParagraphsAndFindings(rawText)

	result := &FogResult{
		FogIndex:               index,
		Classification:         classification,
		TotalWords:             totalWords,
		TotalSentences:         totalSentences,
		AverageSentenceLength:  math.Round(averageSentenceLength*100) / 100,
		PercentageComplexWords: pctRounded,
		ComplexWords:           complexWords,
		Findings:               findings,
		Paragraphs:             paragraphs,
	}

	return nil, result, nil
}

func resolveContent(cfg Config, text, path string) (string, error) {
	if text != "" {
		return text, nil
	}
	if path == "" {
		return "", newError("either text or path must be provided")
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

func newError(format string, a ...any) error {
	return fmt.Errorf(format, a...)
}

// CountWords counts the number of words and complex words in a given text.
// It strips non-prose blocks (frontmatter, code fences, HTML comments), removes punctuation, and counts words.
func CountWords(text string) (int, int) {
	stripped := stripMarkdownForMetrics(text)
	cleanText := punctRegex.ReplaceAllString(stripped, "")
	words := strings.Fields(cleanText)

	complexWordCount := 0
	for _, word := range words {
		if IsComplexWord(word) {
			complexWordCount++
		}
	}

	return len(words), complexWordCount
}

// CountSentences counts the number of sentences in a given text.
// It strips non-prose blocks and counts sentence-ending punctuation (. ! ?).
func CountSentences(text string) int {
	stripped := stripMarkdownForMetrics(text)
	sentences := sentenceRegex.FindAllString(stripped, -1)
	return len(sentences)
}

// IsComplexWord determines if a word is "complex" by checking if it has three or more syllables.
// This implementation does not exclude proper nouns, familiar jargon, or compound words.
func IsComplexWord(word string) bool {
	return countSyllables(word) >= 3
}

// CalculateFogIndex calculates the Gunning Fog Index for a given text, rounded to two decimal places.
func CalculateFogIndex(text string) (float64, error) {
	proseText := stripMarkdownForMetrics(text)
	totalWords, complexWords := CountWords(proseText)
	totalSentences := CountSentences(proseText)

	if totalWords == 0 {
		return 0.0, newError("text does not contain any words")
	}
	if totalSentences == 0 {
		return 0.0, newError("text does not contain any sentences")
	}

	averageSentenceLength := float64(totalWords) / float64(totalSentences)
	percentageComplexWords := 100 * (float64(complexWords) / float64(totalWords))

	index := 0.4 * (averageSentenceLength + percentageComplexWords)
	return math.Round(index*100) / 100, nil
}

// ClassifyFogIndex classifies the Gunning Fog Index into a readability category.
func ClassifyFogIndex(index float64) string {
	switch {
	case index >= 22:
		return FogCategoryUnreadable
	case index >= 18:
		return FogCategoryHardToRead
	case index >= 13:
		return FogCategoryProfessional
	case index >= 9:
		return FogCategoryGeneral
	default:
		return FogCategorySimplistic
	}
}

func maskInlineCodeAndLinks(line string) string {
	masked := inlineCodeRe.ReplaceAllStringFunc(line, maskSpaces)
	masked = mdHugoLinkDestRe.ReplaceAllStringFunc(masked, func(m string) string {
		return "](" + strings.Repeat(" ", len(m)-3) + ")"
	})
	masked = mdLinkDestRe.ReplaceAllStringFunc(masked, func(m string) string {
		return "](" + strings.Repeat(" ", len(m)-3) + ")"
	})
	masked = shortcodeRe.ReplaceAllStringFunc(masked, maskSpaces)
	masked = htmlTagRe.ReplaceAllStringFunc(masked, maskSpaces)
	return masked
}

// analyzeParagraphsAndFindings computes line-indexed Gunning Fog findings
// (long sentences > 30 words and polysyllabic words >= 4 syllables) and per-block ParagraphFog slices.
func analyzeParagraphsAndFindings(rawText string) ([]FogFinding, []ParagraphFog) {
	findings := []FogFinding{}
	paragraphs := []ParagraphFog{}

	origLines := strings.Split(maskHTMLComments(rawText), "\n")
	maskedLines := maskNonProseLines(rawText)

	for idx, mLine := range maskedLines {
		lineNum := idx + 1
		if strings.TrimSpace(mLine) == "" {
			continue
		}
		rawLine := origLines[idx]
		searchLine := maskInlineCodeAndLinks(mLine)

		// 1. Complex word detection (4+ syllables)
		wLocs := wordTokenRe.FindAllStringIndex(searchLine, -1)
		for _, wLoc := range wLocs {
			word := rawLine[wLoc[0]:wLoc[1]]
			syllables := countSyllables(word)
			if syllables < 4 {
				continue
			}
			findings = append(findings, FogFinding{
				Line:     lineNum,
				Span:     [2]int{wLoc[0] + 1, wLoc[1] + 1},
				Category: "complex_word",
				Match:    word,
				Message:  fmt.Sprintf("Polysyllabic word %q (%d syllables) raises Gunning Fog; prefer a shorter synonym if possible.", word, syllables),
				Before:   strings.TrimSpace(rawLine),
			})
		}

		// 2. Long sentence detection (> 30 words on a single line)
		cleanLine := cleanProseLine(mLine)
		lineWords := strings.Fields(punctRegex.ReplaceAllString(cleanLine, ""))
		lineSentences := CountSentences(cleanLine)
		if lineSentences <= 1 && len(lineWords) > 30 {
			trimmedRaw := strings.TrimSpace(rawLine)
			startCol := max(strings.Index(rawLine, trimmedRaw), 0)
			findings = append(findings, FogFinding{
				Line:     lineNum,
				Span:     [2]int{startCol + 1, startCol + len(trimmedRaw) + 1},
				Category: "long_sentence",
				Match:    trimmedRaw,
				Message:  fmt.Sprintf("Sentence has %d words (target <= 25); split compound clauses to lower Gunning Fog.", len(lineWords)),
				Before:   trimmedRaw,
			})
		}
	}

	blocks := SegmentBlocks(rawText)
	for _, blk := range blocks {
		blkWords, blkComplex := CountWords(blk.CleanText)
		if blkWords == 0 {
			continue
		}
		blkSentences := CountSentences(blk.CleanText)
		effSentences := blkSentences
		if effSentences == 0 {
			effSentences = 1
		}
		asl := float64(blkWords) / float64(effSentences)
		pctComp := 100.0 * (float64(blkComplex) / float64(blkWords))
		blkFog := math.Round((0.4*(asl+pctComp))*100) / 100

		if blk.BlockType == "heading" || blkWords < 8 {
			blkFog = 0
		}

		tint := "green"
		switch {
		case blkFog >= 18.0:
			tint = "red"
		case blkFog >= 15.0:
			tint = "amber"
		}

		paragraphs = append(paragraphs, ParagraphFog{
			BlockIndex:             blk.BlockIndex,
			BlockType:              blk.BlockType,
			StartLine:              blk.StartLine,
			EndLine:                blk.EndLine,
			FogIndex:               blkFog,
			Classification:         ClassifyFogIndex(blkFog),
			TotalWords:             blkWords,
			TotalSentences:         effSentences,
			AverageSentenceLength:  math.Round(asl*100) / 100,
			ComplexWords:           blkComplex,
			PercentageComplexWords: math.Round(pctComp*100) / 100,
			HeatmapTint:            tint,
		})
	}

	return findings, paragraphs
}
