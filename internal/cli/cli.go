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

// Package cli implements the command-line interface for speedgrapher using Cobra.
package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/spf13/cobra"
)

// AppName is the root command executable name.
const AppName = "speedgrapher"

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

// GlobalOptions holds global CLI flags.
type GlobalOptions struct {
	ConfigPath string
	Verbose    bool
	Quiet      bool
}

// NewRootCmd constructs the main Cobra command tree following GoDoctor's CLI design.
func NewRootCmd(version string, stdin io.Reader, stdout, stderr io.Writer) *cobra.Command {
	var globalOpts GlobalOptions

	rootCmd := &cobra.Command{
		Use:           AppName,
		Short:         "High-Performance Editorial MCP Server & Intelligence Tools",
		Version:       version,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return cmd.Help()
		},
	}

	rootCmd.SetVersionTemplate("{{.Version}}\n")
	rootCmd.SetIn(stdin)
	rootCmd.SetOut(stdout)
	rootCmd.SetErr(stderr)

	// Global / Persistent Flags
	rootCmd.PersistentFlags().StringVarP(
		&globalOpts.ConfigPath, "config", "c", "", "Path to configuration file",
	)
	rootCmd.PersistentFlags().BoolVarP(&globalOpts.Verbose, "verbose", "V", false, "Verbose output")
	rootCmd.PersistentFlags().BoolVarP(&globalOpts.Quiet, "quiet", "q", false, "Quiet output")

	// Register Subcommands
	rootCmd.AddCommand(newCallCmd(stdin, stdout, stderr))
	rootCmd.AddCommand(newMCPCmd(version, &globalOpts, stdout, stderr))
	rootCmd.AddCommand(newCheckCmd(stdout, stderr))
	rootCmd.AddCommand(newInitCmd(stdout, stderr))
	rootCmd.AddCommand(newListCmd(stdout))
	rootCmd.AddCommand(newInstallCmd(stdout, stderr))
	rootCmd.AddCommand(newUninstallCmd(stdout, stderr))
	rootCmd.AddCommand(newVersionCmd(version, stdout))

	return rootCmd
}

// Run executes the CLI with the given arguments and streams.
func Run(ctx context.Context, version string, args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	rootCmd := NewRootCmd(version, stdin, stdout, stderr)

	// Normalize legacy single-dash flags (e.g. -version -> --version, -help -> --help)
	normalizedArgs := make([]string, len(args))
	copy(normalizedArgs, args)
	for i, arg := range normalizedArgs {
		switch arg {
		case "-version":
			normalizedArgs[i] = "--version"
		case "-help":
			normalizedArgs[i] = "--help"
		}
	}

	rootCmd.SetArgs(normalizedArgs)

	if len(normalizedArgs) == 0 {
		return rootCmd.Help()
	}

	return rootCmd.ExecuteContext(ctx)
}

// PrintHelp writes the main help text to w for backward compatibility.
func PrintHelp(w io.Writer, version string) {
	cmd := NewRootCmd(version, nil, w, w)
	_ = cmd.Help()
}

// marshalResult serializes arbitrary tool output into an MCP CallToolResult.
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
