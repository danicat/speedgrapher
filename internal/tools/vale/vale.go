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

package vale

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

var (
	hugoLinkDestRe  = regexp.MustCompile(`(?s)\]\(\s*\{\{.*?\}\}\s*\)`)
	hugoShortcodeRe = regexp.MustCompile(`(?s)\{\{.*?\}\}`)
)

// maskHugoShortcodesForVale masks Hugo shortcodes in Markdown link destinations and standalone
// shortcodes while preserving exact byte lengths, line numbers, and column offsets so Vale's
// Goldmark parser treats `[label]({{< ref "..." >}})` as a standard Markdown link and ignores
// standalone `{{ ... }}` shortcodes.
func maskHugoShortcodesForVale(text string) string {
	masked := hugoLinkDestRe.ReplaceAllStringFunc(text, func(m string) string {
		if len(m) <= 3 {
			return m
		}
		var b strings.Builder
		b.Grow(len(m))
		b.WriteString("](")
		for i := 2; i < len(m)-1; i++ {
			if m[i] == '\n' {
				b.WriteByte('\n')
			} else {
				b.WriteByte('a')
			}
		}
		b.WriteByte(')')
		return b.String()
	})
	masked = hugoShortcodeRe.ReplaceAllStringFunc(masked, func(m string) string {
		var b strings.Builder
		b.Grow(len(m))
		for i := 0; i < len(m); i++ {
			if m[i] == '\n' {
				b.WriteByte('\n')
			} else {
				b.WriteByte(' ')
			}
		}
		return b.String()
	})
	return masked
}

// Config holds configuration options for the Vale tool.
type Config struct {
	WorkspaceDir string
	ValeBinPath  string // Optional custom path to vale binary
}

var (
	executablePathFunc = os.Executable
	lookPathFunc       = findAccessibleInPath
	userHomeDirFunc    = os.UserHomeDir
)

func isExecutableBinary(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("vale binary not found at %q: %w", path, err)
	}
	if info.IsDir() {
		return fmt.Errorf("vale binary path is a directory: %q", path)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0111 == 0 {
		return fmt.Errorf("vale binary at %q is not executable", path)
	}
	return nil
}

func findAccessibleInPath(binName string) (string, error) {
	if p, err := exec.LookPath(binName); err == nil {
		if f, openErr := os.Open(p); openErr == nil {
			_ = f.Close()
			return p, nil
		}
	}
	for _, dir := range filepath.SplitList(os.Getenv("PATH")) {
		if dir == "" {
			continue
		}
		candidate, err := exec.LookPath(filepath.Join(dir, binName))
		if err != nil {
			continue
		}
		if f, openErr := os.Open(candidate); openErr == nil {
			_ = f.Close()
			return candidate, nil
		}
	}

	exeName := binName
	if runtime.GOOS == "windows" && !strings.HasSuffix(strings.ToLower(exeName), ".exe") {
		exeName += ".exe"
	}
	fallbackDirs := []string{"/opt/homebrew/bin", "/usr/local/bin"}
	if homeDir, err := userHomeDirFunc(); err == nil && homeDir != "" {
		fallbackDirs = append(fallbackDirs, filepath.Join(homeDir, "go", "bin"))
	}
	for _, dir := range fallbackDirs {
		candidate := filepath.Join(dir, exeName)
		if isExecutableBinary(candidate) == nil {
			if f, openErr := os.Open(candidate); openErr == nil {
				_ = f.Close()
				return candidate, nil
			}
		}
	}

	return "", fmt.Errorf("executable %q not found in PATH", binName)
}

