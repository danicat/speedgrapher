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
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

// DefaultYAMLConfig is the master configuration template.
const DefaultYAMLConfig = `# ==============================================================================
# Speedgrapher Master Configuration (.speedgrapher.yaml)
# ==============================================================================
version: "1"

# CLI Global Execution Settings
cli:
  timeout: "60s"
  output_format: "text"           # "text" | "json" | "yaml"
  color: true
  log_level: "info"               # "debug" | "info" | "warn" | "error"

# MCP Server Settings
server:
  name: "speedgrapher"
  transport: "stdio"              # "stdio" | "http"
  http:
    listen: ":8080"
    read_timeout: "30s"
    write_timeout: "5m"
    idle_timeout: "120s"
    shutdown_timeout: "10s"
    allowed_origins:
      - "http://localhost"
      - "http://localhost:*"
      - "http://127.0.0.1"
      - "http://127.0.0.1:*"
    allow_credentials: true

# External Tools & Linting Configuration
tools:
  fog: true
  slop: true
  seo: true
  vale: true

# Editorial Guidelines & Linter Config Paths
guidelines:
  editorial: "EDITORIAL.md"
  localization: "LOCALIZATION.md"
  vale_config: ".vale.ini"

# Accepted Terms / Allowlist
accept: []
`

// MinimalYAMLConfig is the minimal configuration template.
const MinimalYAMLConfig = `# ==============================================================================
# Speedgrapher Minimal Configuration (.speedgrapher.yaml)
# ==============================================================================
version: "1"

tools:
  fog: true
  slop: true
  seo: true
  vale: true

guidelines:
  editorial: "EDITORIAL.md"
  localization: "LOCALIZATION.md"
  vale_config: ".vale.ini"

accept: []
`

// DefaultJSONConfig is the JSON configuration template.
const DefaultJSONConfig = `{
  "accept": [],
  "tools": {
    "fog": true,
    "slop": true,
    "seo": true,
    "vale": true
  },
  "guidelines": {
    "editorial": "EDITORIAL.md",
    "localization": "LOCALIZATION.md",
    "vale_config": ".vale.ini"
  }
}
`

// MinimalJSONConfig is the minimal JSON configuration template.
const MinimalJSONConfig = `{
  "tools": {
    "fog": true,
    "slop": true,
    "seo": true,
    "vale": true
  }
}
`

func newInitCmd(stdout, stderr io.Writer) *cobra.Command {
	var force bool
	var minimal bool
	var targetDir string
	var useYAML bool
	var noWorkspace bool

	cmd := &cobra.Command{
		Use:   "init",
		Short: "Generate default configuration and configure workspace skills",
		RunE: func(_ *cobra.Command, _ []string) error {
			dir := targetDir
			if dir == "" {
				dir = "."
			}

			if err := os.MkdirAll(dir, 0755); err != nil {
				return fmt.Errorf("failed to create directory %s: %w", dir, err)
			}

			filename := "speedgrapher.json"
			var content string
			if useYAML {
				filename = ".speedgrapher.yaml"
				if minimal {
					content = MinimalYAMLConfig
				} else {
					content = DefaultYAMLConfig
				}
			} else {
				if minimal {
					content = MinimalJSONConfig
				} else {
					content = DefaultJSONConfig
				}
			}

			configPath := filepath.Join(dir, filename)
			exists := false
			if _, err := os.Stat(configPath); err == nil {
				exists = true
			}

			if exists && !force {
				_, _ = fmt.Fprintf(stdout, "Configuration file %s already exists. Use --force to overwrite.\n", configPath)
			} else {
				if err := os.WriteFile(configPath, []byte(content), 0644); err != nil {
					return fmt.Errorf("failed to write config file %s: %w", configPath, err)
					}
				_, _ = fmt.Fprintf(stdout, "Created %s successfully.\n", configPath)
			}

			if !noWorkspace {
				// Initialize workspace MCP and skills
				installOpts := InstallOptions{
					InstallAll:    true,
					InstallMCP:    true,
					InstallSkills: true,
					Workspace:     true,
					Force:         force,
				}
				if dir != "." && dir != "" {
					installOpts.ConfigPath = filepath.Join(dir, ".agents", "mcp_config.json")
					installOpts.SkillsDir = filepath.Join(dir, ".agents", "skills")
				}
				if err := ExecuteInstall(installOpts, stdout, stderr); err != nil {
					return fmt.Errorf("failed to configure workspace: %w", err)
				}
			}

			return nil
		},
	}

	cmd.Flags().BoolVarP(&force, "force", "f", false, "Force overwrite of existing configuration")
	cmd.Flags().BoolVarP(&minimal, "minimal", "m", false, "Generate minimal configuration")
	cmd.Flags().StringVarP(&targetDir, "dir", "d", "", "Directory to generate configuration in (default: current directory)")
	cmd.Flags().BoolVarP(&useYAML, "yaml", "y", false, "Generate .speedgrapher.yaml instead of speedgrapher.json")
	cmd.Flags().BoolVar(&noWorkspace, "no-workspace", false, "Skip automatic workspace MCP/skills configuration")

	return cmd
}
