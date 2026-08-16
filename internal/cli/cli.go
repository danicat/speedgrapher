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

// Package cli implements the command-line interface for speedgrapher.
package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/danicat/speedgrapher/internal/server"
	"github.com/danicat/speedgrapher/internal/tools/fog"
	"github.com/danicat/speedgrapher/internal/tools/seo"
	"github.com/danicat/speedgrapher/internal/tools/slop"
	"github.com/danicat/speedgrapher/internal/tools/vale"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// ToolDef represents metadata and invoker for a tool.
type ToolDef struct {
	Name        string
	Aliases     []string
	Description string
	Usage       string
	Invoke      func(ctx context.Context, rawArgs []string, stdin io.Reader) (*mcp.CallToolResult, error)
}

// GetTools returns the list of all registered tools.
func GetTools() []ToolDef {
	return []ToolDef{
		{
			Name:        "fog",
			Aliases:     []string{"gunning_fog"},
			Description: "Calculates the Gunning Fog Index to estimate the readability of an English text. Lower scores indicate easier reading.",
			Usage:       `speedgrapher call fog '{"text": "The quick brown fox jumps over the lazy dog."}'`,
			Invoke:      invokeFog,
		},
		{
			Name:        "slop",
			Aliases:     []string{"slop_score", "tropes"},
			Description: "Calculates an AI 'slop score' (0-100) using 5 weighted metrics. Calibrated for tech writing.",
			Usage:       `speedgrapher call slop '{"text": "In today\'s fast-paced world, delve into the tapestry of AI."}'`,
			Invoke:      invokeSlop,
		},
		{
			Name:        "seo",
			Aliases:     []string{"analyze_seo", "seo_audit"},
			Description: "Performs technical SEO audits on URLs or Hugo Markdown content.",
			Usage:       `speedgrapher call seo '{"html": "<html><head><title>My Article Title Here</title>...", "keyword": "golang"}'`,
			Invoke:      invokeSEO,
		},
		{
			Name:        "vale",
			Aliases:     []string{"lint", "style"},
			Description: "Executes Vale static analysis for style and grammar.",
			Usage:       `speedgrapher call vale '{"text": "This is very unique."}'`,
			Invoke:      invokeVale,
		},
	}
}

// FindTool looks up a tool by name or alias.
func FindTool(name string) *ToolDef {
	name = strings.ToLower(strings.TrimSpace(name))
	for _, tool := range GetTools() {
		if strings.ToLower(tool.Name) == name {
			t := tool
			return &t
		}
		for _, alias := range tool.Aliases {
			if strings.ToLower(alias) == name {
				t := tool
				return &t
			}
		}
	}
	return nil
}

// Run executes the CLI with the given arguments.
func Run(ctx context.Context, version string, args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		PrintHelp(stdout, version)
		return nil
	}

	cmd := args[0]
	cmdArgs := args[1:]

	switch cmd {
	case "help", "-h", "--help", "-help":
		PrintHelp(stdout, version)
		return nil

	case "version", "-v", "--version", "-version":
		fmt.Fprintln(stdout, version)
		return nil

	case "list":
		return runList(stdout)

	case "call":
		return runCall(ctx, cmdArgs, stdin, stdout, stderr)

	case "init":
		return runInit(ctx, cmdArgs, stdout, stderr)

	case "install":
		return runInstall(ctx, cmdArgs, stdout, stderr)

	case "uninstall":
		return runUninstall(ctx, cmdArgs, stdout, stderr)

	case "mcp":
		return runMCP(ctx, version, cmdArgs)

	default:
		if strings.HasPrefix(cmd, "-") {
			return fmt.Errorf("unknown flag: %s\nRun 'speedgrapher help' for usage", cmd)
		}
		return fmt.Errorf("unknown command: %s\nRun 'speedgrapher help' for usage", cmd)
	}
}

