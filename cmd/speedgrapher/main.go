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

// Package main is the entry point for the speedgrapher CLI and MCP server.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/signal"
	"path/filepath"
	"runtime/debug"
	"strings"
	"syscall"

	"github.com/danicat/speedgrapher/internal/tools/fog"
	"github.com/danicat/speedgrapher/internal/tools/seo"
	"github.com/danicat/speedgrapher/internal/tools/slop"
	"github.com/danicat/speedgrapher/internal/tools/vale"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const defaultVersion = "dev"

var (
	version         = defaultVersion
	valeBinOverride string
)

func init() {
	if version == defaultVersion || version == "" {
		version = resolveVersionFromBuildInfo(version)
	}
}

func resolveVersionFromBuildInfo(fallback string) string {
	info, ok := debug.ReadBuildInfo()
	if !ok || info == nil {
		if fallback != "" {
			return fallback
		}
		return defaultVersion
	}

	if info.Main.Version != "" && info.Main.Version != "(devel)" && info.Main.Version != defaultVersion {
		return info.Main.Version
	}

	var revision string
	var modified bool
	for _, setting := range info.Settings {
		switch setting.Key {
		case "vcs.revision":
			revision = setting.Value
		case "vcs.modified":
			if setting.Value == "true" {
				modified = true
			}
		}
	}

	if revision != "" {
		if len(revision) > 7 {
			revision = revision[:7]
		}
		if modified {
			return fmt.Sprintf("devel (%s-dirty)", revision)
		}
		return fmt.Sprintf("devel (%s)", revision)
	}

	if fallback != "" {
		return fallback
	}
	return defaultVersion
}

type auditParams struct {
	Path    string `json:"path,omitempty"`
	Text    string `json:"text,omitempty"`
	Keyword string `json:"keyword,omitempty"`
	DocType string `json:"doc_type,omitempty"`
}

// BlockHealthTelemetry holds unified per-block readability, slop, and Vale health metrics.
type BlockHealthTelemetry struct {
	BlockIndex   int     `json:"block_index"`
	BlockType    string  `json:"block_type"`
	StartLine    int     `json:"start_line"`
	EndLine      int     `json:"end_line"`
	WordCount    int     `json:"word_count"`
	FogIndex     float64 `json:"fog_index"`
	SlopScore    float64 `json:"slop_score"`
	ValeErrors   int     `json:"vale_errors"`
	ValeWarnings int     `json:"vale_warnings"`
	HealthScore  float64 `json:"health_score"`
	HeatmapTint  string  `json:"heatmap_tint"`
}

type auditResult struct {
	Fog    *fog.FogResult         `json:"fog"`
	Slop   *slop.SlopResult       `json:"slop"`
	Vale   *vale.ValeResult       `json:"vale"`
	SEO    *seo.SEOResult         `json:"seo"`
	Blocks []BlockHealthTelemetry `json:"blocks"`
}

const usageText = `Usage:
  speedgrapher [mcp]                                           Run MCP server over stdio
  speedgrapher audit ['<json>']                                Run all analyzers (fog, slop, vale, seo)
  speedgrapher call <fog|slop|vale|vale_rules|seo> ['<json>']  Invoke a single analyzer or rule manager
  speedgrapher version                                         Print version
`

func main() {
	os.Exit(runMain())
}

func runMain() int {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	err := run(ctx, os.Args[1:], os.Stdin, os.Stdout, os.Stderr)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, io.EOF) {
			return 0
		}
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return 0
}

func run(ctx context.Context, args []string, stdin io.Reader, stdout, _ io.Writer) error {
	if len(args) == 0 {
		return runMCPServer(ctx)
	}

	switch args[0] {
	case "mcp":
		if len(args) > 1 {
			return fmt.Errorf("unexpected arguments for mcp: %v", args[1:])
		}
		return runMCPServer(ctx)
	case "version", "--version", "-version", "-v":
		_, _ = fmt.Fprintln(stdout, version)
		return nil
	case "help", "--help", "-help", "-h":
		_, _ = fmt.Fprint(stdout, usageText)
		return nil
	case "audit":
		return runAudit(ctx, args[1:], stdin, stdout)
	case "call":
		return runCall(ctx, args[1:], stdin, stdout)
	default:
		if strings.HasPrefix(args[0], "-") {
			return fmt.Errorf("unknown flag: %s", args[0])
		}
		return fmt.Errorf("unknown command: %s", args[0])
	}
}

func resolveWorkspaceDir() (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("failed to determine current working directory: %w", err)
	}
	return cwd, nil
}

func runMCPServer(ctx context.Context) error {
	workspaceDir, err := resolveWorkspaceDir()
	if err != nil {
		return err
	}

	server := mcp.NewServer(&mcp.Implementation{
		Name:    "speedgrapher",
		Version: version,
	}, nil)

	fog.Register(server, fog.Config{WorkspaceDir: workspaceDir})
	slop.Register(server, slop.Config{WorkspaceDir: workspaceDir})
	seo.Register(server, seo.Config{WorkspaceDir: workspaceDir})
	vale.Register(server, vale.Config{WorkspaceDir: workspaceDir, ValeBinPath: valeBinOverride})

	return server.Run(ctx, &mcp.StdioTransport{})
}

