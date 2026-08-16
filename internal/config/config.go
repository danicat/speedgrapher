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

package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Default filenames and paths.
const (
	DefaultConfigFileName   = "speedgrapher.json"
	DefaultEditorialPath    = "EDITORIAL.md"
	DefaultLocalizationPath = "LOCALIZATION.md"
	DefaultValeConfigPath   = ".vale.ini"
)

// ToolsConfig holds feature flags for tool activations.
type ToolsConfig struct {
	Fog  bool `json:"fog"`
	Slop bool `json:"slop"`
	SEO  bool `json:"seo"`
	Vale bool `json:"vale"`
}

// GuidelinesConfig holds configuration paths for project guidelines and linters.
type GuidelinesConfig struct {
	Editorial    string `json:"editorial"`
	Localization string `json:"localization"`
	ValeConfig   string `json:"vale_config"`
}

// Config represents the workspace-scoped configuration for Speedgrapher.
type Config struct {
	WorkspaceDir string           `json:"-"`
	Accept       []string         `json:"accept,omitempty"`
	Tools        ToolsConfig      `json:"tools"`
	Guidelines   GuidelinesConfig `json:"guidelines"`
}

// rawToolsConfig is used for unmarshaling with optional/pointer fields.
type rawToolsConfig struct {
	Fog  *bool `json:"fog"`
	Slop *bool `json:"slop"`
	SEO  *bool `json:"seo"`
	Vale *bool `json:"vale"`
}

// rawGuidelinesConfig is used for unmarshaling with optional/pointer fields.
type rawGuidelinesConfig struct {
	Editorial    *string `json:"editorial"`
	Localization *string `json:"localization"`
	ValeConfig   *string `json:"vale_config"`
}

// rawConfig is used for unmarshaling to detect present vs missing fields.
type rawConfig struct {
	Accept     *[]string            `json:"accept"`
	Tools      *rawToolsConfig      `json:"tools"`
	Guidelines *rawGuidelinesConfig `json:"guidelines"`
}

// DefaultToolsConfig returns a ToolsConfig with all tools enabled.
func DefaultToolsConfig() ToolsConfig {
	return ToolsConfig{
		Fog:  true,
		Slop: true,
		SEO:  true,
		Vale: true,
	}
}

// DefaultGuidelinesConfig returns a GuidelinesConfig with default guideline filenames.
func DefaultGuidelinesConfig() GuidelinesConfig {
	return GuidelinesConfig{
		Editorial:    DefaultEditorialPath,
		Localization: DefaultLocalizationPath,
		ValeConfig:   DefaultValeConfigPath,
	}
}

// DefaultConfig creates a Config with all default values resolved against workspaceDir.
func DefaultConfig(workspaceDir string) *Config {
	if workspaceDir == "" {
		workspaceDir = "."
	}
	absDir, err := filepath.Abs(workspaceDir)
	if err == nil {
		workspaceDir = absDir
	}

	cfg := &Config{
		WorkspaceDir: workspaceDir,
		Accept:       []string{},
		Tools:        DefaultToolsConfig(),
		Guidelines:   DefaultGuidelinesConfig(),
	}
	cfg.ResolvePaths()
	return cfg
}

// UnmarshalJSON implements custom JSON unmarshaling to apply default values for omitted fields.
func (c *Config) UnmarshalJSON(data []byte) error {
	var raw rawConfig
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	c.Tools = DefaultToolsConfig()
	c.Guidelines = DefaultGuidelinesConfig()
	c.Accept = []string{}

	if raw.Accept != nil {
		c.Accept = *raw.Accept
	}

	if raw.Tools != nil {
		if raw.Tools.Fog != nil {
			c.Tools.Fog = *raw.Tools.Fog
		}
		if raw.Tools.Slop != nil {
			c.Tools.Slop = *raw.Tools.Slop
		}
		if raw.Tools.SEO != nil {
			c.Tools.SEO = *raw.Tools.SEO
		}
		if raw.Tools.Vale != nil {
			c.Tools.Vale = *raw.Tools.Vale
		}
	}

	if raw.Guidelines != nil {
		if raw.Guidelines.Editorial != nil && *raw.Guidelines.Editorial != "" {
			c.Guidelines.Editorial = *raw.Guidelines.Editorial
		}
		if raw.Guidelines.Localization != nil && *raw.Guidelines.Localization != "" {
			c.Guidelines.Localization = *raw.Guidelines.Localization
		}
		if raw.Guidelines.ValeConfig != nil && *raw.Guidelines.ValeConfig != "" {
			c.Guidelines.ValeConfig = *raw.Guidelines.ValeConfig
		}
	}

	return nil
}