// PrintHelp writes the main help text to w.
func PrintHelp(w io.Writer, version string) {
	fmt.Fprintf(w, `speedgrapher %s - High-Performance Editorial MCP Server & Intelligence Tools

Usage:
  speedgrapher [command]

Available Commands:
  install        Configure MCP server registration and unpack agent skills
  uninstall      Remove MCP server registration and agent skills
  init           Initialize workspace speedgrapher configuration and skills
  mcp            Run in Model Context Protocol (MCP) server mode
  list           List all available editorial intelligence tools
  call           Invoke a tool directly from the CLI
  version        Print the speedgrapher version
  help           Print this help message

Surface Management:
  speedgrapher install              Configure MCP server and install skills (Global)
  speedgrapher install -w           Configure MCP server and install skills (Workspace)
  speedgrapher install --mcp        Configure MCP server only
  speedgrapher install --skills     Install skills only
  speedgrapher uninstall            Remove MCP server and skills (Global)
  speedgrapher uninstall -w         Remove MCP server and skills (Workspace)
  speedgrapher init                 Initialize workspace configuration (.agents/)

MCP Server Mode:
  speedgrapher mcp                  Run MCP server using standard I/O (default for MCP clients)
  speedgrapher mcp --listen=:8080   Run MCP server as Streamable HTTP service on specified address
  speedgrapher mcp --http=:8080     Alias for --listen

Tool Invocation:
  speedgrapher call <tool-name> '<json-arguments>'

Tools:
  fog, slop, seo, vale

Examples:
  speedgrapher init
  speedgrapher list
  speedgrapher call fog '{"text": "This is a simple sentence."}'
  speedgrapher call slop '{"text": "Delve into the intricate tapestry."}'
  speedgrapher call seo '{"html": "<html><head><title>Test Title</title></head><body>...</body></html>"}'
  speedgrapher call vale '{"text": "This is very unique."}'
`, version)
}

func runList(w io.Writer) error {
	fmt.Fprintln(w, "Available speedgrapher tools:")
	fmt.Fprintln(w)
	for _, tool := range GetTools() {
		aliasStr := ""
		if len(tool.Aliases) > 0 {
			aliasStr = fmt.Sprintf(" (aliases: %s)", strings.Join(tool.Aliases, ", "))
		}
		fmt.Fprintf(w, "• %s%s\n", tool.Name, aliasStr)
		fmt.Fprintf(w, "  %s\n", tool.Description)
		fmt.Fprintf(w, "  Usage: %s\n\n", tool.Usage)
	}
	return nil
}

func runCall(ctx context.Context, args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		return errors.New("missing tool name\nUsage: speedgrapher call <tool-name> '<json-arguments>'")
	}

	toolName := args[0]
	tool := FindTool(toolName)
	if tool == nil {
		return fmt.Errorf("unknown tool: %q\nRun 'speedgrapher list' to see available tools", toolName)
	}

	res, err := tool.Invoke(ctx, args[1:], stdin)
	if err != nil {
		return err
	}

	if res == nil {
		return nil
	}

	for _, content := range res.Content {
		if tc, ok := content.(*mcp.TextContent); ok {
			if res.IsError {
				fmt.Fprintln(stderr, tc.Text)
			} else {
				fmt.Fprintln(stdout, tc.Text)
			}
		}
	}

	if res.IsError {
		return errors.New("tool execution returned an error")
	}

	return nil
}

func runInit(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	configPath := "speedgrapher.json"
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		defaultConfig := map[string]any{
			"accept": []string{},
		}
		data, err := json.MarshalIndent(defaultConfig, "", "  ")
		if err == nil {
			data = append(data, '\n')
			_ = os.WriteFile(configPath, data, 0644)
		}
	}

	hasScopeFlag := false
	for _, arg := range args {
		if arg == "-w" || arg == "--workspace" || arg == "-g" || arg == "--global" {
			hasScopeFlag = true
			break
		}
	}
	installArgs := args
	if !hasScopeFlag {
		installArgs = append([]string{"-w"}, args...)
	}

	return runInstall(ctx, installArgs, stdout, stderr)
}

func runMCP(ctx context.Context, version string, args []string) error {
	var listenAddr string
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if strings.HasPrefix(arg, "--listen=") {
			listenAddr = strings.TrimPrefix(arg, "--listen=")
		} else if strings.HasPrefix(arg, "-listen=") {
			listenAddr = strings.TrimPrefix(arg, "-listen=")
		} else if strings.HasPrefix(arg, "--http=") {
			listenAddr = strings.TrimPrefix(arg, "--http=")
		} else if strings.HasPrefix(arg, "-http=") {
			listenAddr = strings.TrimPrefix(arg, "-http=")
		} else if (arg == "--listen" || arg == "-listen" || arg == "--http" || arg == "-http") && i+1 < len(args) {
			listenAddr = args[i+1]
			i++
		}
	}

	srv, err := server.NewServer(server.Config{
		Version: version,
	})
	if err != nil {
		return err
	}

	if listenAddr != "" {
		return server.RunStreamableHTTP(ctx, srv, listenAddr)
	}

	return server.RunStdio(ctx, srv)
}

// Helper to parse arguments into a struct, supporting JSON string argument or stdin JSON.
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

func marshalResult(v any) (*mcp.CallToolResult, error) {
	if v == nil {
		return nil, nil
	}
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to format tool output: %w", err)
	}
	return &mcp.CallToolResult{
		Content: []mcp.Content{
			&mcp.TextContent{
				Text: string(data),
			},
		},
	}, nil
}