func readJSONPayload(args []string, stdin io.Reader) ([]byte, error) {
	if len(args) > 1 {
		return nil, fmt.Errorf("unexpected extra arguments: %v", args[1:])
	}
	if len(args) == 1 && strings.TrimSpace(args[0]) != "" {
		return []byte(args[0]), nil
	}
	if stdin == nil {
		return nil, fmt.Errorf("missing JSON input payload")
	}
	data, err := io.ReadAll(stdin)
	if err != nil {
		return nil, fmt.Errorf("failed to read JSON input from stdin: %w", err)
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return nil, fmt.Errorf("missing JSON input payload")
	}
	return data, nil
}

type valeAlertJSON struct {
	Line     int    `json:"Line"`
	Severity string `json:"Severity"`
}

func buildBlockHealthTelemetry(fogRes *fog.FogResult, slopRes *slop.SlopResult, valeRes *vale.ValeResult) ([]BlockHealthTelemetry, error) {
	if fogRes == nil || len(fogRes.Paragraphs) == 0 {
		return []BlockHealthTelemetry{}, nil
	}

	slopByRange := make(map[[2]int]slop.ParagraphSlop, len(slopRes.Paragraphs))
	if slopRes != nil {
		for _, sp := range slopRes.Paragraphs {
			slopByRange[[2]int{sp.StartLine, sp.EndLine}] = sp
		}
	}

	var valeAlerts []valeAlertJSON
	if valeRes != nil && strings.TrimSpace(valeRes.Output) != "" {
		var rawMap map[string][]valeAlertJSON
		if err := json.Unmarshal([]byte(valeRes.Output), &rawMap); err != nil {
			return nil, fmt.Errorf("failed to parse Vale JSON output for block telemetry: %w", err)
		}
		for _, alerts := range rawMap {
			valeAlerts = append(valeAlerts, alerts...)
		}
	}

	blocks := make([]BlockHealthTelemetry, 0, len(fogRes.Paragraphs))
	for _, fp := range fogRes.Paragraphs {
		sp, hasSlop := slopByRange[[2]int{fp.StartLine, fp.EndLine}]
		slopScore := 0.0
		if hasSlop {
			slopScore = sp.SlopScore
		}

		vErrors := 0
		vWarnings := 0
		for _, a := range valeAlerts {
			if a.Line >= fp.StartLine && a.Line <= fp.EndLine {
				switch strings.ToLower(a.Severity) {
				case "error":
					vErrors++
				case "warning":
					vWarnings++
				}
			}
		}

		effectiveFog := fp.FogIndex
		if fp.BlockType == "heading" || fp.TotalWords < 8 {
			effectiveFog = 0
		}

		health := 100.0
		if effectiveFog > 14.0 {
			health -= (effectiveFog - 14.0) * 2.2
		}
		health -= slopScore * 0.45
		health -= float64(vErrors) * 8.0
		health -= float64(vWarnings) * 5.0
		if health < 0.0 {
			health = 0.0
		}
		health = math.Round(health*100) / 100

		var tint string
		switch {
		case health >= 96.0 && vErrors == 0 && vWarnings == 0 && slopScore == 0 && (effectiveFog == 0 || effectiveFog <= 14.5):
			tint = "pristine"
		case health >= 88.0:
			tint = "clean"
		case health >= 76.0:
			tint = "mild"
		case health >= 64.0:
			tint = "fair"
		case health >= 50.0:
			tint = "warn"
		case health >= 36.0:
			tint = "high"
		default:
			tint = "bad"
		}

		blocks = append(blocks, BlockHealthTelemetry{
			BlockIndex:   fp.BlockIndex,
			BlockType:    fp.BlockType,
			StartLine:    fp.StartLine,
			EndLine:      fp.EndLine,
			WordCount:    fp.TotalWords,
			FogIndex:     fp.FogIndex,
			SlopScore:    slopScore,
			ValeErrors:   vErrors,
			ValeWarnings: vWarnings,
			HealthScore:  health,
			HeatmapTint:  tint,
		})
	}

	return blocks, nil
}

