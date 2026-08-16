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
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestDefaultToolsConfig(t *testing.T) {
	tools := DefaultToolsConfig()
	if !tools.Fog || !tools.Slop || !tools.SEO || !tools.Vale {
		t.Fatalf("expected all tools to default to true, got: %+v", tools)
	}
}

func TestDefaultGuidelinesConfig(t *testing.T) {
	g := DefaultGuidelinesConfig()
	if g.Editorial != DefaultEditorialPath {
		t.Errorf("expected editorial to be %q, got %q", DefaultEditorialPath, g.Editorial)
	}
	if g.Localization != DefaultLocalizationPath {
		t.Errorf("expected localization to be %q, got %q", DefaultLocalizationPath, g.Localization)
	}
	if g.ValeConfig != DefaultValeConfigPath {
		t.Errorf("expected vale_config to be %q, got %q", DefaultValeConfigPath, g.ValeConfig)
	}
}

func TestDefaultConfig(t *testing.T) {
	tmpDir := t.TempDir()
	absTmpDir, err := filepath.Abs(tmpDir)
	if err != nil {
		t.Fatalf("failed to get abs path: %v", err)
	}

	cfg := DefaultConfig(tmpDir)
	if cfg.WorkspaceDir != absTmpDir {
		t.Errorf("expected workspaceDir %q, got %q", absTmpDir, cfg.WorkspaceDir)
	}
	if !cfg.Tools.Fog || !cfg.Tools.Slop || !cfg.Tools.SEO || !cfg.Tools.Vale {
		t.Errorf("expected all tools true in default config, got: %+v", cfg.Tools)
	}
	if cfg.Guidelines.Editorial != filepath.Join(absTmpDir, DefaultEditorialPath) {
		t.Errorf("expected editorial %q, got %q", filepath.Join(absTmpDir, DefaultEditorialPath), cfg.Guidelines.Editorial)
	}
	if cfg.Guidelines.Localization != filepath.Join(absTmpDir, DefaultLocalizationPath) {
		t.Errorf("expected localization %q, got %q", filepath.Join(absTmpDir, DefaultLocalizationPath), cfg.Guidelines.Localization)
	}
	if cfg.Guidelines.ValeConfig != filepath.Join(absTmpDir, DefaultValeConfigPath) {
		t.Errorf("expected vale_config %q, got %q", filepath.Join(absTmpDir, DefaultValeConfigPath), cfg.Guidelines.ValeConfig)
	}
	if len(cfg.Accept) != 0 {
		t.Errorf("expected empty accept list, got: %v", cfg.Accept)
	}
}

func TestDefaultConfigEmptyWorkspace(t *testing.T) {
	cfg := DefaultConfig("")
	cwd, _ := filepath.Abs(".")
	if cfg.WorkspaceDir != cwd {
		t.Errorf("expected workspaceDir %q, got %q", cwd, cfg.WorkspaceDir)
	}
}

func TestResolvePaths(t *testing.T) {
	tmpDir := t.TempDir()
	absTmpDir, err := filepath.Abs(tmpDir)
	if err != nil {
		t.Fatalf("failed to get abs path: %v", err)
	}

	cfg := &Config{
		WorkspaceDir: absTmpDir,
		Guidelines: GuidelinesConfig{
			Editorial:    "docs/editorial_guide.md",
			Localization: "docs/loc.md",
			ValeConfig:   "config/.vale.ini",
		},
	}

	cfg.ResolvePaths()

	expectedEditorial := filepath.Join(absTmpDir, "docs/editorial_guide.md")
	expectedLocalization := filepath.Join(absTmpDir, "docs/loc.md")
	expectedVale := filepath.Join(absTmpDir, "config/.vale.ini")

	if cfg.Guidelines.Editorial != expectedEditorial {
		t.Errorf("expected editorial %q, got %q", expectedEditorial, cfg.Guidelines.Editorial)
	}
	if cfg.Guidelines.Localization != expectedLocalization {
		t.Errorf("expected localization %q, got %q", expectedLocalization, cfg.Guidelines.Localization)
	}
	if cfg.Guidelines.ValeConfig != expectedVale {
		t.Errorf("expected vale_config %q, got %q", expectedVale, cfg.Guidelines.ValeConfig)
	}

	// Calling ResolvePaths again must be idempotent
	cfg.ResolvePaths()
	if cfg.Guidelines.Editorial != expectedEditorial ||
		cfg.Guidelines.Localization != expectedLocalization ||
		cfg.Guidelines.ValeConfig != expectedVale {
		t.Errorf("ResolvePaths is not idempotent: %+v", cfg.Guidelines)
	}
}

