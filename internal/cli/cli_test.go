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

package cli

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRun_NoArgs_PrintsHelp(t *testing.T) {
	var stdout, stderr bytes.Buffer
	err := Run(context.Background(), "1.0.0", []string{}, nil, &stdout, &stderr)
	if err != nil {
		t.Fatalf("expected no error with no args, got: %v", err)
	}
	output := stdout.String()
	if !strings.Contains(output, "Usage:") || !strings.Contains(output, "speedgrapher") {
		t.Errorf("expected help output, got: %s", output)
	}
	if !strings.Contains(output, "mcp") || !strings.Contains(output, "call") || !strings.Contains(output, "list") {
		t.Errorf("expected subcommands in help output, got: %s", output)
	}
}

func TestRun_HelpAndVersion(t *testing.T) {
	testCases := []struct {
		args     []string
		expected string
	}{
		{[]string{"help"}, "Usage:"},
		{[]string{"--help"}, "Usage:"},
		{[]string{"-h"}, "Usage:"},
		{[]string{"version"}, "1.2.3"},
		{[]string{"--version"}, "1.2.3"},
		{[]string{"-v"}, "1.2.3"},
	}

	for _, tc := range testCases {
		t.Run(strings.Join(tc.args, "_"), func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			err := Run(context.Background(), "1.2.3", tc.args, nil, &stdout, &stderr)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !strings.Contains(stdout.String(), tc.expected) {
				t.Errorf("expected output to contain %q, got: %q", tc.expected, stdout.String())
			}
		})
	}
}

func TestRun_UnknownCommand(t *testing.T) {
	var stdout, stderr bytes.Buffer
	err := Run(context.Background(), "dev", []string{"unknowncmd"}, nil, &stdout, &stderr)
	if err == nil {
		t.Fatal("expected error for unknown command")
	}
	if !strings.Contains(err.Error(), "unknown command: unknowncmd") {
		t.Errorf("expected unknown command message, got %v", err)
	}

	stdout.Reset()
	stderr.Reset()
	err = Run(context.Background(), "dev", []string{"--unknownflag"}, nil, &stdout, &stderr)
	if err == nil {
		t.Fatal("expected error for unknown flag")
	}
	if !strings.Contains(err.Error(), "unknown flag: --unknownflag") {
		t.Errorf("expected unknown flag message, got %v", err)
	}
}

func TestRun_List(t *testing.T) {
	var stdout, stderr bytes.Buffer
	err := Run(context.Background(), "dev", []string{"list"}, nil, &stdout, &stderr)
	if err != nil {
		t.Fatalf("unexpected error on list: %v", err)
	}
	out := stdout.String()
	expectedTools := []string{"fog", "slop", "seo", "vale"}
	for _, tool := range expectedTools {
		if !strings.Contains(out, tool) {
			t.Errorf("expected tool %q in list output, got:\n%s", tool, out)
		}
	}
}

func TestRun_Call_UnknownTool(t *testing.T) {
	var stdout, stderr bytes.Buffer
	err := Run(context.Background(), "dev", []string{"call", "non_existent_tool"}, nil, &stdout, &stderr)
	if err == nil {
		t.Fatal("expected error for unknown tool")
	}
	if !strings.Contains(err.Error(), "unknown tool") {
		t.Errorf("expected unknown tool error, got: %v", err)
	}
}

func TestRun_Call_MissingToolName(t *testing.T) {
	var stdout, stderr bytes.Buffer
	err := Run(context.Background(), "dev", []string{"call"}, nil, &stdout, &stderr)
	if err == nil {
		t.Fatal("expected error for missing tool name")
	}
	if !strings.Contains(err.Error(), "missing tool name") {
		t.Errorf("expected missing tool name error, got: %v", err)
	}
}

func TestRun_Call_Fog(t *testing.T) {
	var stdout, stderr bytes.Buffer
	args := []string{"call", "fog", `{"text": "The quick brown fox jumps over the lazy dog. It is a sunny day."}`}
	err := Run(context.Background(), "dev", args, nil, &stdout, &stderr)
	if err != nil {
		t.Fatalf("unexpected error calling fog: %v", err)
	}
	if !strings.Contains(stdout.String(), "fog_index") {
		t.Errorf("expected fog_index in output, got:\n%s", stdout.String())
	}
}

func TestRun_Call_Fog_Aliases(t *testing.T) {
	var stdout, stderr bytes.Buffer
	args := []string{"call", "gunning_fog", `{"text": "Simple test sentence."}`}
	err := Run(context.Background(), "dev", args, nil, &stdout, &stderr)
	if err != nil {
		t.Fatalf("unexpected error calling gunning_fog: %v", err)
	}
	if !strings.Contains(stdout.String(), "fog_index") {
		t.Errorf("expected fog_index in output, got:\n%s", stdout.String())
	}
}

func TestRun_Call_Fog_StdinJSON(t *testing.T) {
	var stdout, stderr bytes.Buffer
	stdin := strings.NewReader(`{"text": "This text is passed through standard input. It is easy to read."}`)
	err := Run(context.Background(), "dev", []string{"call", "fog"}, stdin, &stdout, &stderr)
	if err != nil {
		t.Fatalf("unexpected error calling fog with stdin: %v", err)
	}
	if !strings.Contains(stdout.String(), "fog_index") {
		t.Errorf("expected fog_index in output, got:\n%s", stdout.String())
	}
}