func runAudit(ctx context.Context, args []string, stdin io.Reader, stdout io.Writer) error {
	payload, err := readJSONPayload(args, stdin)
	if err != nil {
		return fmt.Errorf("audit input error: %w", err)
	}

	var params auditParams
	if err := json.Unmarshal(payload, &params); err != nil {
		return fmt.Errorf("failed to parse audit JSON payload: %w", err)
	}

	workspaceDir, err := resolveWorkspaceDir()
	if err != nil {
		return err
	}

	if params.Text == "" && params.Path == "" {
		return fmt.Errorf("audit requires non-empty 'text' or 'path' in JSON input")
	}

	text := params.Text
	var absPath string
	if params.Path != "" {
		targetPath := params.Path
		if !filepath.IsAbs(targetPath) {
			targetPath = filepath.Join(workspaceDir, targetPath)
		}
		resolved, absErr := filepath.Abs(filepath.Clean(targetPath))
		if absErr != nil {
			return fmt.Errorf("failed to resolve path %s: %w", params.Path, absErr)
		}
		absPath = resolved
		if text == "" {
			data, readErr := os.ReadFile(absPath)
			if readErr != nil {
				return fmt.Errorf("failed to read file %s: %w", absPath, readErr)
			}
			text = string(data)
		}
	}

	fogRes, err := fog.Analyze(fog.FogParams{Text: text, Path: absPath}, fog.Config{WorkspaceDir: workspaceDir})
	if err != nil {
		return fmt.Errorf("fog analysis failed: %w", err)
	}

	slopRes, err := slop.Analyze(slop.SlopParams{Text: text, Path: absPath}, slop.Config{WorkspaceDir: workspaceDir})
	if err != nil {
		return fmt.Errorf("slop analysis failed: %w", err)
	}

	valeRes, err := vale.Analyze(ctx, vale.ValeParams{Text: text, Path: absPath}, vale.Config{
		WorkspaceDir: workspaceDir,
		ValeBinPath:  valeBinOverride,
	})
	if err != nil {
		return fmt.Errorf("vale analysis failed: %w", err)
	}

	seoRes, err := seo.Analyze(ctx, seo.SEOParams{
		HTML:    text,
		Path:    absPath,
		Keyword: params.Keyword,
		DocType: params.DocType,
	}, seo.Config{WorkspaceDir: workspaceDir})
	if err != nil {
		return fmt.Errorf("seo analysis failed: %w", err)
	}

	blocks, err := buildBlockHealthTelemetry(fogRes, slopRes, valeRes)
	if err != nil {
		return err
	}

	return writeJSON(stdout, auditResult{
		Fog:    fogRes,
		Slop:   slopRes,
		Vale:   valeRes,
		SEO:    seoRes,
		Blocks: blocks,
	})
}

func runCall(ctx context.Context, args []string, stdin io.Reader, stdout io.Writer) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: speedgrapher call <fog|slop|vale|vale_rules|seo> ['<json>']")
	}

	toolName := args[0]
	payload, err := readJSONPayload(args[1:], stdin)
	if err != nil {
		return fmt.Errorf("call %s input error: %w", toolName, err)
	}

	workspaceDir, err := resolveWorkspaceDir()
	if err != nil {
		return err
	}

	switch toolName {
	case "fog":
		var params fog.FogParams
		if err := json.Unmarshal(payload, &params); err != nil {
			return fmt.Errorf("invalid JSON for fog: %w", err)
		}
		res, err := fog.Analyze(params, fog.Config{WorkspaceDir: workspaceDir})
		if err != nil {
			return err
		}
		return writeJSON(stdout, res)

	case "slop":
		var params slop.SlopParams
		if err := json.Unmarshal(payload, &params); err != nil {
			return fmt.Errorf("invalid JSON for slop: %w", err)
		}
		res, err := slop.Analyze(params, slop.Config{WorkspaceDir: workspaceDir})
		if err != nil {
			return err
		}
		return writeJSON(stdout, res)

	case "vale":
		var params vale.ValeParams
		if err := json.Unmarshal(payload, &params); err != nil {
			return fmt.Errorf("invalid JSON for vale: %w", err)
		}
		res, err := vale.Analyze(ctx, params, vale.Config{
			WorkspaceDir: workspaceDir,
			ValeBinPath:  valeBinOverride,
		})
		if err != nil {
			return err
		}
		return writeJSON(stdout, res)

	case "vale_rules":
		var params vale.ValeRuleActionParams
		if err := json.Unmarshal(payload, &params); err != nil {
			return fmt.Errorf("invalid JSON for vale_rules: %w", err)
		}
		res, err := vale.ManageRules(params, vale.Config{
			WorkspaceDir: workspaceDir,
			ValeBinPath:  valeBinOverride,
		})
		if err != nil {
			return err
		}
		return writeJSON(stdout, res)

	case "seo":
		var params seo.SEOParams
		if err := json.Unmarshal(payload, &params); err != nil {
			return fmt.Errorf("invalid JSON for seo: %w", err)
		}
		res, err := seo.Analyze(ctx, params, seo.Config{WorkspaceDir: workspaceDir})
		if err != nil {
			return err
		}
		return writeJSON(stdout, res)

	default:
		return fmt.Errorf("unknown tool %q (expected fog, slop, vale, vale_rules, or seo)", toolName)
	}
}

func writeJSON(w io.Writer, v any) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}
