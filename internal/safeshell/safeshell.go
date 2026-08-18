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

// Package safeshell provides a secure wrapper for subprocess command execution to prevent shell injection.
package safeshell

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// Mode defines the execution security mode.
type Mode string

const (
	// ModeStandard performs character validation and allowlist filtering if configured.
	ModeStandard Mode = "standard"
	// ModeStrict enforces the allowlist and rejects any unlisted binaries.
	ModeStrict Mode = "strict"
	// ModePermissive validates control characters and null bytes only.
	ModePermissive Mode = "permissive"
)

// DefaultAllowedBinaries contains commonly trusted CLI binaries for Speedgrapher.
var DefaultAllowedBinaries = []string{
	"vale",
	"git",
	"hugo",
	"go",
	"echo",
	"cat",
	"sh",
	"bash",
}

// Options configures command execution parameters.
type Options struct {
	Mode            Mode
	Timeout         time.Duration
	AllowedBinaries []string
	MaxOutputBytes  int64
	Dir             string
	Env             []string
	Stdin           io.Reader
}

// Result holds the captured outputs and exit code from command execution.
type Result struct {
	Stdout   []byte
	Stderr   []byte
	Combined []byte
	ExitCode int
}

// String returns the combined output as a string, or stdout if combined is empty.
func (r *Result) String() string {
	if r == nil {
		return ""
	}
	if len(r.Combined) > 0 {
		return string(r.Combined)
	}
	return string(r.Stdout)
}

// ExitError represents a command failure with captured stderr and exit code.
type ExitError struct {
	ExitCode int
	Stderr   string
	Err      error
}

func (e *ExitError) Error() string {
	if e.Stderr != "" {
		return fmt.Sprintf("exit code %d: %s", e.ExitCode, strings.TrimSpace(e.Stderr))
	}
	return fmt.Sprintf("exit code %d", e.ExitCode)
}

func (e *ExitError) Unwrap() error {
	return e.Err
}

type safeBuffer struct {
	mu    sync.Mutex
	buf   bytes.Buffer
	limit int64
}

func (s *safeBuffer) Write(p []byte) (n int, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.limit <= 0 {
		return s.buf.Write(p)
	}
	remaining := s.limit - int64(s.buf.Len())
	if remaining <= 0 {
		return len(p), nil
	}
	if int64(len(p)) > remaining {
		_, _ = s.buf.Write(p[:remaining])
		return len(p), nil
	}
	return s.buf.Write(p)
}

func (s *safeBuffer) Bytes() []byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	b := s.buf.Bytes()
	cp := make([]byte, len(b))
	copy(cp, b)
	return cp
}

// CommandContext creates a validated, secure exec.Cmd wrapper using standard mode.
// It checks the command name for control characters and null bytes, and validates arguments against null bytes.
func CommandContext(ctx context.Context, name string, args ...string) (*exec.Cmd, error) {
	return CommandContextWithOptions(ctx, Options{Mode: ModeStandard}, name, args...)
}

// CommandContextWithOptions creates a validated exec.Cmd configured with execution options.
func CommandContextWithOptions(ctx context.Context, opts Options, name string, args ...string) (*exec.Cmd, error) {
	mode := opts.Mode
	if mode == "" {
		mode = ModeStandard
	}

	if err := ValidateBinary(name, opts.AllowedBinaries, mode); err != nil {
		return nil, err
	}

	if err := ValidateArgs(args...); err != nil {
		return nil, err
	}

	cmdCtx := ctx
	if opts.Timeout > 0 {
		var cancel context.CancelFunc
		cmdCtx, cancel = context.WithTimeout(ctx, opts.Timeout)
		_ = cancel
	}

	cmd := exec.CommandContext(cmdCtx, name, args...)
	if opts.Dir != "" {
		cmd.Dir = opts.Dir
	}
	if len(opts.Env) > 0 {
		cmd.Env = opts.Env
	}
	if opts.Stdin != nil {
		cmd.Stdin = opts.Stdin
	}

	return cmd, nil
}

// Execute executes a command securely using standard mode and returns captured output and exit code.
func Execute(ctx context.Context, name string, args ...string) (*Result, error) {
	return ExecuteWithOptions(ctx, Options{Mode: ModeStandard}, name, args...)
}

