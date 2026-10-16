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

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func createFakeVale(t *testing.T) string {
	t.Helper()
	tmpDir := t.TempDir()
	fakeVale := filepath.Join(tmpDir, "fake-vale")
	if runtime.GOOS == "windows" {
		fakeVale += ".bat"
		if err := os.WriteFile(fakeVale, []byte("@echo {\"stdin.md\": []}\n"), 0755); err != nil {
			t.Fatalf("failed to write fake vale: %v", err)
		}
	} else {
		if err := os.WriteFile(fakeVale, []byte("#!/bin/sh\necho '{\"stdin.md\": []}'\n"), 0755); err != nil {
			t.Fatalf("failed to write fake vale: %v", err)
		}
	}
	return fakeVale
}

func TestRun_SuccessCases(t *testing.T) {
	origVale := valeBinOverride
	valeBinOverride = createFakeVale(t)
	defer func() { valeBinOverride = origVale }()

	testCases := []struct {
		name     string
		args     []string
		stdin    string
		expected string
	}{
		{"help flag", []string{"--help"}, "", "Usage:"},
		{"dash help flag", []string{"-help"}, "", "Usage:"},
		{"short help flag", []string{"-h"}, "", "Usage:"},
		{"help subcommand", []string{"help"}, "", "Usage:"},
		{"version flag", []string{"--version"}, "", version},
		{"dash version flag", []string{"-version"}, "", version},
		{"short version flag", []string{"-v"}, "", version},
		{"version subcommand", []string{"version"}, "", version},
		{"call fog arg", []string{"call", "fog", `{"text":"This is a simple sentence."}`}, "", `"fog_index"`},
		{"call slop stdin", []string{"call", "slop"}, `{"text":"This is a simple sentence."}`, `"overall_slop_score"`},
		{"call vale arg", []string{"call", "vale", `{"text":"This is a simple sentence."}`}, "", `"output"`},
		{"call vale_rules arg", []string{"call", "vale_rules", `{"action":"list"}`}, "", `"rules"`},
		{"call seo arg", []string{"call", "seo", `{"html":"<html><head><title>Valid SEO Title For Testing</title></head><body><h1>Heading</h1><p>Sentence.</p></body></html>"}`}, "", `"score"`},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()

			err := run(ctx, tc.args, strings.NewReader(tc.stdin), &stdout, &stderr)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !strings.Contains(stdout.String(), tc.expected) {
				t.Errorf("expected stdout to contain %q, got: %q", tc.expected, stdout.String())
			}
		})
	}
}

