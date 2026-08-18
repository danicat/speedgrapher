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
	"path/filepath"
	"strings"

	"github.com/danicat/speedgrapher/internal/safeshell"
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

	// 1. Check Config.WorkspaceDir (and its parent directories) if provided
	if workspaceDir != "" {
		if found, err := findValeConfigUp(workspaceDir); err == nil {
			iniPath = found
		}
	}

	// 2. Check current working directory (and its parent directories)
	if iniPath == "" {
		if cwd, err := os.Getwd(); err == nil {
			if found, err := findValeConfigUp(cwd); err == nil {
				iniPath = found
			}
		}
	}

	// 3. Fallback to bundled config walking up from executable directory
	if iniPath == "" {
		if exePath, err := os.Executable(); err == nil {
			if absExePath, err := filepath.Abs(exePath); err == nil {
				exeDir := filepath.Dir(absExePath)
				if bundledIni, err := findValeConfigUp(exeDir); err == nil {
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
		res, err := safeshell.Execute(context.Background(), valePath, "sync", "--config", iniPath)
		if err != nil {
			outputStr := ""
			if res != nil {
				outputStr = string(res.Combined)
			}
			return "", fmt.Errorf("failed to run 'vale sync': %s (error: %w)", outputStr, err)
		}
	}

	return iniPath, nil
}

// findValeConfigUp searches for .vale.ini starting from startDir and walking up parent directories.
func findValeConfigUp(startDir string) (string, error) {
	absDir, err := filepath.Abs(startDir)
	if err != nil {
		return "", fmt.Errorf("could not resolve absolute path for %q: %w", startDir, err)
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

// findBundledValeConfig is an alias to findValeConfigUp for backward compatibility.
func findBundledValeConfig(startDir string) (string, error) {
	return findValeConfigUp(startDir)
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
	Output     string `json:"output"`
	ConfigPath string `json:"config_path,omitempty"`
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
	res, err := safeshell.ExecuteWithOptions(ctx, safeshell.Options{
		Stdin: strings.NewReader(text),
	}, valePath, "--config", iniPath, "--ext", ".md", "--output=JSON")

	// Vale returns non-zero for alerts, so we ignore non-zero exit errors when output is produced
	if err != nil && (res == nil || len(res.Combined) == 0) {
		return nil, nil, fmt.Errorf("failed to execute vale: %w", err)
	}

	output := ""
	if res != nil {
		output = string(res.Combined)
	}

	return nil, &ValeResult{Output: output, ConfigPath: iniPath}, nil
}
