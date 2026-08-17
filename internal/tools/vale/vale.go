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

package vale

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Config holds configuration options for the Vale tool.
type Config struct {
	WorkspaceDir string
	ValeBinPath  string // Optional custom path to vale binary
}

const defaultValeIni = `StylesPath = styles
MinAlertLevel = suggestion

Packages = Google, proselint, write-good

[*.md]
BasedOnStyles = Vale, Google, proselint, write-good
`

// setupValeConfig ensures that a Vale configuration exists for Speedgrapher.
// It prioritizes a local .vale.ini in Config.WorkspaceDir if provided.
// If none exists, it checks the current working directory.
// If still none exists, it falls back to the bundled or user configuration directory.
func setupValeConfig(valePath string, workspaceDir string) (string, error) {
	absValePath, err := filepath.Abs(valePath)
	if err != nil {
		return "", fmt.Errorf("failed to resolve absolute vale path: %w", err)
	}
	valePath = absValePath

	var iniPath string

	// 1. Check Config.WorkspaceDir if provided
	if workspaceDir != "" {
		absWorkspace, err := filepath.Abs(workspaceDir)
		if err == nil {
			candidate := filepath.Join(absWorkspace, ".vale.ini")
			if _, err := os.Stat(candidate); err == nil {
				iniPath = candidate
			}
		}
	}

	// 2. If not found in WorkspaceDir, check current working directory
	if iniPath == "" {
		if cwd, err := os.Getwd(); err == nil {
			if absCwd, err := filepath.Abs(cwd); err == nil {
				candidate := filepath.Join(absCwd, ".vale.ini")
				if _, err := os.Stat(candidate); err == nil {
					iniPath = candidate
				}
			}
		}
	}

	// 3. Fallback to bundled config walking up from executable directory
	if iniPath == "" {
		if exePath, err := os.Executable(); err == nil {
			if absExePath, err := filepath.Abs(exePath); err == nil {
				exeDir := filepath.Dir(absExePath)
				if bundledIni, err := findBundledValeConfig(exeDir); err == nil {
					iniPath = bundledIni
				}
			}
		}
	}

	// 4. Fallback to user config directory (~/.speedgrapher)
	if iniPath == "" {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("could not determine user home directory: %w", err)
		}
		userValeDir := filepath.Join(homeDir, ".speedgrapher")
		if err := os.MkdirAll(userValeDir, 0755); err != nil {
			return "", fmt.Errorf("could not create user speedgrapher directory %s: %w", userValeDir, err)
		}
		userIni := filepath.Join(userValeDir, ".vale.ini")
		if _, err := os.Stat(userIni); os.IsNotExist(err) {
			if err := os.WriteFile(userIni, []byte(defaultValeIni), 0644); err != nil {
				return "", fmt.Errorf("could not write default .vale.ini to %s: %w", userIni, err)
			}
		}
		iniPath = userIni
	}

	absIniPath, err := filepath.Abs(iniPath)
	if err != nil {
		return "", fmt.Errorf("could not resolve absolute path for .vale.ini: %w", err)
	}
	iniPath = absIniPath

	stylesPath := filepath.Join(filepath.Dir(iniPath), "styles")
	absStylesPath, err := filepath.Abs(stylesPath)
	if err != nil {
		return "", fmt.Errorf("could not resolve absolute styles path: %w", err)
	}
	stylesPath = absStylesPath

	// If the styles dir doesn't exist, run vale sync
	if _, err := os.Stat(stylesPath); os.IsNotExist(err) {
		cmd := exec.Command(valePath, "sync", "--config", iniPath)
		if out, err := cmd.CombinedOutput(); err != nil {
			return "", fmt.Errorf("failed to run 'vale sync': %s (error: %w)", string(out), err)
		}
	}

	return iniPath, nil
}

// findBundledValeConfig searches for .vale.ini starting from exeDir and walking up parent directories.
func findBundledValeConfig(exeDir string) (string, error) {
	absDir, err := filepath.Abs(exeDir)
	if err != nil {
		return "", fmt.Errorf("could not resolve absolute path for %q: %w", exeDir, err)
	}
	currDir := absDir
	for {
		candidate := filepath.Join(currDir, ".vale.ini")
		if _, err := os.Stat(candidate); err == nil {
			return filepath.Abs(candidate)
		}
		parent := filepath.Dir(currDir)
		if parent == currDir {
			break
		}
		currDir = parent
	}
	return "", fmt.Errorf(".vale.ini is missing")
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
		return valeHandler(ctx, req, input, c)
	})
}

// ValeParams defines the input parameters for the vale tool.
type ValeParams struct {
	Text string `json:"text,omitempty" jsonschema:"The text to analyze."`
	Path string `json:"path,omitempty" jsonschema:"Optional absolute path to a file to analyze. If provided and text is empty, the file content will be read."`
}

// ValeResult defines the structured output for the vale tool.
type ValeResult struct {
	Output string `json:"output"`
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
	if text == "" {
		if input.Path == "" {
			return nil, nil, fmt.Errorf("either text or path must be provided")
		}
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

		data, err := os.ReadFile(filePath)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to read file %q: %w", filePath, err)
		}
		text = string(data)
	}

	valePath, err := bootstrapVale(cfg.ValeBinPath)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to bootstrap vale: %w", err)
	}

	iniPath, err := setupValeConfig(valePath, cfg.WorkspaceDir)
	if err != nil {
		return nil, nil, fmt.Errorf("vale config error: %w", err)
	}

	// Run vale via stdin so we don't need temporary files, ensuring it uses our managed config
	cmd := exec.CommandContext(ctx, valePath, "--config", iniPath, "--ext", ".md", "--output=JSON")
	cmd.Stdin = strings.NewReader(text)

	// Vale returns non-zero for alerts, so we ignore the error and capture the output
	output, err := cmd.CombinedOutput()
	if err != nil && len(output) == 0 {
		return nil, nil, fmt.Errorf("failed to execute vale: %w", err)
	}

	return nil, &ValeResult{Output: string(output)}, nil
}
