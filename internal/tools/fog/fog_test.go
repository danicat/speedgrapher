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
	"os"
	"path/filepath"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestCountWords(t *testing.T) {
	testCases := []struct {
		name                 string
		text                 string
		expectedWords        int
		expectedComplexWords int
	}{
		{
			name:                 "Simple case",
			text:                 "This is a sentence. This is another sentence.",
			expectedWords:        8,
			expectedComplexWords: 1, // another (3); sentence (2) is not complex
		},
		{
			name:                 "Empty string",
			text:                 "",
			expectedWords:        0,
			expectedComplexWords: 0,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			words, complexWords := CountWords(tc.text)
			if words != tc.expectedWords {
				t.Errorf("expected %d words, got %d", tc.expectedWords, words)
			}
			if complexWords != tc.expectedComplexWords {
				t.Errorf("expected %d complex words, got %d", tc.expectedComplexWords, complexWords)
			}
		})
	}
}

func TestCountSentences(t *testing.T) {
	testCases := []struct {
		name     string
		text     string
		expected int
	}{
		{
			name:     "Empty string",
			text:     "",
			expected: 0,
		},
		{
			name:     "Multiple punctuation",
			text:     "What is this? I don't know! Let's find out.",
			expected: 3,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			got := CountSentences(tc.text)
			if got != tc.expected {
				t.Errorf("expected %d, got %d", tc.expected, got)
			}
		})
	}
}

func TestIsComplexWord(t *testing.T) {
	testCases := []struct {
		word     string
		expected bool
	}{
		{"complex", false},
		{"difficult", true},
	}

	for _, tc := range testCases {
		t.Run(tc.word, func(t *testing.T) {
			if got := IsComplexWord(tc.word); got != tc.expected {
				t.Errorf("for word '%s', expected %t but got %t", tc.word, tc.expected, got)
			}
		})
	}
}

func TestClassifyFogIndex(t *testing.T) {
	testCases := []struct {
		name      string
		atVal     float64
		wantAt    string
		belowVal  float64
		wantBelow string
	}{
		{
			name:      "Threshold 22 Unreadable vs Hard to Read",
			atVal:     22.0,
			wantAt:    FogCategoryUnreadable,
			belowVal:  21.99,
			wantBelow: FogCategoryHardToRead,
		},
		{
			name:      "Threshold 18 Hard to Read vs Professional",
			atVal:     18.0,
			wantAt:    FogCategoryHardToRead,
			belowVal:  17.99,
			wantBelow: FogCategoryProfessional,
		},
		{
			name:      "Threshold 13 Professional vs General",
			atVal:     13.0,
			wantAt:    FogCategoryProfessional,
			belowVal:  12.99,
			wantBelow: FogCategoryGeneral,
		},
		{
			name:      "Threshold 9 General vs Simplistic",
			atVal:     9.0,
			wantAt:    FogCategoryGeneral,
			belowVal:  8.99,
			wantBelow: FogCategorySimplistic,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ClassifyFogIndex(tc.atVal); got != tc.wantAt {
				t.Errorf("ClassifyFogIndex(%v) = %q, want %q", tc.atVal, got, tc.wantAt)
			}
			if got := ClassifyFogIndex(tc.belowVal); got != tc.wantBelow {
				t.Errorf("ClassifyFogIndex(%v) = %q, want %q", tc.belowVal, got, tc.wantBelow)
			}
		})
	}
}