func TestLoad_NonExistentFileReturnsDefault(t *testing.T) {
	tmpDir := t.TempDir()
	absTmpDir, _ := filepath.Abs(tmpDir)

	// Loading directory with no speedgrapher.json
	cfg, err := Load(tmpDir)
	if err != nil {
		t.Fatalf("expected no error on non-existent config, got: %v", err)
	}
	if cfg == nil {
		t.Fatal("expected non-nil config")
	}
	if cfg.WorkspaceDir != absTmpDir {
		t.Errorf("expected workspaceDir %q, got %q", absTmpDir, cfg.WorkspaceDir)
	}
	if !cfg.Tools.Fog || !cfg.Tools.Slop || !cfg.Tools.SEO || !cfg.Tools.Vale {
		t.Errorf("expected default tools true, got: %+v", cfg.Tools)
	}
	if cfg.Guidelines.Editorial != filepath.Join(absTmpDir, DefaultEditorialPath) {
		t.Errorf("expected resolved editorial path %q, got %q", filepath.Join(absTmpDir, DefaultEditorialPath), cfg.Guidelines.Editorial)
	}

	// Loading non-existent explicit json path
	nonExistentFile := filepath.Join(tmpDir, "missing", "speedgrapher.json")
	cfg2, err := Load(nonExistentFile)
	if err != nil {
		t.Fatalf("expected no error on non-existent file, got: %v", err)
	}
	absMissingDir, _ := filepath.Abs(filepath.Dir(nonExistentFile))
	if cfg2.WorkspaceDir != absMissingDir {
		t.Errorf("expected workspaceDir %q, got %q", absMissingDir, cfg2.WorkspaceDir)
	}
}

