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
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Register registers the vale tool with the server.
func Register(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "vale",
		Description: "Runs the Vale grammar checker on the provided text.",
	}, valeHandler)
}

// ValeParams defines the input parameters for the vale tool.
type ValeParams struct {
	Text string `json:"text" jsonschema:"The text to analyze for grammar and style issues."`
}

// ValeAlert represents a single alert from Vale.
type ValeAlert struct {
	Action      interface{} `json:"Action"`
	Span        []int       `json:"Span"`
	Check       string      `json:"Check"`
	Description string      `json:"Description"`
	Link        string      `json:"Link"`
	Message     string      `json:"Message"`
	Severity    string      `json:"Severity"`
	Match       string      `json:"Match"`
	Line        int         `json:"Line"`
}

// ValeResult defines the structured output for the vale tool.
type ValeResult struct {
	Alerts []ValeAlert `json:"alerts"`
}

func valeHandler(_ context.Context, _ *mcp.CallToolRequest, input ValeParams) (*mcp.CallToolResult, *ValeResult, error) {
	if input.Text == "" {
		return nil, nil, fmt.Errorf("text cannot be empty")
	}

	// Check if vale is in the current directory or in the PATH
	valePath := "./vale"
	if _, err := exec.LookPath(valePath); err != nil {
		valePath = "vale"
	}

	cmd := exec.Command(valePath, "--ext=.md", "--output=JSON")
	cmd.Stdin = strings.NewReader(input.Text)

	output, err := cmd.CombinedOutput()
	if err != nil {
		// Vale returns exit code 1 if it finds issues, which is fine.
		// We should only return an error if it's a real execution problem.
		if _, ok := err.(*exec.ExitError); !ok {
			return nil, nil, fmt.Errorf("failed to run vale: %w, output: %s", err, string(output))
		}
	}

	var rawResult map[string][]ValeAlert
	if err := json.Unmarshal(output, &rawResult); err != nil {
		// Check if it's a Vale runtime error in JSON format
		var valeErr struct {
			Text string `json:"Text"`
			Code string `json:"Code"`
		}
		if json.Unmarshal(output, &valeErr) == nil && valeErr.Code != "" {
			return nil, nil, fmt.Errorf("vale error: %s", valeErr.Text)
		}
		return nil, nil, fmt.Errorf("failed to parse vale output: %w, output: %s", err, string(output))
	}

	alerts := []ValeAlert{}
	for _, fileAlerts := range rawResult {
		alerts = append(alerts, fileAlerts...)
	}

	return nil, &ValeResult{Alerts: alerts}, nil
}
