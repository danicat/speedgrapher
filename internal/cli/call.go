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
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/danicat/speedgrapher/internal/tools/fog"
	"github.com/danicat/speedgrapher/internal/tools/seo"
	"github.com/danicat/speedgrapher/internal/tools/slop"
	"github.com/danicat/speedgrapher/internal/tools/vale"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/spf13/cobra"
)

func newCallCmd(stdin io.Reader, stdout, stderr io.Writer) *cobra.Command {
	return &cobra.Command{
		Use:   "call <tool-name> [json-arguments]",
		Short: "Invoke a tool directly from the CLI",
		Args:  cobra.ArbitraryArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 0 {
				return errors.New("missing tool name\nUsage: speedgrapher call <tool-name> '<json-arguments>'")
			}

			toolName := args[0]
			tool := FindTool(toolName)
			if tool == nil {
				return fmt.Errorf("unknown tool: %q\nRun 'speedgrapher list' to see available tools", toolName)
			}

			res, err := tool.Invoke(cmd.Context(), args[1:], stdin)
			if err != nil {
				return err
			}

			if res == nil {
				return nil
			}

			for _, content := range res.Content {
				if tc, ok := content.(*mcp.TextContent); ok {
					if res.IsError {
						_, _ = fmt.Fprintln(stderr, tc.Text)
					} else {
						_, _ = fmt.Fprintln(stdout, tc.Text)
					}
				}
			}

			if res.IsError {
				return errors.New("tool execution returned an error")
			}

			return nil
		},
	}
}

// parseArgs parses arguments into a struct, supporting JSON string argument or stdin JSON.
func parseArgs(rawArgs []string, stdin io.Reader, target any) error {
	// 1. If single argument looks like JSON:
	if len(rawArgs) == 1 {
		trimmed := strings.TrimSpace(rawArgs[0])
		if strings.HasPrefix(trimmed, "{") {
			return json.Unmarshal([]byte(trimmed), target)
		}
	}

	// 2. If rawArgs joined is JSON (e.g. unquoted JSON or shell split):
	if len(rawArgs) > 0 {
		joined := strings.TrimSpace(strings.Join(rawArgs, " "))
		if strings.HasPrefix(joined, "{") && strings.HasSuffix(joined, "}") {
			return json.Unmarshal([]byte(joined), target)
		}
	}

	// 3. If no args provided, try reading from stdin
	if len(rawArgs) == 0 && stdin != nil {
		data, err := io.ReadAll(stdin)
		if err == nil && len(strings.TrimSpace(string(data))) > 0 {
			trimmed := strings.TrimSpace(string(data))
			if strings.HasPrefix(trimmed, "{") {
				return json.Unmarshal([]byte(trimmed), target)
			}
		}
	}

	if len(rawArgs) == 0 {
		return errors.New("missing arguments (expected JSON string, e.g. '{\"key\": \"value\"}')")
	}

	return fmt.Errorf("invalid arguments: %v (expected JSON string, e.g. '{\"key\": \"value\"}')", rawArgs)
}

func invokeFog(ctx context.Context, rawArgs []string, stdin io.Reader) (*mcp.CallToolResult, error) {
	var params fog.FogParams
	if err := parseArgs(rawArgs, stdin, &params); err != nil {
		return nil, fmt.Errorf("invalid arguments for fog: %w", err)
	}
	res, typedRes, err := fog.Handler(ctx, nil, params)
	if err != nil {
		return nil, err
	}
	if res != nil {
		return res, nil
	}
	return marshalResult(typedRes)
}

func invokeSlop(ctx context.Context, rawArgs []string, stdin io.Reader) (*mcp.CallToolResult, error) {
	var params slop.SlopParams
	if err := parseArgs(rawArgs, stdin, &params); err != nil {
		return nil, fmt.Errorf("invalid arguments for slop: %w", err)
	}
	res, typedRes, err := slop.Handler(ctx, nil, params)
	if err != nil {
		return nil, err
	}
	if res != nil {
		return res, nil
	}
	return marshalResult(typedRes)
}

func invokeSEO(ctx context.Context, rawArgs []string, stdin io.Reader) (*mcp.CallToolResult, error) {
	var params seo.SEOParams
	if err := parseArgs(rawArgs, stdin, &params); err != nil {
		return nil, fmt.Errorf("invalid arguments for seo: %w", err)
	}
	res, typedRes, err := seo.Handler(ctx, nil, params)
	if err != nil {
		return nil, err
	}
	if res != nil {
		return res, nil
	}
	return marshalResult(typedRes)
}

func invokeVale(ctx context.Context, rawArgs []string, stdin io.Reader) (*mcp.CallToolResult, error) {
	var params vale.ValeParams
	if err := parseArgs(rawArgs, stdin, &params); err != nil {
		return nil, fmt.Errorf("invalid arguments for vale: %w", err)
	}
	res, typedRes, err := vale.Handler(ctx, nil, params)
	if err != nil {
		return nil, err
	}
	if res != nil {
		return res, nil
	}
	return marshalResult(typedRes)
}