func TestLoad_ExistingFileFull(t *testing.T) {
	tmpDir := t.TempDir()
	absTmpDir, _ := filepath.Abs(tmpDir)

	jsonContent := `{
		"accept": ["Speedgrapher", "Vale"],
		"tools": {
			"fog": true,
			"slop": false,
			"seo": true,
			"vale": false
		},
		"guidelines": {
			"editorial": "custom_editorial.md",
			"localization": "custom_loc.md",
			"vale_config": "custom_vale.ini"
		}
	}`

	configPath := filepath.Join(tmpDir, DefaultConfigFileName)
	if err := os.WriteFile(configPath, []byte(jsonContent), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	cfg, err := Load(tmpDir)
	if err != nil {
		t.Fatalf("unexpected load error: %v", err)
	}

	if !reflect.DeepEqual(cfg.Accept, []string{"Speedgrapher", "Vale"}) {
		t.Errorf("expected accept list ['Speedgrapher', 'Vale'], got: %v", cfg.Accept)
	}
	if cfg.Tools.Fog != true || cfg.Tools.Slop != false || cfg.Tools.SEO != true || cfg.Tools.Vale != false {
		t.Errorf("unexpected tools config: %+v", cfg.Tools)
	}
	if cfg.Guidelines.Editorial != filepath.Join(absTmpDir, "custom_editorial.md") {
		t.Errorf("unexpected editorial path: %q", cfg.Guidelines.Editorial)
	}
	if cfg.Guidelines.Localization != filepath.Join(absTmpDir, "custom_loc.md") {
		t.Errorf("unexpected localization path: %q", cfg.Guidelines.Localization)
	}
	if cfg.Guidelines.ValeConfig != filepath.Join(absTmpDir, "custom_vale.ini") {
		t.Errorf("unexpected vale_config path: %q", cfg.Guidelines.ValeConfig)
	}
}

func TestLoad_ExistingFileWithMissingFieldsAppliesDefaults(t *testing.T) {
	tmpDir := t.TempDir()
	absTmpDir, _ := filepath.Abs(tmpDir)

	// Only accept list is provided
	jsonContent := `{
		"accept": ["Speedgrapher", "Goreleaser", "agentic"]
	}`

	configPath := filepath.Join(tmpDir, DefaultConfigFileName)
	if err := os.WriteFile(configPath, []byte(jsonContent), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	cfg, err := Load(configPath)
	if err != nil {
		t.Fatalf("unexpected load error: %v", err)
	}

	if len(cfg.Accept) != 3 {
		t.Errorf("expected 3 accept items, got %d", len(cfg.Accept))
	}
	// All tools should default to true
	if !cfg.Tools.Fog || !cfg.Tools.Slop || !cfg.Tools.SEO || !cfg.Tools.Vale {
		t.Errorf("expected tools to default to true, got %+v", cfg.Tools)
	}
	// All guidelines should default and be resolved
	if cfg.Guidelines.Editorial != filepath.Join(absTmpDir, DefaultEditorialPath) {
		t.Errorf("expected default editorial %q, got %q", filepath.Join(absTmpDir, DefaultEditorialPath), cfg.Guidelines.Editorial)
	}
	if cfg.Guidelines.Localization != filepath.Join(absTmpDir, DefaultLocalizationPath) {
		t.Errorf("expected default localization %q, got %q", filepath.Join(absTmpDir, DefaultLocalizationPath), cfg.Guidelines.Localization)
	}
	if cfg.Guidelines.ValeConfig != filepath.Join(absTmpDir, DefaultValeConfigPath) {
		t.Errorf("expected default vale config %q, got %q", filepath.Join(absTmpDir, DefaultValeConfigPath), cfg.Guidelines.ValeConfig)
	}
}

func TestLoad_PartialToolsAndGuidelines(t *testing.T) {
	tmpDir := t.TempDir()
	absTmpDir, _ := filepath.Abs(tmpDir)

	jsonContent := `{
		"tools": {
			"fog": false
		},
		"guidelines": {
			"editorial": "custom_editorial.md"
		}
	}`

	configPath := filepath.Join(tmpDir, DefaultConfigFileName)
	if err := os.WriteFile(configPath, []byte(jsonContent), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	cfg, err := Load(tmpDir)
	if err != nil {
		t.Fatalf("unexpected load error: %v", err)
	}

	// fog is false, other tools should be true
	if cfg.Tools.Fog != false {
		t.Errorf("expected fog to be false, got true")
	}
	if !cfg.Tools.Slop || !cfg.Tools.SEO || !cfg.Tools.Vale {
		t.Errorf("expected other tools to default to true, got: %+v", cfg.Tools)
	}

	// editorial is custom, others should be default
	if cfg.Guidelines.Editorial != filepath.Join(absTmpDir, "custom_editorial.md") {
		t.Errorf("expected custom editorial %q, got %q", filepath.Join(absTmpDir, "custom_editorial.md"), cfg.Guidelines.Editorial)
	}
	if cfg.Guidelines.Localization != filepath.Join(absTmpDir, DefaultLocalizationPath) {
		t.Errorf("expected default localization, got %q", cfg.Guidelines.Localization)
	}
	if cfg.Guidelines.ValeConfig != filepath.Join(absTmpDir, DefaultValeConfigPath) {
		t.Errorf("expected default vale_config, got %q", cfg.Guidelines.ValeConfig)
	}
}

func TestLoad_MalformedJSON(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, DefaultConfigFileName)
	if err := os.WriteFile(configPath, []byte("{ malformed json"), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	_, err := Load(tmpDir)
	if err == nil {
		t.Fatal("expected error for malformed json, got nil")
	}
}

func TestSaveAndSaveToDir(t *testing.T) {
	tmpDir := t.TempDir()
	absTmpDir, _ := filepath.Abs(tmpDir)

	cfg := &Config{
		WorkspaceDir: absTmpDir,
		Accept:       []string{"CustomTerm"},
		Tools: ToolsConfig{
			Fog:  true,
			Slop: false,
			SEO:  true,
			Vale: true,
		},
		Guidelines: GuidelinesConfig{
			Editorial:    filepath.Join(absTmpDir, "docs/ED.md"),
			Localization: filepath.Join(absTmpDir, "docs/LOC.md"),
			ValeConfig:   filepath.Join(absTmpDir, "VALE.ini"),
		},
	}

	// Test SaveToDir
	if err := cfg.SaveToDir(tmpDir); err != nil {
		t.Fatalf("SaveToDir failed: %v", err)
	}

	savedFile := filepath.Join(tmpDir, DefaultConfigFileName)
	content, err := os.ReadFile(savedFile)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}

	// Verify that saved JSON contains relative paths
	var raw struct {
		Accept     []string         `json:"accept"`
		Tools      ToolsConfig      `json:"tools"`
		Guidelines GuidelinesConfig `json:"guidelines"`
	}
	if err := json.Unmarshal(content, &raw); err != nil {
		t.Fatalf("failed to parse saved JSON: %v", err)
	}

	if !reflect.DeepEqual(raw.Accept, []string{"CustomTerm"}) {
		t.Errorf("saved accept mismatch: %v", raw.Accept)
	}
	if raw.Tools.Slop != false || !raw.Tools.Fog || !raw.Tools.SEO || !raw.Tools.Vale {
		t.Errorf("saved tools mismatch: %+v", raw.Tools)
	}
	if raw.Guidelines.Editorial != "docs/ED.md" {
		t.Errorf("expected relative editorial path 'docs/ED.md', got %q", raw.Guidelines.Editorial)
	}
	if raw.Guidelines.Localization != "docs/LOC.md" {
		t.Errorf("expected relative localization path 'docs/LOC.md', got %q", raw.Guidelines.Localization)
	}
	if raw.Guidelines.ValeConfig != "VALE.ini" {
		t.Errorf("expected relative vale_config path 'VALE.ini', got %q", raw.Guidelines.ValeConfig)
	}

	// Test Reloading the saved config
	loadedCfg, err := Load(tmpDir)
	if err != nil {
		t.Fatalf("failed to load saved config: %v", err)
	}
	if loadedCfg.Guidelines.Editorial != filepath.Join(absTmpDir, "docs/ED.md") {
		t.Errorf("reloaded editorial mismatch: %q", loadedCfg.Guidelines.Editorial)
	}
}

func TestInit(t *testing.T) {
	tmpDir := t.TempDir()
	absTmpDir, _ := filepath.Abs(tmpDir)

	cfg, err := Init(tmpDir)
	if err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	if cfg.WorkspaceDir != absTmpDir {
		t.Errorf("expected workspaceDir %q, got %q", absTmpDir, cfg.WorkspaceDir)
	}
	if !cfg.Tools.Fog || !cfg.Tools.Slop || !cfg.Tools.SEO || !cfg.Tools.Vale {
		t.Errorf("expected all tools true after Init, got: %+v", cfg.Tools)
	}
	if cfg.Guidelines.Editorial != filepath.Join(absTmpDir, DefaultEditorialPath) {
		t.Errorf("expected resolved editorial path, got %q", cfg.Guidelines.Editorial)
	}

	// Verify file was actually created on disk
	configPath := filepath.Join(tmpDir, DefaultConfigFileName)
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("speedgrapher.json was not created by Init: %v", err)
	}

	var parsed Config
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("failed to parse speedgrapher.json created by Init: %v", err)
	}
	if parsed.Guidelines.Editorial != DefaultEditorialPath {
		t.Errorf("expected relative editorial path in file %q, got %q", DefaultEditorialPath, parsed.Guidelines.Editorial)
	}
}

func TestMakeRelative(t *testing.T) {
	base := "/home/user/project"

	tests := []struct {
		input    string
		expected string
	}{
		{"/home/user/project/EDITORIAL.md", "EDITORIAL.md"},
		{"/home/user/project/docs/EDITORIAL.md", "docs/EDITORIAL.md"},
		{"EDITORIAL.md", "EDITORIAL.md"},
		{"/var/log/other.log", "/var/log/other.log"},
		{"", ""},
	}

	for _, tt := range tests {
		result := makeRelative(base, tt.input)
		if result != tt.expected {
			t.Errorf("makeRelative(%q, %q) = %q, expected %q", base, tt.input, result, tt.expected)
		}
	}
}
