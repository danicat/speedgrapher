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
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/danicat/speedgrapher/skills"
)

// InstallOptions holds parsed options for the install command.
type InstallOptions struct {
	InstallMCP    bool
	InstallSkills bool
	Workspace     bool
	Global        bool
	Force         bool
	Quiet         bool
	ConfigPath    string
	SkillsDir     string
}

// runInstall parses arguments and executes the speedgrapher install command.
func runInstall(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	_ = ctx
	fs := flag.NewFlagSet("install", flag.ContinueOnError)
	fs.SetOutput(stderr)

	var (
		mcpFlag       = fs.Bool("mcp", false, "Register the MCP server in mcp_config.json")
		skillsFlag    = fs.Bool("skills", false, "Unpack embedded skills (deslopify, inverted-pyramid, tech-interviewer, tech-writer, tech-reviewer, tech-publisher)")
		workspaceFlag = fs.Bool("w", false, "Install to workspace scope (.agents/)")
		workspaceLong = fs.Bool("workspace", false, "Install to workspace scope (.agents/)")
		globalFlag    = fs.Bool("g", false, "Install to global user config (Default: ~/.gemini/config)")
		globalLong    = fs.Bool("global", false, "Install to global user config (Default: ~/.gemini/config)")
		forceFlag     = fs.Bool("f", false, "Force overwrite of existing skill files")
		forceLong     = fs.Bool("force", false, "Force overwrite of existing skill files")
		quietFlag     = fs.Bool("q", false, "Quiet / script-friendly output")
		quietLong     = fs.Bool("quiet", false, "Quiet / script-friendly output")
		configFlag    = fs.String("c", "", "Explicit path to mcp_config.json")
		configLong    = fs.String("config", "", "Explicit path to mcp_config.json")
		skillsDirFlag = fs.String("s", "", "Explicit directory for skills installation")
		skillsDirLong = fs.String("skills-dir", "", "Explicit directory for skills installation")
	)

	fs.Usage = func() {
		fmt.Fprintf(stdout, `Usage:
  speedgrapher install [components] [options]

Components (default: all):
  --mcp                    Register the MCP server in mcp_config.json
  --skills                 Unpack embedded skills (deslopify, inverted-pyramid, etc.)

Options:
  -g, --global             Install to global user config (Default: ~/.gemini/config)
  -w, --workspace          Install to workspace scope (.agents/)
  -f, --force              Force overwrite of existing skill files
  -q, --quiet              Quiet / script-friendly output
  -c, --config <path>      Explicit path to mcp_config.json
  -s, --skills-dir <dir>   Explicit directory for skills installation
  -h, --help               Show this help message
`)
	}

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}

	opts := InstallOptions{
		InstallMCP:    *mcpFlag,
		InstallSkills: *skillsFlag,
		Workspace:     *workspaceFlag || *workspaceLong,
		Global:        *globalFlag || *globalLong,
		Force:         *forceFlag || *forceLong,
		Quiet:         *quietFlag || *quietLong,
		ConfigPath:    *configFlag,
		SkillsDir:     *skillsDirFlag,
	}

	if *configLong != "" {
		opts.ConfigPath = *configLong
	}
	if *skillsDirLong != "" {
		opts.SkillsDir = *skillsDirLong
	}

	// Default: if neither --mcp nor --skills is explicitly specified, install both
	if !opts.InstallMCP && !opts.InstallSkills {
		opts.InstallMCP = true
		opts.InstallSkills = true
	}

	return ExecuteInstall(opts, stdout, stderr)
}

// ExecuteInstall performs the installation according to the given options.
func ExecuteInstall(opts InstallOptions, stdout, stderr io.Writer) error {
	_ = stderr
	// 1. Resolve Target Scope & Directories
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to determine user home directory: %w", err)
	}

	var targetRoot string
	scopeName := "global"

	if opts.Workspace {
		scopeName = "workspace"
		targetRoot = filepath.Join(".", ".agents")
	} else {
		geminiConfig := os.Getenv("GEMINI_CONFIG_DIR")
		if geminiConfig != "" {
			targetRoot = geminiConfig
		} else {
			targetRoot = filepath.Join(homeDir, ".gemini", "config")
		}
	}

	mcpConfigFile := opts.ConfigPath
	if mcpConfigFile == "" {
		mcpConfigFile = filepath.Join(targetRoot, "mcp_config.json")
	}

	skillsTargetDir := opts.SkillsDir
	if skillsTargetDir == "" {
		skillsTargetDir = filepath.Join(targetRoot, "skills")
	}

	// 2. Resolve Binary Path for MCP command
	binCommand := resolveBinaryCommand()

	var mcpConfigUpdated bool
	var installedSkills []string

	// 3. Initialize MCP Server
	if opts.InstallMCP {
		if err := configureMCPServer(mcpConfigFile, binCommand); err != nil {
			return fmt.Errorf("failed to configure MCP server in %s: %w", mcpConfigFile, err)
		}
		mcpConfigUpdated = true
	}

	// 4. Unpack Embedded Skills
	if opts.InstallSkills {
		installed, err := unpackSkills(skillsTargetDir, opts.Force)
		if err != nil {
			return fmt.Errorf("failed to unpack skills to %s: %w", skillsTargetDir, err)
		}
		installedSkills = installed
	}

	// 5. Cleanup Legacy Artifacts (Global scope only)
	if !opts.Workspace && opts.ConfigPath == "" {
		cleanupLegacyArtifacts(targetRoot)
	}

	// 6. Summary Output
	if !opts.Quiet {
		printInstallSummary(
			stdout, scopeName, targetRoot, mcpConfigFile,
			skillsTargetDir, binCommand, mcpConfigUpdated, installedSkills,
		)
	}

	return nil
}