func TestHandleFog(t *testing.T) {
	ctx := context.Background()

	t.Run("Valid Text input", func(t *testing.T) {
		cfg := Config{}
		params := FogParams{Text: "This is a simple sentence. Here is another sentence."}
		_, res, err := handleFog(cfg, params)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res == nil {
			t.Fatal("expected non-nil result")
		}
		if res.TotalWords != 9 {
			t.Errorf("expected 9 words, got %d", res.TotalWords)
		}
		if res.TotalSentences != 2 {
			t.Errorf("expected 2 sentences, got %d", res.TotalSentences)
		}
		if res.FogIndex <= 0 {
			t.Errorf("expected positive FogIndex, got %f", res.FogIndex)
		}
		if res.Classification == "" {
			t.Errorf("expected non-empty classification")
		}
	})

	t.Run("Valid Path input with relative path and WorkspaceDir", func(t *testing.T) {
		tempDir := t.TempDir()
		subDir := filepath.Join(tempDir, "sub")
		if err := os.MkdirAll(subDir, 0755); err != nil {
			t.Fatalf("failed to create sub dir: %v", err)
		}
		filePath := filepath.Join(subDir, "doc.md")
		content := "Automated testing is a cornerstone of modern software development."
		if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
			t.Fatalf("failed to write temp file: %v", err)
		}

		cfg := Config{WorkspaceDir: tempDir}
		params := FogParams{Path: "sub/doc.md"}
		_, res, err := handleFog(cfg, params)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res == nil {
			t.Fatal("expected non-nil result")
		}
		if res.TotalWords != 9 {
			t.Errorf("expected 9 words, got %d", res.TotalWords)
		}
	})

	t.Run("Valid Path input with relative path and empty WorkspaceDir", func(t *testing.T) {
		tempDir := t.TempDir()
		filePath := filepath.Join(tempDir, "rel_test.txt")
		content := "This is a test sentence in a file."
		if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
			t.Fatalf("failed to write temp file: %v", err)
		}

		// Use relative path from current directory
		cwd, err := os.Getwd()
		if err != nil {
			t.Fatalf("failed to get cwd: %v", err)
		}
		relPath, err := filepath.Rel(cwd, filePath)
		if err != nil {
			t.Fatalf("failed to get rel path: %v", err)
		}

		cfg := Config{}
		params := FogParams{Path: relPath}
		_, res, err := handleFog(cfg, params)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res == nil {
			t.Fatal("expected non-nil result")
		}
		if res.TotalWords != 8 {
			t.Errorf("expected 8 words, got %d", res.TotalWords)
		}
	})

	t.Run("Text takes precedence over Path when both provided", func(t *testing.T) {
		tempDir := t.TempDir()
		filePath := filepath.Join(tempDir, "unused.txt")
		if err := os.WriteFile(filePath, []byte("Ignored file content."), 0644); err != nil {
			t.Fatalf("failed to write temp file: %v", err)
		}

		cfg := Config{}
		params := FogParams{
			Text: "Direct text is prioritized over file path.",
			Path: filePath,
		}
		_, res, err := handleFog(cfg, params)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.TotalWords != 7 {
			t.Errorf("expected 7 words from direct text, got %d", res.TotalWords)
		}
	})

	t.Run("Missing text and path", func(t *testing.T) {
		cfg := Config{}
		params := FogParams{}
		_, _, err := handleFog(cfg, params)
		if err == nil {
			t.Error("expected error for empty text and path, got nil")
		}
	})

	t.Run("Nonexistent file path", func(t *testing.T) {
		cfg := Config{}
		params := FogParams{Path: "/nonexistent/path/does_not_exist.txt"}
		_, _, err := handleFog(cfg, params)
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
		params := FogParams{Path: filePath}
		_, res, err := handleFog(cfg, params)
		if err != nil {
			t.Fatalf("unexpected error for empty file: %v", err)
		}
		if res == nil || res.FogIndex != 0 || res.TotalWords != 0 {
			t.Errorf("expected zeroed FogResult for empty file, got %+v", res)
		}
	})

	t.Run("Frontmatter-only file", func(t *testing.T) {
		cfg := Config{}
		params := FogParams{Text: "---\ntitle: \"New Draft\"\nslug: \"generative-ui\"\n---\n\n"}
		_, res, err := handleFog(cfg, params)
		if err != nil {
			t.Fatalf("unexpected error for frontmatter-only text: %v", err)
		}
		if res == nil || res.FogIndex != 0 || res.TotalWords != 0 {
			t.Errorf("expected zeroed FogResult for frontmatter-only text, got %+v", res)
		}
	})

	t.Run("File with no sentences", func(t *testing.T) {
		tempDir := t.TempDir()
		filePath := filepath.Join(tempDir, "no_sentences.txt")
		if err := os.WriteFile(filePath, []byte("just some words without punctuation"), 0644); err != nil {
			t.Fatalf("failed to write temp file: %v", err)
		}

		cfg := Config{}
		params := FogParams{Path: filePath}
		_, res, err := handleFog(cfg, params)
		if err != nil {
			t.Fatalf("unexpected error for text without sentence punctuation: %v", err)
		}
		if res == nil || res.TotalWords != 5 || res.FogIndex <= 0 {
			t.Errorf("expected valid FogResult for text without punctuation, got %+v", res)
		}
	})

	t.Run("makeFogHandler closure", func(t *testing.T) {
		handler := makeFogHandler(Config{})
		_, res, err := handler(ctx, nil, FogParams{Text: "Testing the handler closure with a valid sentence."})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res == nil {
			t.Fatal("expected non-nil result")
		}
	})
}