// resolveValeBinary locates the vale executable deterministically.
// If customBinPath is provided, it verifies the binary exists and is executable.
// Otherwise, it resolves "vale" from the system PATH (or standard install locations) and fails fast if not installed.
func resolveValeBinary(customBinPath string) (string, error) {
	if customBinPath != "" {
		absPath, err := filepath.Abs(customBinPath)
		if err != nil {
			return "", fmt.Errorf("failed to resolve custom vale binary path %q: %w", customBinPath, err)
		}
		if err := isExecutableBinary(absPath); err != nil {
			return "", err
		}
		return absPath, nil
	}

	valePath, err := lookPathFunc("vale")
	if err != nil {
		return "", fmt.Errorf("vale binary not found in PATH (%w); install Vale via 'brew install vale' or 'go install github.com/errata-ai/vale/v3/cmd/vale@latest'", err)
	}
	absPath, err := filepath.Abs(valePath)
	if err != nil {
		return "", fmt.Errorf("failed to resolve absolute path for vale binary %q: %w", valePath, err)
	}
	return absPath, nil
}

func checkValeDir(dir string) (string, string, bool) {
	absDir, err := filepath.Abs(dir)
	if err != nil {
		return "", "", false
	}
	iniCandidate := filepath.Join(absDir, ".vale.ini")
	if info, err := os.Stat(iniCandidate); err == nil && !info.IsDir() {
		stylesDir := filepath.Join(absDir, "styles")
		if sInfo, sErr := os.Stat(stylesDir); sErr == nil && sInfo.IsDir() {
			return iniCandidate, iniCandidate, true
		}
		return "", fmt.Sprintf("%s (missing styles/ directory)", iniCandidate), false
	}
	return "", iniCandidate, false
}

// setupValeConfig resolves a valid .vale.ini (with an adjacent styles/ directory) deterministically.
// It checks searchDirs in order (walking up parent directories), then the current working directory,
// then the plugin's bundled .vale.ini relative to the executable, and finally the standard installed
// Antigravity plugin directory (~/.gemini/config/plugins/speedgrapher).
// If no valid .vale.ini is found, it fails fast listing all checked locations.
func setupValeConfig(searchDirs ...string) (string, error) {
	var checked []string
	seen := make(map[string]bool)

	recordChecked := func(entry string) {
		if entry != "" && !seen[entry] {
			seen[entry] = true
			checked = append(checked, entry)
		}
	}

	checkCandidateDir := func(dir string) (string, bool) {
		found, entry, ok := checkValeDir(dir)
		if ok {
			return found, true
		}
		recordChecked(entry)
		return "", false
	}

	for _, dir := range searchDirs {
		if dir == "" {
			continue
		}
		if found, err := findValeConfigUp(dir); err == nil {
			return found, nil
		}
		if absDir, err := filepath.Abs(dir); err == nil {
			_, entry, _ := checkValeDir(absDir)
			recordChecked(entry)
		}
	}

	if cwd, err := os.Getwd(); err == nil {
		if found, err := findValeConfigUp(cwd); err == nil {
			return found, nil
		}
		if absCwd, err := filepath.Abs(cwd); err == nil {
			_, entry, _ := checkValeDir(absCwd)
			recordChecked(entry)
		}
	}

	if exePath, err := executablePathFunc(); err == nil && exePath != "" {
		if absExePath, err := filepath.Abs(exePath); err == nil {
			exeDir := filepath.Dir(absExePath)
			if found, ok := checkCandidateDir(exeDir); ok {
				return found, nil
			}
			parentDir := filepath.Dir(exeDir)
			if parentDir != exeDir {
				if found, ok := checkCandidateDir(parentDir); ok {
					return found, nil
				}
			}
		}
	}

	if homeDir, err := userHomeDirFunc(); err == nil && homeDir != "" {
		pluginDir := filepath.Join(homeDir, ".gemini", "config", "plugins", "speedgrapher")
		if found, ok := checkCandidateDir(pluginDir); ok {
			return found, nil
		}
	}

	return "", fmt.Errorf("no valid .vale.ini with styles/ directory found (checked: %s)", strings.Join(checked, ", "))
}

// findValeConfigUp searches for a valid .vale.ini (with adjacent styles/ directory)
// starting from startDir and walking up parent directories.
func findValeConfigUp(startDir string) (string, error) {
	absDir, err := filepath.Abs(startDir)
	if err != nil {
		return "", fmt.Errorf("could not resolve absolute path for %q: %w", startDir, err)
	}
	var checked []string
	currDir := absDir
	for {
		if found, entry, ok := checkValeDir(currDir); ok {
			return found, nil
		} else if entry != "" {
			checked = append(checked, entry)
		}
		parent := filepath.Dir(currDir)
		if parent == currDir {
			break
		}
		currDir = parent
	}
	return "", fmt.Errorf(".vale.ini with styles/ directory not found (checked: %s)", strings.Join(checked, ", "))
}

