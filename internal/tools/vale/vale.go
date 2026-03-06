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

// setupValeConfig ensures that a Vale configuration exists for Speedgrapher.
// It prioritizes a local .vale.ini in the current working directory.
// If none exists, it falls back to the bundled configuration.
func setupValeConfig(valePath string) (string, error) {
	// First check current working directory
	cwd, err := os.Getwd()
	if err == nil {
		localIni := filepath.Join(cwd, ".vale.ini")
		if _, err := os.Stat(localIni); err == nil {
			// Found local config, ensure packages are synced
			cmd := exec.Command(valePath, "sync", "--config", localIni)
			if out, syncErr := cmd.CombinedOutput(); syncErr != nil {
				return "", fmt.Errorf("failed to run 'vale sync' for local config: %s (error: %w)", string(out), syncErr)
			}
			return localIni, nil
		}
	}

	// Fallback to bundled config
	exePath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("could not get executable path: %w", err)
	}
	exeDir := filepath.Dir(exePath)

	iniPath := filepath.Join(exeDir, ".vale.ini")
	stylesPath := filepath.Join(exeDir, "styles")

	// Verify the ini file exists
	if _, err := os.Stat(iniPath); os.IsNotExist(err) {
		return "", fmt.Errorf(".vale.ini is missing, it must be bundled with the extension")
	}

	// If the styles dir doesn't exist, run vale sync
	if _, err := os.Stat(stylesPath); os.IsNotExist(err) {
		cmd := exec.Command(valePath, "sync", "--config", iniPath)
		if out, err := cmd.CombinedOutput(); err != nil {
			return "", fmt.Errorf("failed to run 'vale sync': %s (error: %w)", string(out), err)
		}
	}

	return iniPath, nil
}

// Register registers the vale tool with the server.
func Register(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "vale",
		Description: "Executes Vale static analysis for style and grammar. Prioritizes project-specific .vale.ini if present in the workspace.",
	}, valeHandler)
}

// ValeParams defines the input parameters for the vale tool.
type ValeParams struct {
	Text string `json:"text" jsonschema:"The text to analyze."`
}

// ValeResult defines the structured output for the vale tool.
type ValeResult struct {
	Output string `json:"output"`
}

func valeHandler(_ context.Context, _ *mcp.CallToolRequest, input ValeParams) (*mcp.CallToolResult, *ValeResult, error) {
	text := input.Text
	if text == "" {
		return nil, nil, fmt.Errorf("text cannot be empty")
	}

	valePath, err := bootstrapVale()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to bootstrap vale: %w", err)
	}

	iniPath, err := setupValeConfig(valePath)
	if err != nil {
		return nil, nil, fmt.Errorf("vale config error: %w", err)
	}

	// Run vale via stdin so we don't need temporary files, ensuring it uses our managed config
	cmd := exec.Command(valePath, "--config", iniPath, "--ext", ".md", "--output=JSON")
	cmd.Stdin = strings.NewReader(text)

	// Vale returns non-zero for alerts, so we ignore the error and just capture the output
	output, err := cmd.CombinedOutput()
	if err != nil && len(output) == 0 {
		return nil, nil, fmt.Errorf("failed to execute vale: %w", err)
	}

	return nil, &ValeResult{Output: string(output)}, nil
}