// ExecuteWithOptions executes a command securely with full configuration options.
func ExecuteWithOptions(ctx context.Context, opts Options, name string, args ...string) (*Result, error) {
	var cancel context.CancelFunc
	cmdCtx := ctx
	if opts.Timeout > 0 {
		cmdCtx, cancel = context.WithTimeout(ctx, opts.Timeout)
		defer cancel()
	}

	cmd, err := CommandContextWithOptions(cmdCtx, opts, name, args...)
	if err != nil {
		return nil, err
	}

	stdoutBuf := &safeBuffer{limit: opts.MaxOutputBytes}
	stderrBuf := &safeBuffer{limit: opts.MaxOutputBytes}
	combinedBuf := &safeBuffer{limit: opts.MaxOutputBytes}

	cmd.Stdout = io.MultiWriter(stdoutBuf, combinedBuf)
	cmd.Stderr = io.MultiWriter(stderrBuf, combinedBuf)

	runErr := cmd.Run()

	res := &Result{
		Stdout:   stdoutBuf.Bytes(),
		Stderr:   stderrBuf.Bytes(),
		Combined: combinedBuf.Bytes(),
		ExitCode: 0,
	}

	if runErr != nil {
		var exitErr *exec.ExitError
		if errors.As(runErr, &exitErr) {
			res.ExitCode = exitErr.ExitCode()
			return res, &ExitError{
				ExitCode: res.ExitCode,
				Stderr:   string(res.Stderr),
				Err:      runErr,
			}
		}
		res.ExitCode = -1
		return res, runErr
	}

	return res, nil
}

// LookPath searches for an executable named file in the directories named by the PATH environment variable,
// validating the file name against safety rules first.
func LookPath(file string) (string, error) {
	if err := ValidateCommandName(file); err != nil {
		return "", fmt.Errorf("invalid command name: %w", err)
	}
	return exec.LookPath(file)
}

// ValidateBinary checks if a command executable is permitted under the specified security mode and allowlist.
func ValidateBinary(name string, allowed []string, mode Mode) error {
	if err := ValidateCommandName(name); err != nil {
		return fmt.Errorf("invalid command name: %w", err)
	}

	switch mode {
	case ModeStrict:
		allowedList := allowed
		if len(allowedList) == 0 {
			allowedList = DefaultAllowedBinaries
		}
		if !IsAllowedBinary(name, allowedList) {
			return fmt.Errorf("binary %q is not in allowed list", name)
		}
	case ModeStandard:
		if len(allowed) > 0 {
			if !IsAllowedBinary(name, allowed) {
				return fmt.Errorf("binary %q is not in allowed list", name)
			}
		}
	case ModePermissive:
		// Accept any command name that passed ValidateCommandName
	default:
		return fmt.Errorf("unknown mode %q", mode)
	}

	return nil
}

// IsAllowedBinary checks whether binary name matches any entry in the allowlist.
func IsAllowedBinary(name string, allowed []string) bool {
	cleanName := filepath.Base(name)
	if runtime.GOOS == "windows" {
		cleanName = strings.TrimSuffix(cleanName, ".exe")
		cleanName = strings.TrimSuffix(cleanName, ".bat")
		cleanName = strings.TrimSuffix(cleanName, ".cmd")
	}

	for _, a := range allowed {
		if a == "*" {
			return true
		}
		if strings.EqualFold(cleanName, a) || strings.EqualFold(name, a) {
			return true
		}
		cleanA := filepath.Base(a)
		if runtime.GOOS == "windows" {
			cleanA = strings.TrimSuffix(cleanA, ".exe")
			cleanA = strings.TrimSuffix(cleanA, ".bat")
			cleanA = strings.TrimSuffix(cleanA, ".cmd")
		}
		if strings.EqualFold(cleanName, cleanA) {
			return true
		}
	}
	return false
}

// ValidateCommandName checks a command executable name for control characters, newlines, and null bytes.
func ValidateCommandName(name string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("command name cannot be empty")
	}
	if strings.Contains(name, "\x00") {
		return fmt.Errorf("command name contains null byte")
	}
	for _, r := range name {
		if r < 32 || r == 127 {
			return fmt.Errorf("command name contains control character %q", r)
		}
	}
	return nil
}

// Validate checks a string argument for safety indicators (e.g. null bytes).
// Note: In direct execve subprocess execution, operators like |, &, ;, <, >, `, $
// and newlines are safe in arguments as they are passed directly without shell interpretation.
func Validate(val string) error {
	if strings.Contains(val, "\x00") {
		return fmt.Errorf("value contains null byte")
	}
	return nil
}

// ValidateArgs checks a list of string arguments for safety indicators.
func ValidateArgs(args ...string) error {
	for _, arg := range args {
		if err := Validate(arg); err != nil {
			return fmt.Errorf("invalid argument %q: %w", arg, err)
		}
	}
	return nil
}