// Register registers the vale tool with the server.
func Register(server *mcp.Server, cfg ...Config) {
	var c Config
	if len(cfg) > 0 {
		c = cfg[0]
	}
	mcp.AddTool(server, &mcp.Tool{
		Name:        "vale",
		Description: "Executes Vale static analysis for style and grammar. Prioritizes project-specific .vale.ini if present in the workspace.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, input ValeParams) (*mcp.CallToolResult, *ValeResult, error) {
		return Handler(ctx, req, input, c)
	})
}

// ValeParams defines the input parameters for the vale tool.
type ValeParams struct {
	Text string `json:"text,omitempty" jsonschema:"The text to analyze."`
	Path string `json:"path,omitempty" jsonschema:"Optional absolute path to a file to analyze. If provided and text is empty, the file content will be read."`
}

// ValeResult defines the structured output for the vale tool.
type ValeResult struct {
	Output     string `json:"output"`
	ConfigPath string `json:"config_path,omitempty"`
}

// Analyze runs the Vale linter directly.
func Analyze(ctx context.Context, input ValeParams, cfg ...Config) (*ValeResult, error) {
	var c Config
	if len(cfg) > 0 {
		c = cfg[0]
	}
	_, res, err := valeHandler(ctx, nil, input, c)
	return res, err
}

// Handler executes the vale tool logic.
func Handler(ctx context.Context, req *mcp.CallToolRequest, input ValeParams, cfg ...Config) (*mcp.CallToolResult, *ValeResult, error) {
	var c Config
	if len(cfg) > 0 {
		c = cfg[0]
	}
	return valeHandler(ctx, req, input, c)
}

func valeHandler(ctx context.Context, _ *mcp.CallToolRequest, input ValeParams, cfg Config) (*mcp.CallToolResult, *ValeResult, error) {
	text := input.Text
	var targetFileDir string

	if input.Path != "" {
		filePath := input.Path
		if !filepath.IsAbs(filePath) {
			if cfg.WorkspaceDir != "" {
				absWorkspace, err := filepath.Abs(cfg.WorkspaceDir)
				if err != nil {
					return nil, nil, fmt.Errorf("failed to resolve workspace directory: %w", err)
				}
				filePath = filepath.Join(absWorkspace, filePath)
			} else {
				absPath, err := filepath.Abs(filePath)
				if err != nil {
					return nil, nil, fmt.Errorf("failed to resolve file path: %w", err)
				}
				filePath = absPath
			}
		}
		filePath = filepath.Clean(filePath)
		absFilePath, err := filepath.Abs(filePath)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to get absolute file path: %w", err)
		}
		filePath = absFilePath
		targetFileDir = filepath.Dir(filePath)

		if text == "" {
			data, err := os.ReadFile(filePath)
			if err != nil {
				return nil, nil, fmt.Errorf("failed to read file %q: %w", filePath, err)
			}
			text = string(data)
		}
	} else if text == "" {
		return nil, nil, fmt.Errorf("either text or path must be provided")
	}

	valePath, err := resolveValeBinary(cfg.ValeBinPath)
	if err != nil {
		return nil, nil, err
	}

	iniPath, err := setupValeConfig(targetFileDir, cfg.WorkspaceDir)
	if err != nil {
		return nil, nil, fmt.Errorf("vale config error: %w", err)
	}

	var stdout, stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, valePath, "--no-exit", "--config", iniPath, "--ext", ".md", "--output=JSON")
	cmd.Stdin = strings.NewReader(maskHugoShortcodesForVale(text))
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, nil, fmt.Errorf("vale execution failed: %w (stderr: %s)", err, strings.TrimSpace(stderr.String()))
	}

	return nil, &ValeResult{Output: stdout.String(), ConfigPath: iniPath}, nil
}
