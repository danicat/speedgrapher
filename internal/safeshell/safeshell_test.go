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

package safeshell_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/danicat/speedgrapher/internal/safeshell"
)

func TestValidate(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
	}{
		// Valid inputs (direct execve passes arguments directly without shell evaluation)
		{"Simple command", "go", false},
		{"Subcommand", "version", false},
		{"Flag", "-f", false},
		{"Format string without dollar/pipe", "{{.Dir}}", false},
		{"Import path", "github.com/google/uuid", false},
		{"Path with dots and slashes", "./foo/bar/baz.go", false},
		{"Alphanumeric with dashes and underscores", "my-arg_123", false},

		// Regex filters with dollar signs and anchors
		{"Regex test filter", "-run=^TestAuth$", false},
		{"Benchmark regex filter", "-bench=^BenchmarkHash$", false},

		// SQL queries with operators (<, >, ;, newlines, carriage returns)
		{"SQL query with comparisons", "SELECT * FROM all_coverage WHERE count < 5 AND count > 0\nORDER BY count", false},
		{"SQL query with semicolon", "SELECT * FROM all_tests WHERE action = 'fail';", false},

		// Arguments with pipes, redirects, dollar signs, backticks
		{"Pipe in argument", "cat|sh", false},
		{"Backgrounding in argument", "echo&", false},
		{"Semicolon in argument", "echo;rm -rf /", false},
		{"Redirect input in argument", "cat<file", false},
		{"Redirect output in argument", "echo>file", false},
		{"Backticks in argument", "`whoami`", false},
		{"Dollar variable in argument", "$PATH", false},
		{"Subshell expansion in argument", "$(id)", false},
		{"Newline in argument", "echo\nhello", false},
		{"Carriage return in argument", "echo\rhello", false},

		// Disallowed null bytes
		{"Null byte", "echo\x00hello", true},
		{"Trailing null byte", "go\x00", true},
		{"Leading null byte", "\x00go", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := safeshell.Validate(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
			}
		})
	}
}

func TestValidateArgs(t *testing.T) {
	t.Run("Valid args", func(t *testing.T) {
		err := safeshell.ValidateArgs("version", "-v", "--flag=val")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("Arg with null byte", func(t *testing.T) {
		err := safeshell.ValidateArgs("version", "bad\x00arg")
		if err == nil {
			t.Fatal("expected error, got nil")
		}
	})
}

func TestValidateCommandName(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{"Valid command", "go", false},
		{"Valid binary with path", "/usr/local/bin/go", false},
		{"Valid binary with dashes", "golangci-lint", false},
		{"Valid relative path", "./bin/vale", false},
		{"Empty command name", "", true},
		{"Whitespace only command name", "   ", true},
		{"Command name with newline", "go\n", true},
		{"Command name with carriage return", "go\r", true},
		{"Command name with null byte", "go\x00", true},
		{"Command name with tab", "go\t", true},
		{"Command name with escape", "go\x1b", true},
		{"Command name with SOH", "go\x01", true},
		{"Command name with DEL", "go\x7f", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := safeshell.ValidateCommandName(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateCommandName(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
			}
		})
	}
}

func TestIsAllowedBinary(t *testing.T) {
	allowed := []string{"vale", "git", "hugo", "go"}

	tests := []struct {
		name     string
		binary   string
		allowed  []string
		expected bool
	}{
		{"Exact match", "vale", allowed, true},
		{"Path match", "/usr/local/bin/vale", allowed, true},
		{"Relative path match", "./bin/git", allowed, true},
		{"Case insensitive match", "VALE", allowed, true},
		{"Not in list", "curl", allowed, false},
		{"Wildcard allowed", "anything", []string{"*"}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := safeshell.IsAllowedBinary(tt.binary, tt.allowed)
			if got != tt.expected {
				t.Errorf("IsAllowedBinary(%q, %v) = %v, want %v", tt.binary, tt.allowed, got, tt.expected)
			}
		})
	}
}