// ResolvePaths converts any relative guideline paths to absolute paths based on WorkspaceDir.
func (c *Config) ResolvePaths() {
	if c.WorkspaceDir == "" {
		c.WorkspaceDir = "."
	}
	if absDir, err := filepath.Abs(c.WorkspaceDir); err == nil {
		c.WorkspaceDir = absDir
	}

	if c.Guidelines.Editorial != "" && !filepath.IsAbs(c.Guidelines.Editorial) {
		c.Guidelines.Editorial = filepath.Join(c.WorkspaceDir, c.Guidelines.Editorial)
	}
	if c.Guidelines.Localization != "" && !filepath.IsAbs(c.Guidelines.Localization) {
		c.Guidelines.Localization = filepath.Join(c.WorkspaceDir, c.Guidelines.Localization)
	}
	if c.Guidelines.ValeConfig != "" && !filepath.IsAbs(c.Guidelines.ValeConfig) {
		c.Guidelines.ValeConfig = filepath.Join(c.WorkspaceDir, c.Guidelines.ValeConfig)
	}
}

// Load reads and parses speedgrapher configuration from a file or directory path.
// If pathOrDir is a directory, it looks for speedgrapher.json inside it.
// If the config file does not exist, it returns a default configuration with resolved paths.
func Load(pathOrDir string) (*Config, error) {
	if pathOrDir == "" {
		pathOrDir = "."
	}

	absPathOrDir, err := filepath.Abs(pathOrDir)
	if err != nil {
		return nil, fmt.Errorf("resolve path %s: %w", pathOrDir, err)
	}

	var filePath string
	var workspaceDir string

	stat, err := os.Stat(absPathOrDir)
	if err == nil {
		if stat.IsDir() {
			workspaceDir = absPathOrDir
			filePath = filepath.Join(absPathOrDir, DefaultConfigFileName)
		} else {
			filePath = absPathOrDir
			workspaceDir = filepath.Dir(absPathOrDir)
		}
	} else if os.IsNotExist(err) {
		if strings.HasSuffix(strings.ToLower(absPathOrDir), ".json") {
			filePath = absPathOrDir
			workspaceDir = filepath.Dir(absPathOrDir)
		} else {
			workspaceDir = absPathOrDir
			filePath = filepath.Join(absPathOrDir, DefaultConfigFileName)
		}
	} else {
		return nil, fmt.Errorf("stat path %s: %w", pathOrDir, err)
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return DefaultConfig(workspaceDir), nil
		}
		return nil, fmt.Errorf("read config %s: %w", filePath, err)
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config %s: %w", filePath, err)
	}

	cfg.WorkspaceDir = workspaceDir
	cfg.ResolvePaths()
	return &cfg, nil
}

// Save writes formatted JSON configuration to the specified file path.
// Absolute guideline paths matching the target directory will be made relative for portability.
func (c *Config) Save(path string) error {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve path %s: %w", path, err)
	}

	dir := filepath.Dir(absPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create directory %s: %w", dir, err)
	}

	saveCfg := *c
	saveCfg.Guidelines = GuidelinesConfig{
		Editorial:    makeRelative(dir, c.Guidelines.Editorial),
		Localization: makeRelative(dir, c.Guidelines.Localization),
		ValeConfig:   makeRelative(dir, c.Guidelines.ValeConfig),
	}

	data, err := json.MarshalIndent(saveCfg, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	data = append(data, '\n')

	if err := os.WriteFile(absPath, data, 0644); err != nil {
		return fmt.Errorf("write config %s: %w", absPath, err)
	}
	return nil
}

// SaveToDir writes formatted JSON configuration to speedgrapher.json in the specified directory.
func (c *Config) SaveToDir(dir string) error {
	return c.Save(filepath.Join(dir, DefaultConfigFileName))
}

// Init creates a default speedgrapher.json file in the given workspace directory
// and returns the initialized configuration with resolved paths.
func Init(workspaceDir string) (*Config, error) {
	if workspaceDir == "" {
		workspaceDir = "."
	}
	absDir, err := filepath.Abs(workspaceDir)
	if err != nil {
		return nil, fmt.Errorf("resolve workspace dir %s: %w", workspaceDir, err)
	}
	workspaceDir = absDir

	cfg := &Config{
		WorkspaceDir: workspaceDir,
		Accept:       []string{},
		Tools:        DefaultToolsConfig(),
		Guidelines:   DefaultGuidelinesConfig(),
	}

	configFile := filepath.Join(workspaceDir, DefaultConfigFileName)
	if err := cfg.Save(configFile); err != nil {
		return nil, fmt.Errorf("save config: %w", err)
	}

	cfg.ResolvePaths()
	return cfg, nil
}

// makeRelative converts an absolute path inside baseDir to a relative path.
func makeRelative(baseDir, p string) string {
	if p == "" {
		return p
	}
	if !filepath.IsAbs(p) {
		return p
	}
	absBase, err := filepath.Abs(baseDir)
	if err != nil {
		return p
	}
	rel, err := filepath.Rel(absBase, p)
	if err != nil || strings.HasPrefix(rel, "..") {
		return p
	}
	return rel
}