func TestRun_Call_Slop(t *testing.T) {
	var stdout, stderr bytes.Buffer
	args := []string{"call", "slop", `{"text": "In today's fast-paced world, delve into the intricate tapestry of AI."}`}
	err := Run(context.Background(), "dev", args, nil, &stdout, &stderr)
	if err != nil {
		t.Fatalf("unexpected error calling slop: %v", err)
	}
	if !strings.Contains(stdout.String(), "overall_slop_score") {
		t.Errorf("expected overall_slop_score in output, got:\n%s", stdout.String())
	}
}

func TestRun_Call_Slop_Aliases(t *testing.T) {
	for _, alias := range []string{"slop_score", "tropes"} {
		t.Run(alias, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			args := []string{"call", alias, `{"text": "A transformative paradigm shift."}`}
			err := Run(context.Background(), "dev", args, nil, &stdout, &stderr)
			if err != nil {
				t.Fatalf("unexpected error calling %s: %v", alias, err)
			}
			if !strings.Contains(stdout.String(), "overall_slop_score") {
				t.Errorf("expected overall_slop_score in output for alias %s, got:\n%s", alias, stdout.String())
			}
		})
	}
}

func TestRun_Call_SEO(t *testing.T) {
	var stdout, stderr bytes.Buffer
	htmlContent := `<html><head><title>Test Technical Documentation Page For SEO</title><meta name="description" content="A comprehensive guide to technical writing and SEO analysis for developers."/></head><body><h1>Technical Writing Guide</h1><p>Content goes here with details.</p><a href="/">Home</a></body></html>`
	args := []string{"call", "seo", `{"html": "` + strings.ReplaceAll(htmlContent, `"`, `\"`) + `", "keyword": "technical"}`}
	err := Run(context.Background(), "dev", args, nil, &stdout, &stderr)
	if err != nil {
		t.Fatalf("unexpected error calling seo: %v", err)
	}
	if !strings.Contains(stdout.String(), "checks") || !strings.Contains(stdout.String(), "score") {
		t.Errorf("expected SEO result with checks and score, got:\n%s", stdout.String())
	}
}

func TestRun_Call_SEO_Aliases(t *testing.T) {
	for _, alias := range []string{"analyze_seo", "seo_audit"} {
		t.Run(alias, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			args := []string{"call", alias, `{"html": "<html><head><title>Short</title></head><body><h1>Heading</h1></body></html>"}`}
			err := Run(context.Background(), "dev", args, nil, &stdout, &stderr)
			if err != nil {
				t.Fatalf("unexpected error calling %s: %v", alias, err)
			}
			if !strings.Contains(stdout.String(), "score") {
				t.Errorf("expected score in output for alias %s, got:\n%s", alias, stdout.String())
			}
		})
	}
}

func TestRun_Call_InvalidJSON(t *testing.T) {
	var stdout, stderr bytes.Buffer
	err := Run(context.Background(), "dev", []string{"call", "fog", "{invalid json"}, nil, &stdout, &stderr)
	if err == nil {
		t.Fatal("expected error for invalid JSON arguments")
	}
	if !strings.Contains(err.Error(), "invalid arguments") {
		t.Errorf("expected invalid arguments error, got: %v", err)
	}
}

func TestRun_Call_MissingJSONArgs(t *testing.T) {
	var stdout, stderr bytes.Buffer
	err := Run(context.Background(), "dev", []string{"call", "fog"}, nil, &stdout, &stderr)
	if err == nil {
		t.Fatal("expected error for missing arguments")
	}
}

func TestRun_Call_EmptyTextError(t *testing.T) {
	var stdout, stderr bytes.Buffer
	err := Run(context.Background(), "dev", []string{"call", "fog", `{"text": ""}`}, nil, &stdout, &stderr)
	if err == nil {
		t.Fatal("expected error for empty text")
	}
}

func TestRun_Init(t *testing.T) {
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	_ = os.Chdir(tmpDir)
	defer func() { _ = os.Chdir(origDir) }()

	var stdout, stderr bytes.Buffer
	err := Run(context.Background(), "dev", []string{"init"}, nil, &stdout, &stderr)
	if err != nil {
		t.Fatalf("run init failed: %v", err)
	}

	// Verify speedgrapher.json was created
	configFile := filepath.Join(tmpDir, "speedgrapher.json")
	if _, err := os.Stat(configFile); err != nil {
		t.Fatalf("expected speedgrapher.json to exist: %v", err)
	}

	// Verify workspace install happened
	workspaceConfig := filepath.Join(tmpDir, ".agents", "mcp_config.json")
	if _, err := os.Stat(workspaceConfig); err != nil {
		t.Fatalf("expected .agents/mcp_config.json to exist: %v", err)
	}
}

func TestRun_MCP_Cancellation(_ *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()

	var stdout, stderr bytes.Buffer
	_ = Run(ctx, "dev", []string{"mcp"}, nil, &stdout, &stderr)
}