func TestValidateBinary(t *testing.T) {
	t.Run("Standard mode without explicit allowlist allows valid command", func(t *testing.T) {
		err := safeshell.ValidateBinary("custom-tool", nil, safeshell.ModeStandard)
		if err != nil {
			t.Errorf("expected nil error, got %v", err)
		}
	})

	t.Run("Standard mode with explicit allowlist filters command", func(t *testing.T) {
		err := safeshell.ValidateBinary("custom-tool", []string{"vale", "git"}, safeshell.ModeStandard)
		if err == nil {
			t.Error("expected error for unlisted binary in standard mode with allowlist, got nil")
		}

		err = safeshell.ValidateBinary("vale", []string{"vale", "git"}, safeshell.ModeStandard)
		if err != nil {
			t.Errorf("expected nil error for allowed binary, got %v", err)
		}
	})

	t.Run("Strict mode enforces default allowlist", func(t *testing.T) {
		err := safeshell.ValidateBinary("untrusted-binary", nil, safeshell.ModeStrict)
		if err == nil {
			t.Error("expected error in strict mode for unlisted binary, got nil")
		}

		err = safeshell.ValidateBinary("vale", nil, safeshell.ModeStrict)
		if err != nil {
			t.Errorf("expected default allowed binary to pass in strict mode, got %v", err)
		}
	})

	t.Run("Permissive mode allows any valid command name", func(t *testing.T) {
		err := safeshell.ValidateBinary("untrusted-binary", []string{"vale"}, safeshell.ModePermissive)
		if err != nil {
			t.Errorf("permissive mode should allow valid command name, got %v", err)
		}
	})

	t.Run("Unknown mode returns error", func(t *testing.T) {
		err := safeshell.ValidateBinary("vale", nil, safeshell.Mode("invalid"))
		if err == nil {
			t.Error("expected error for unknown mode, got nil")
		}
	})

	t.Run("Invalid command name fails regardless of mode", func(t *testing.T) {
		err := safeshell.ValidateBinary("go\n", nil, safeshell.ModePermissive)
		if err == nil {
			t.Error("expected error for invalid command name in permissive mode, got nil")
		}
	})
}

func TestCommandContext(t *testing.T) {
	ctx := context.Background()

	t.Run("Valid command and args", func(t *testing.T) {
		cmd, err := safeshell.CommandContext(ctx, "go", "version")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if cmd == nil {
			t.Fatal("expected non-nil cmd")
		}
		if len(cmd.Args) != 2 || cmd.Args[0] != "go" || cmd.Args[1] != "version" {
			t.Errorf("cmd.Args = %v, want [go version]", cmd.Args)
		}
	})

	t.Run("Invalid command name - empty", func(t *testing.T) {
		cmd, err := safeshell.CommandContext(ctx, "", "version")
		if err == nil {
			t.Error("expected error for empty command name, got nil")
		}
		if cmd != nil {
			t.Errorf("expected nil cmd, got %v", cmd)
		}
	})

	t.Run("Invalid command name - newline", func(t *testing.T) {
		cmd, err := safeshell.CommandContext(ctx, "go\n", "version")
		if err == nil {
			t.Error("expected error for newline in command name, got nil")
		}
		if cmd != nil {
			t.Errorf("expected nil cmd, got %v", cmd)
		}
	})

	t.Run("Invalid argument - null byte", func(t *testing.T) {
		cmd, err := safeshell.CommandContext(ctx, "go", "list\x00")
		if err == nil {
			t.Error("expected error for null byte in argument, got nil")
		}
		if cmd != nil {
			t.Errorf("expected nil cmd, got %v", cmd)
		}
	})
}

func TestCommandContextWithOptions(t *testing.T) {
	ctx := context.Background()
	tmpDir := t.TempDir()

	opts := safeshell.Options{
		Mode:            safeshell.ModeStrict,
		AllowedBinaries: []string{"go"},
		Timeout:         5 * time.Second,
		Dir:             tmpDir,
		Env:             []string{"FOO=BAR"},
		Stdin:           strings.NewReader("input text"),
	}

	cmd, err := safeshell.CommandContextWithOptions(ctx, opts, "go", "version")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cmd.Dir != tmpDir {
		t.Errorf("cmd.Dir = %q, want %q", cmd.Dir, tmpDir)
	}
	if len(cmd.Env) != 1 || cmd.Env[0] != "FOO=BAR" {
		t.Errorf("cmd.Env = %v, want [FOO=BAR]", cmd.Env)
	}
	if cmd.Stdin == nil {
		t.Error("cmd.Stdin is nil")
	}

	// Strict rejection
	_, err = safeshell.CommandContextWithOptions(ctx, opts, "curl", "https://example.com")
	if err == nil {
		t.Error("expected error for rejected binary in strict mode, got nil")
	}
}

