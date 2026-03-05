// Copyright 2025 Google LLC
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
	"regexp"
	"strings"

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
	}

	clichePatterns = []string{
		`(?i)in today'?s .* world`, `(?i)let'?s dive in`, `(?i)whether you'?re`, `(?i)look no further`,
		`(?i)at the end of the day`, `(?i)only time will tell`, `(?i)in this article, we`,
		`(?i)this post details`, `(?i)let'?s have a closer look`, `(?i)let'?s take a closer look`,
		`(?i)the key to success`, `(?i)hope you enjoyed this article`, `(?i)leave your comments below`,
		`(?i)feel free to reach out`, `(?i)a crucial aspect`,
		`(?i)\bthe[ \t]+(?:[a-z0-9\-]+[ \t]+){0,4}[a-z0-9\-]+[ \t]*:[ \t]*(?:the[ \t]+)?(?:[a-z0-9\-]+[ \t]+){0,4}[a-z0-9\-]+\b`,
		`(?i)\b(?:[a-z0-9\-]+[ \t]+){1,5}\(the[ \t]+(?:[a-z0-9\-]+[ \t]+){0,4}[a-z0-9\-]+\)`,
		`(?i)\b[a-z0-9]+[\s]*[—-][\s]*[a-z0-9]+[\s]*[—-][\s]*[a-z0-9]+\b`,
	}

	analogyBridges = []string{
		`(?i)think of .* as`, `(?i)akin to`, `(?i)similar to`, `(?i)like a`, `(?i)imagine a`,
	}

	analogyTargets = []string{
		"orchestra", "conductor", "blueprint", "engine", "symphony", "canvas", "maestro", "brain",
	}

	stopWords = map[string]bool{
		"the": true, "is": true, "at": true, "which": true, "on": true, "in": true, "a": true, "an": true, "and": true, "or": true, "but": true, "of": true, "to": true, "for": true, "with": true,
	}
)

var (
	lexicalSlopRegex *regexp.Regexp
	structuralRegex  *regexp.Regexp
	bridgeRegexes    []*regexp.Regexp
)

func init() {
	var escapedLexical []string
	for _, word := range lexicalSlopWords {
		escapedLexical = append(escapedLexical, `\b`+regexp.QuoteMeta(word)+`\b`)
	}
	lexicalSlopRegex = regexp.MustCompile("(?i)" + strings.Join(escapedLexical, "|"))

	structuralRegex = regexp.MustCompile(strings.Join(append(clichePatterns, analogyBridges...), "|"))

	for _, b := range analogyBridges {
		bridgeRegexes = append(bridgeRegexes, regexp.MustCompile(b))
	}
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

type SlopResult struct {
	LexicalSlop       CriteriaResult `json:"lexical_slop"`
	FillerWords       CriteriaResult `json:"filler_words"`
	StructuralCliches CriteriaResult `json:"structural_cliches"`
	RhythmVariance    CriteriaResult `json:"rhythm_variance"`
	OverallScore      float64        `json:"overall_slop_score"`
}

func Calculate(text string) SlopResult {
	words := strings.Fields(regexp.MustCompile(`(?i)[^a-z0-9\s]`).ReplaceAllString(text, ""))
	totalW := float64(len(words))
	if totalW == 0 {
		return SlopResult{}
	}

	// 1. Lexical Analysis
	lexSlopCount := float64(len(lexicalSlopRegex.FindAllString(text, -1)))
	fillerCount := 0.0
	for _, w := range words {
		if stopWords[strings.ToLower(w)] {
			fillerCount++
		}
	}

	lexDensity := (lexSlopCount / totalW) * 1000
	fillerRatio := fillerCount / totalW

	// 2. Structural Patterns
	structMatches := structuralRegex.FindAllString(text, -1)
	actualStructCount := 0.0
	lowerText := strings.ToLower(text)
	for _, m := range structMatches {
		isBridge := false
		for _, br := range bridgeRegexes {
			if br.MatchString(m) {
				isBridge = true
				break
			}
		}

		if isBridge {
			for _, t := range analogyTargets {
				if strings.Contains(lowerText, t) {
					actualStructCount++
					break
				}
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
	structDensity := (actualStructCount / totalW) * 1000

	// 3. Rhythm Variance
	sentenceRegex := regexp.MustCompile(`[.!?]\s+`)
	sentences := sentenceRegex.Split(text, -1)
	cv := 0.0
	if len(sentences) > 1 {
		var lens []float64
		sum := 0.0
		for _, s := range sentences {
			if trimmed := strings.TrimSpace(s); trimmed != "" {
				l := float64(len(strings.Fields(trimmed)))
				lens = append(lens, l)
				sum += l
			}
		}
		if len(lens) > 1 {
			mean := sum / float64(len(lens))
			varianceSum := 0.0
			for _, l := range lens {
				varianceSum += math.Pow(l-mean, 2)
			}
			stdDev := math.Sqrt(varianceSum / float64(len(lens)))
			if mean > 0 {
				cv = stdDev / mean
			}
		}
	}

	res := SlopResult{
		LexicalSlop:       CriteriaResult{Score: normalizeSmooth(lexDensity, 1.0, 8.0), Raw: lexDensity},
		FillerWords:       CriteriaResult{Score: normalizeSmooth(fillerRatio, 0.35, 0.55), Raw: fillerRatio},
		StructuralCliches: CriteriaResult{Score: normalizeSmooth(structDensity, 0.5, 4.0), Raw: structDensity},
		RhythmVariance:    CriteriaResult{Score: normalizeSmooth(cv, 0.75, 0.35), Raw: cv},
	}

	res.OverallScore = math.Round((res.LexicalSlop.Score+res.FillerWords.Score+res.StructuralCliches.Score+res.RhythmVariance.Score)/4*100) / 100
	return res
}

// Register registers the slop tool with the server.
func Register(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "slop",
		Description: "Calculates a 'slop score' (0-100) to estimate 'AI-ness' in text. Higher means more AI-like.",
	}, slopHandler)
}

// SlopParams defines the input parameters for the slop tool.
type SlopParams struct {
	Text string `json:"text" jsonschema:"The text to analyze for AI slop."`
}

func slopHandler(_ context.Context, _ *mcp.CallToolRequest, input SlopParams) (*mcp.CallToolResult, *SlopResult, error) {
	text := input.Text
	if text == "" {
		return nil, nil, fmt.Errorf("text cannot be empty")
	}

	res := Calculate(text)
	return nil, &res, nil
}