func TestRegister(t *testing.T) {
	ctx := context.Background()
	server := mcp.NewServer(&mcp.Implementation{Name: "test-server"}, nil)
	Register(server, Config{WorkspaceDir: t.TempDir()})

	t1, t2 := mcp.NewInMemoryTransports()
	if _, err := server.Connect(ctx, t1, nil); err != nil {
		t.Fatalf("server.Connect failed: %v", err)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "test-client"}, nil)
	session, err := client.Connect(ctx, t2, nil)
	if err != nil {
		t.Fatalf("client.Connect failed: %v", err)
	}
	defer func() { _ = session.Close() }()

	res, err := session.CallTool(ctx, &mcp.CallToolParams{
		Name: "fog",
		Arguments: map[string]any{
			"text": "This is a simple sentence.",
		},
	})
	if err != nil || res.IsError {
		t.Fatalf("CallTool(fog) failed: err=%v, res=%+v", err, res)
	}
}

func TestFog_BlockSegmentationAndFindings(t *testing.T) {
	md := `---
title: "Readability Architecture"
---
<!-- review(p0): Complicated comment that should be ignored -->
# System Architecture

We built a complicated configuration to verify how the readability analyzer evaluates polysyllabic words and long sentences across paragraphs when scanning technical prose that runs well past thirty words in a single uninterrupted line.

> Service Level Objectives (SLOs) define reliability targets for each service.

- Configure the threshold in the dashboard.
- Audit policies before deployment.

` + "```go\n// Code block should be ignored: complicated configuration\nfunc main() {}\n```" + `
`
	res, err := Analyze(FogParams{Text: md})
	if err != nil {
		t.Fatalf("Analyze() unexpected error: %v", err)
	}

	foundComplex := false
	foundLongSentence := false
	for _, f := range res.Findings {
		if f.Category == "complex_word" && f.Match == "complicated" {
			foundComplex = true
			if f.Line != 7 {
				t.Errorf("expected 'complicated' finding on line 7, got line %d", f.Line)
			}
		}
		if f.Category == "long_sentence" {
			foundLongSentence = true
			if f.Line != 7 {
				t.Errorf("expected long_sentence finding on line 7, got line %d", f.Line)
			}
		}
	}
	if !foundComplex {
		t.Errorf("expected to find 'complicated' complex_word finding, got %+v", res.Findings)
	}
	if !foundLongSentence {
		t.Errorf("expected to find long_sentence finding on line 7, got %+v", res.Findings)
	}

	// Verify segmented blocks: heading (line 5), paragraph (line 7), blockquote (line 9), list (lines 11-12)
	if len(res.Paragraphs) != 4 {
		t.Fatalf("expected 4 segmented prose blocks, got %d: %+v", len(res.Paragraphs), res.Paragraphs)
	}
	wantTypes := []string{"heading", "paragraph", "blockquote", "list"}
	wantStarts := []int{5, 7, 9, 11}
	for i, p := range res.Paragraphs {
		if p.BlockType != wantTypes[i] {
			t.Errorf("block %d: expected type %q, got %q", i, wantTypes[i], p.BlockType)
		}
		if p.StartLine != wantStarts[i] {
			t.Errorf("block %d: expected start_line %d, got %d", i, wantStarts[i], p.StartLine)
		}
		if p.HeatmapTint != "green" && p.HeatmapTint != "amber" && p.HeatmapTint != "red" {
			t.Errorf("block %d: invalid heatmap_tint %q", i, p.HeatmapTint)
		}
	}
}

func TestAnalyze_HugoShortcodeLinksIgnored(t *testing.T) {
	withHugo := `In the [previous article]({{< ref "/posts/20261006-building-agentic-backends-with-genkit-go" >}}), we built an agent.`
	withNormalLink := `In the [previous article](https://example.com/post), we built an agent.`

	resHugo, err := Analyze(FogParams{Text: withHugo})
	if err != nil {
		t.Fatalf("Analyze(withHugo) unexpected error: %v", err)
	}
	resNormal, err := Analyze(FogParams{Text: withNormalLink})
	if err != nil {
		t.Fatalf("Analyze(withNormalLink) unexpected error: %v", err)
	}

	if resHugo.TotalWords != resNormal.TotalWords {
		t.Errorf("Hugo shortcode link leaked into word count: got %d words, want %d", resHugo.TotalWords, resNormal.TotalWords)
	}
	if resHugo.ComplexWords != resNormal.ComplexWords {
		t.Errorf("Hugo shortcode link leaked into complex words: got %d, want %d", resHugo.ComplexWords, resNormal.ComplexWords)
	}
	if resHugo.FogIndex != resNormal.FogIndex {
		t.Errorf("Hugo shortcode link affected FogIndex: got %.2f, want %.2f", resHugo.FogIndex, resNormal.FogIndex)
	}
}