func TestExecute(t *testing.T) {
	ctx := context.Background()

	t.Run("Successful execution", func(t *testing.T) {
		res, err := safeshell.Execute(ctx, "go", "version")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res == nil {
			t.Fatal("expected non-nil result")
		}
		if res.ExitCode != 0 {
			t.Errorf("expected exit code 0, got %d", res.ExitCode)
		}
		if !strings.Contains(string(res.Stdout), "go version") {
			t.Errorf("unexpected stdout: %s", string(res.Stdout))
		}
		if len(res.Combined) == 0 {
			t.Error("expected non-empty combined output")
		}
		if res.String() == "" {
			t.Error("expected non-empty String() output")
		}
	})

	t.Run("Command failure capturing exit code and stderr", func(t *testing.T) {
		res, err := safeshell.Execute(ctx, "go", "vet", "non_existent_pkg_speedgrapher_12345")
		if err == nil {
			t.Fatal("expected error for non-existent package vet, got nil")
		}
		if res == nil {
			t.Fatal("expected non-nil result even on failure")
		}
		if res.ExitCode == 0 {
			t.Errorf("expected non-zero exit code, got %d", res.ExitCode)
		}
		var exitErr *safeshell.ExitError
		if !errors.As(err, &exitErr) {
			t.Errorf("expected *safeshell.ExitError, got %T: %v", err, err)
		} else {
			if exitErr.ExitCode != res.ExitCode {
				t.Errorf("ExitError code %d != Result code %d", exitErr.ExitCode, res.ExitCode)
			}
			if exitErr.Error() == "" {
				t.Error("ExitError.Error() is empty")
			}
			if exitErr.Unwrap() == nil {
				t.Error("ExitError.Unwrap() returned nil")
			}
		}
	})
}

func TestExecuteWithOptions(t *testing.T) {
	ctx := context.Background()

	t.Run("Timeout cancellation", func(t *testing.T) {
		var script string
		var binary string
		tmpDir := t.TempDir()

		if runtime.GOOS == "windows" {
			binary = filepath.Join(tmpDir, "sleep.bat")
			script = "@echo off\nping -n 5 127.0.0.1 >nul\n"
		} else {
			binary = filepath.Join(tmpDir, "sleep.sh")
			script = "#!/bin/sh\nsleep 5\n"
		}

		if err := os.WriteFile(binary, []byte(script), 0755); err != nil {
			t.Fatalf("failed to write sleep script: %v", err)
		}

		opts := safeshell.Options{
			Mode:    safeshell.ModePermissive,
			Timeout: 50 * time.Millisecond,
		}

		start := time.Now()
		_, err := safeshell.ExecuteWithOptions(ctx, opts, binary)
		elapsed := time.Since(start)

		if err == nil {
			t.Fatal("expected timeout error, got nil")
		}
		if elapsed > 3*time.Second {
			t.Errorf("command took too long to cancel: %v", elapsed)
		}
	})

	t.Run("MaxOutputBytes limit", func(t *testing.T) {
		opts := safeshell.Options{
			Mode:           safeshell.ModeStandard,
			MaxOutputBytes: 5,
		}

		res, err := safeshell.ExecuteWithOptions(ctx, opts, "go", "version")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(res.Stdout) > 5 {
			t.Errorf("stdout length %d > MaxOutputBytes 5", len(res.Stdout))
		}
		if len(res.Combined) > 5 {
			t.Errorf("combined length %d > MaxOutputBytes 5", len(res.Combined))
		}
	})

	t.Run("Stdin option", func(t *testing.T) {
		input := "hello world stdin"
		opts := safeshell.Options{
			Mode:  safeshell.ModeStandard,
			Stdin: strings.NewReader(input),
		}

		// We can test stdin using go run or a simple command if possible, or verify cmd.Stdin setup
		cmd, err := safeshell.CommandContextWithOptions(ctx, opts, "go", "version")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if cmd.Stdin == nil {
			t.Fatal("expected cmd.Stdin to be set")
		}
	})
}

func TestLookPath(t *testing.T) {
	t.Run("Valid binary lookup", func(t *testing.T) {
		path, err := safeshell.LookPath("go")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if path == "" {
			t.Error("expected non-empty path for 'go'")
		}
	})

	t.Run("Invalid binary name with null byte", func(t *testing.T) {
		_, err := safeshell.LookPath("go\x00")
		if err == nil {
			t.Fatal("expected error for null byte in binary name, got nil")
		}
	})
}

func TestResultMethods(t *testing.T) {
	var nilRes *safeshell.Result
	if nilRes.String() != "" {
		t.Errorf("nil Result.String() = %q, want empty string", nilRes.String())
	}

	resStdoutOnly := &safeshell.Result{
		Stdout: []byte("output from stdout"),
	}
	if resStdoutOnly.String() != "output from stdout" {
		t.Errorf("Result.String() = %q, want %q", resStdoutOnly.String(), "output from stdout")
	}

	resCombined := &safeshell.Result{
		Stdout:   []byte("output from stdout"),
		Combined: []byte("output combined"),
	}
	if resCombined.String() != "output combined" {
		t.Errorf("Result.String() = %q, want %q", resCombined.String(), "output combined")
	}
}
