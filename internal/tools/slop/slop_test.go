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

package slop

import (
	"context"
	"os"
	"path/filepath"
	"testing"

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
			res := Calculate(tt.text)
			if res.OverallScore < tt.wantScoreThreshold && tt.wantScoreThreshold > 0 {
				t.Errorf("Calculate() gotScore = %v, want >= %v", res.OverallScore, tt.wantScoreThreshold)
			}
		})
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
		_, _, err := handleSlop(cfg, params)
		if err == nil {
			t.Error("expected error for empty file, got nil")
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