// resolveBinaryCommand determines whether to use "speedgrapher" (if in PATH) or absolute path.
func resolveBinaryCommand() string {
	execPath, err := os.Executable()
	if err != nil {
		return "speedgrapher"
	}
	realPath, err := filepath.EvalSymlinks(execPath)
	if err == nil {
		execPath = realPath
	}

	// Check if speedgrapher is available in PATH and resolves to this binary
	if lookPath, err := exec.LookPath("speedgrapher"); err == nil {
		if realLookPath, err := filepath.EvalSymlinks(lookPath); err == nil {
			if realLookPath == execPath {
				return "speedgrapher"
			}
		}
	}

	return execPath
}

// configureMCPServer updates or creates mcp_config.json safely.
func configureMCPServer(configPath, binCommand string) error {
	configDir := filepath.Dir(configPath)
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", configDir, err)
	}

	var root map[string]any
	data, err := os.ReadFile(configPath)
	if err == nil && len(bytes.TrimSpace(data)) > 0 {
		if err := json.Unmarshal(data, &root); err != nil {
			// Backup corrupted config
			backupPath := configPath + ".bak"
			_ = os.WriteFile(backupPath, data, 0644)
			root = make(map[string]any)
		}
	} else {
		root = make(map[string]any)
	}

	var servers map[string]any
	if existingServers, ok := root["mcpServers"].(map[string]any); ok {
		servers = existingServers
	} else {
		servers = make(map[string]any)
		root["mcpServers"] = servers
	}

	servers["speedgrapher"] = map[string]any{
		"command": binCommand,
		"args":    []string{"mcp"},
	}

	formatted, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to serialize mcp configuration: %w", err)
	}
	formatted = append(formatted, '\n')

	return os.WriteFile(configPath, formatted, 0644)
}

// unpackSkills writes embedded skills from skills.FS into targetDir.
func unpackSkills(targetDir string, force bool) ([]string, error) {
	skillsList := []string{
		"deslopify",
		"inverted-pyramid",
		"tech-interviewer",
		"tech-writer",
		"tech-reviewer",
		"tech-publisher",
	}
	var installed []string

	for _, skillName := range skillsList {
		skillInstalled := false
		skillUpToDate := true

		err := fs.WalkDir(skills.FS, skillName, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}

			destPath := filepath.Join(targetDir, path)
			if d.IsDir() {
				return os.MkdirAll(destPath, 0755)
			}

			content, err := fs.ReadFile(skills.FS, path)
			if err != nil {
				return fmt.Errorf("failed to read embedded skill file %s: %w", path, err)
			}

			if existing, err := os.ReadFile(destPath); err == nil {
				if bytes.Equal(existing, content) {
					return nil
				}
				if !force {
					skillUpToDate = false
					return nil
				}
			}

			destDir := filepath.Dir(destPath)
			if err := os.MkdirAll(destDir, 0755); err != nil {
				return fmt.Errorf("failed to create directory %s: %w", destDir, err)
			}

			if err := os.WriteFile(destPath, content, 0644); err != nil {
				return fmt.Errorf("failed to write skill file %s: %w", destPath, err)
			}

			skillInstalled = true
			skillUpToDate = false
			return nil
		})

		if err != nil {
			return nil, fmt.Errorf("failed to unpack skill %s: %w", skillName, err)
		}

		if skillInstalled {
			installed = append(installed, skillName+" (installed)")
		} else if skillUpToDate {
			installed = append(installed, skillName+" (up-to-date)")
		} else {
			installed = append(installed, skillName+" (kept existing)")
		}
	}

	return installed, nil
}

// cleanupLegacyArtifacts removes obsolete plugins or agent definitions from target root.
func cleanupLegacyArtifacts(targetRoot string) {
	legacyPlugin := filepath.Join(targetRoot, "plugins", "speedgrapher")
	_ = os.RemoveAll(legacyPlugin)

	legacyAgent := filepath.Join(targetRoot, "agents", "speedgrapher.md")
	_ = os.Remove(legacyAgent)
}

// printInstallSummary displays the human-readable installation status.
func printInstallSummary(
	w io.Writer,
	scope, targetRoot, mcpPath, skillsDir, binCommand string,
	mcpUpdated bool,
	installedSkills []string,
) {
	fmt.Fprintf(w, `=============================================================
           ⚡ Speedgrapher Installation Complete            
=============================================================
Scope:       %s (%s)
Binary:      %s

Surfaces Initialized:
`, scope, targetRoot, binCommand)

	if mcpUpdated {
		fmt.Fprintf(w, `  ✓ MCP Server:  Registered in %s
                 Tools: fog, slop, seo, vale
`, mcpPath)
	}

	if len(installedSkills) > 0 {
		fmt.Fprintf(w, "  ✓ Skills:      Installed in %s\n", skillsDir)
		for _, s := range installedSkills {
			fmt.Fprintf(w, "                 • @%s\n", s)
		}
	}

	fmt.Fprintf(w, `  ✓ CLI Mode:    Ready for direct execution
                 Usage: speedgrapher call {fog|slop|seo|vale}

Quick Verification:
  • Test CLI: speedgrapher call fog '{"text": "Sample text."}'
  • Test MCP: speedgrapher mcp
`)
}