func TestRun_Audit(t *testing.T) {
	origVale := valeBinOverride
	valeBinOverride = createFakeVale(t)
	defer func() { valeBinOverride = origVale }()

	t.Run("audit from text arg", func(t *testing.T) {
		var stdout, stderr bytes.Buffer
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()

		payload := `{"text":"<html><head><title>Great Article About Testing</title></head><body><h1>Testing Guide</h1><p>Writing clear tests improves reliability.</p></body></html>","keyword":"testing"}`
		if err := run(ctx, []string{"audit", payload}, strings.NewReader(""), &stdout, &stderr); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		var got auditResult
		if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
			t.Fatalf("failed to decode audit JSON output: %v (raw: %s)", err, stdout.String())
		}
		if got.Fog == nil || got.Slop == nil || got.Vale == nil || got.SEO == nil {
			t.Fatalf("expected all 4 analyzer results in auditResult, got: %+v", got)
		}
		if len(got.Blocks) == 0 {
			t.Errorf("expected non-empty Blocks in auditResult")
		}
	})

	t.Run("audit from file path via stdin", func(t *testing.T) {
		tmpDir := t.TempDir()
		sampleFile := filepath.Join(tmpDir, "sample.html")
		content := `<html><head><title>Sample HTML File Title Here</title></head><body><h1>Main Heading</h1><p>This is a clean sentence.</p></body></html>`
		if err := os.WriteFile(sampleFile, []byte(content), 0644); err != nil {
			t.Fatalf("failed to write sample file: %v", err)
		}

		reqBytes, err := json.Marshal(auditParams{Path: sampleFile, Keyword: "sample"})
		if err != nil {
			t.Fatalf("failed to marshal params: %v", err)
		}

		var stdout, stderr bytes.Buffer
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()

		if err := run(ctx, []string{"audit"}, bytes.NewReader(reqBytes), &stdout, &stderr); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		var got auditResult
		if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
			t.Fatalf("failed to decode audit JSON output: %v", err)
		}
		if got.Fog == nil || got.Slop == nil || got.Vale == nil || got.SEO == nil {
			t.Fatalf("expected all 4 analyzer results in auditResult, got: %+v", got)
		}
		if got.SEO.DocType != "page" {
			t.Errorf("expected SEO.DocType 'page' for HTML file, got %q", got.SEO.DocType)
		}
	})

	t.Run("audit markdown doc mode with findings", func(t *testing.T) {
		var stdout, stderr bytes.Buffer
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()

		payload := `{"text":"# Project Guide\n\n## Overview\n\nWe delve into how to utilize the tool.","doc_type":"doc"}`
		if err := run(ctx, []string{"audit", payload}, strings.NewReader(""), &stdout, &stderr); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		var got auditResult
		if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
			t.Fatalf("failed to decode audit JSON output: %v", err)
		}
		if got.SEO == nil || got.SEO.DocType != "doc" {
			t.Fatalf("expected SEO.DocType 'doc', got: %+v", got.SEO)
		}
		if got.SEO.Score != 100 {
			t.Errorf("expected doc structure score 100, got %d", got.SEO.Score)
		}
		if got.Slop == nil || len(got.Slop.Findings) == 0 {
			t.Errorf("expected Slop.Findings to be populated for 'delve' and 'utilize', got: %+v", got.Slop)
		}
		if len(got.Blocks) != 3 {
			t.Errorf("expected 3 blocks in auditResult, got %d: %+v", len(got.Blocks), got.Blocks)
		}
	})
}

func TestRun_ErrorCases(t *testing.T) {
	testCases := []struct {
		name        string
		args        []string
		stdin       string
		errContains string
	}{
		{"bad flag", []string{"--unknown-flag"}, "", "unknown flag"},
		{"unknown command", []string{"unknowncmd"}, "", "unknown command"},
		{"call missing tool", []string{"call"}, "", "usage: speedgrapher call"},
		{"call unknown tool", []string{"call", "nonexistent", `{}`}, "", "unknown tool"},
		{"call removed analyze_seo tool", []string{"call", "analyze_seo", `{}`}, "", "unknown tool"},
		{"audit missing payload", []string{"audit"}, "", "audit input error"},
		{"audit invalid json", []string{"audit", "{bad"}, "", "failed to parse audit JSON"},
		{"audit empty params", []string{"audit", `{}`}, "", "audit requires non-empty"},
		{"mcp extra args", []string{"mcp", "extra"}, "", "unexpected arguments for mcp"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()

			err := run(ctx, tc.args, strings.NewReader(tc.stdin), &stdout, &stderr)
			if err == nil {
				t.Fatalf("expected error for case %s", tc.name)
			}
			if !strings.Contains(err.Error(), tc.errContains) {
				t.Errorf("expected error to contain %q, got: %q", tc.errContains, err.Error())
			}
		})
	}
}

func TestBuildInfoFallback(t *testing.T) {
	if version == "" {
		t.Errorf("expected version to be non-empty")
	}

	v := resolveVersionFromBuildInfo("fallback-v1")
	if v == "" {
		t.Errorf("expected non-empty version from resolveVersionFromBuildInfo")
	}
}

func TestRun_MCPWithCancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	var stdout, stderr bytes.Buffer
	err := run(ctx, []string{"mcp"}, strings.NewReader(""), &stdout, &stderr)
	if err != nil && !strings.Contains(err.Error(), "context canceled") {
		t.Errorf("expected nil or context canceled error, got: %v", err)
	}
}
