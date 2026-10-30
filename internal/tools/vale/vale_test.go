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

package vale

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestFindValeConfigUp(t *testing.T) {
	tmpDir := t.TempDir()

	iniPath := filepath.Join(tmpDir, ".vale.ini")
	if err := os.WriteFile(iniPath, []byte("StylesPath = styles\n"), 0644); err != nil {
		t.Fatalf("failed to write test .vale.ini: %v", err)
	}
	stylesDir := filepath.Join(tmpDir, "styles")
	if err := os.MkdirAll(stylesDir, 0755); err != nil {
		t.Fatalf("failed to create styles dir: %v", err)
	}

	binDir := filepath.Join(tmpDir, "bin")
	subDir := filepath.Join(binDir, "sub")
	deepDir := filepath.Join(subDir, "deep")
	if err := os.MkdirAll(deepDir, 0755); err != nil {
		t.Fatalf("failed to create test dirs: %v", err)
	}

	tests := []struct {
		name     string
		startDir string
		want     string
		wantErr  bool
	}{
		{
			name:     "config in same directory",
			startDir: tmpDir,
			want:     iniPath,
			wantErr:  false,
		},
		{
			name:     "config in parent directory (e.g. bin/)",
			startDir: binDir,
			want:     iniPath,
			wantErr:  false,
		},
		{
			name:     "config in ancestor directory (e.g. bin/sub/)",
			startDir: subDir,
			want:     iniPath,
			wantErr:  false,
		},
		{
			name:     "config in deep ancestor directory (e.g. bin/sub/deep/)",
			startDir: deepDir,
			want:     iniPath,
			wantErr:  false,
		},
		{
			name:     "config missing in empty directory tree",
			startDir: t.TempDir(),
			want:     "",
			wantErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := findValeConfigUp(tt.startDir)
			if (err != nil) != tt.wantErr {
				t.Fatalf("findValeConfigUp() error = %v, wantErr %v", err, tt.wantErr)
			}
			if got != tt.want {
				t.Errorf("findValeConfigUp() = %v, want %v", got, tt.want)
			}
			if got != "" && !filepath.IsAbs(got) {
				t.Errorf("findValeConfigUp() returned non-absolute path: %s", got)
			}
		})
	}
}

func TestSetupValeConfig_WorkspaceDir(t *testing.T) {
	wsDir := t.TempDir()
	iniPath := filepath.Join(wsDir, ".vale.ini")
	if err := os.WriteFile(iniPath, []byte("StylesPath = styles\n"), 0644); err != nil {
		t.Fatalf("failed to write .vale.ini: %v", err)
	}
	stylesDir := filepath.Join(wsDir, "styles")
	if err := os.MkdirAll(stylesDir, 0755); err != nil {
		t.Fatalf("failed to create styles dir: %v", err)
	}

	got, err := setupValeConfig(wsDir)
	if err != nil {
		t.Fatalf("setupValeConfig() unexpected error: %v", err)
	}
	if !filepath.IsAbs(got) {
		t.Errorf("setupValeConfig() returned non-absolute path: %s", got)
	}
	if got != iniPath {
		t.Errorf("setupValeConfig() = %s, want %s", got, iniPath)
	}
}

func TestSetupValeConfig_CwdAndBundledAndMissing(t *testing.T) {
	cwdDir := t.TempDir()
	cwdIni := filepath.Join(cwdDir, ".vale.ini")
	if err := os.WriteFile(cwdIni, []byte("StylesPath = styles\n"), 0644); err != nil {
		t.Fatalf("failed to write cwd .vale.ini: %v", err)
	}
	cwdStyles := filepath.Join(cwdDir, "styles")
	if err := os.MkdirAll(cwdStyles, 0755); err != nil {
		t.Fatalf("failed to create cwd styles dir: %v", err)
	}

	origWd, err := os.Getwd()
	if err != nil {
		t.Fatalf("failed to get wd: %v", err)
	}
	if err := os.Chdir(cwdDir); err != nil {
		t.Fatalf("failed to chdir to %s: %v", cwdDir, err)
	}
	defer func() { _ = os.Chdir(origWd) }()

	// 1. WorkspaceDir is empty, resolves from cwd
	got, err := setupValeConfig("")
	if err != nil {
		t.Fatalf("setupValeConfig(\"\") error: %v", err)
	}
	gotReal, _ := filepath.EvalSymlinks(got)
	cwdIniReal, _ := filepath.EvalSymlinks(cwdIni)
	if gotReal != cwdIniReal {
		t.Errorf("setupValeConfig(\"\") = %s, want %s", got, cwdIni)
	}

	// 2. Bundled executable parent directory resolution when cwd and workspace lack .vale.ini
	emptyCwd := t.TempDir()
	if err := os.Chdir(emptyCwd); err != nil {
		t.Fatalf("failed to chdir: %v", err)
	}
	pluginRoot := t.TempDir()
	bundledIni := filepath.Join(pluginRoot, ".vale.ini")
	if err := os.WriteFile(bundledIni, []byte("StylesPath = styles\n"), 0644); err != nil {
		t.Fatalf("failed to write bundled .vale.ini: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(pluginRoot, "styles"), 0755); err != nil {
		t.Fatalf("failed to create bundled styles dir: %v", err)
	}
	fakeExe := filepath.Join(pluginRoot, "bin", "speedgrapher")

	origExeFunc := executablePathFunc
	origHomeFunc := userHomeDirFunc
	defer func() {
		executablePathFunc = origExeFunc
		userHomeDirFunc = origHomeFunc
	}()
	executablePathFunc = func() (string, error) {
		return fakeExe, nil
	}
	userHomeDirFunc = func() (string, error) {
		return t.TempDir(), nil
	}

	gotBundled, err := setupValeConfig(t.TempDir())
	if err != nil {
		t.Fatalf("setupValeConfig(bundled) error: %v", err)
	}
	gotBundledReal, _ := filepath.EvalSymlinks(gotBundled)
	bundledIniReal, _ := filepath.EvalSymlinks(bundledIni)
	if gotBundledReal != bundledIniReal {
		t.Errorf("setupValeConfig(bundled) = %s, want %s", gotBundled, bundledIni)
	}

	// 3. Installed Antigravity plugin path (~/.gemini/config/plugins/speedgrapher) resolution
	executablePathFunc = func() (string, error) {
		return filepath.Join(t.TempDir(), "go", "bin", "speedgrapher"), nil
	}
	fakeHome := t.TempDir()
	installedPluginDir := filepath.Join(fakeHome, ".gemini", "config", "plugins", "speedgrapher")
	if err := os.MkdirAll(filepath.Join(installedPluginDir, "styles"), 0755); err != nil {
		t.Fatalf("failed to create installed plugin styles dir: %v", err)
	}
	installedIni := filepath.Join(installedPluginDir, ".vale.ini")
	if err := os.WriteFile(installedIni, []byte("StylesPath = styles\n"), 0644); err != nil {
		t.Fatalf("failed to write installed plugin .vale.ini: %v", err)
	}
	userHomeDirFunc = func() (string, error) {
		return fakeHome, nil
	}

	gotInstalled, err := setupValeConfig(t.TempDir())
	if err != nil {
		t.Fatalf("setupValeConfig(installed plugin) error: %v", err)
	}
	gotInstalledReal, _ := filepath.EvalSymlinks(gotInstalled)
	installedIniReal, _ := filepath.EvalSymlinks(installedIni)
	if gotInstalledReal != installedIniReal {
		t.Errorf("setupValeConfig(installed plugin) = %s, want %s", gotInstalled, installedIni)
	}

	// 4. Fail fast when no valid .vale.ini exists anywhere
	userHomeDirFunc = func() (string, error) {
		return t.TempDir(), nil
	}
	_, err = setupValeConfig(t.TempDir())
	if err == nil {
		t.Fatal("expected fail-fast error when no valid .vale.ini exists, got nil")
	}
	if !strings.Contains(err.Error(), "no valid .vale.ini with styles/ directory found") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func createFakeValeBinary(t *testing.T) string {
	t.Helper()
	tmpDir := t.TempDir()
	fakeVale := filepath.Join(tmpDir, "fake-vale")
	if runtime.GOOS == "windows" {
		fakeVale += ".bat"
		if err := os.WriteFile(fakeVale, []byte("@echo {\"stdin.md\": []}\n"), 0755); err != nil {
			t.Fatalf("failed to write fake vale binary: %v", err)
		}
	} else {
		script := "#!/bin/sh\necho '{\"stdin.md\": []}'\n"
		if err := os.WriteFile(fakeVale, []byte(script), 0755); err != nil {
			t.Fatalf("failed to write fake vale binary: %v", err)
		}
	}
	return fakeVale
}

func TestValeParams_Validation(t *testing.T) {
	fakeVale := createFakeValeBinary(t)

	wsDir := t.TempDir()
	iniPath := filepath.Join(wsDir, ".vale.ini")
	if err := os.WriteFile(iniPath, []byte("StylesPath = styles\n"), 0644); err != nil {
		t.Fatalf("failed to write .vale.ini: %v", err)
	}
	stylesDir := filepath.Join(wsDir, "styles")
	if err := os.MkdirAll(stylesDir, 0755); err != nil {
		t.Fatalf("failed to create styles dir: %v", err)
	}

	t.Run("empty text and empty path returns error", func(t *testing.T) {
		_, _, err := valeHandler(context.Background(), nil, ValeParams{}, Config{
			ValeBinPath:  fakeVale,
			WorkspaceDir: wsDir,
		})
		if err == nil {
			t.Fatal("expected error for empty text and path, got nil")
		}
		if !strings.Contains(err.Error(), "text or path") {
			t.Errorf("unexpected error message: %v", err)
		}
	})

	t.Run("non-existent path returns error", func(t *testing.T) {
		_, _, err := valeHandler(context.Background(), nil, ValeParams{
			Path: filepath.Join(wsDir, "non_existent_file.md"),
		}, Config{
			ValeBinPath:  fakeVale,
			WorkspaceDir: wsDir,
		})
		if err == nil {
			t.Fatal("expected error for non-existent file, got nil")
		}
		if !strings.Contains(err.Error(), "failed to read file") {
			t.Errorf("unexpected error message: %v", err)
		}
	})

	t.Run("valid text executes successfully", func(t *testing.T) {
		_, res, err := valeHandler(context.Background(), nil, ValeParams{
			Text: "# Hello World\nThis is test text.",
		}, Config{
			ValeBinPath:  fakeVale,
			WorkspaceDir: wsDir,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res == nil || res.Output == "" {
			t.Fatal("expected non-empty output")
		}
	})

	t.Run("valid relative path with WorkspaceDir executes successfully", func(t *testing.T) {
		docFile := filepath.Join(wsDir, "test_doc.md")
		if err := os.WriteFile(docFile, []byte("# Markdown Document\nTesting path resolution."), 0644); err != nil {
			t.Fatalf("failed to write test file: %v", err)
		}

		_, res, err := valeHandler(context.Background(), nil, ValeParams{
			Path: "test_doc.md",
		}, Config{
			ValeBinPath:  fakeVale,
			WorkspaceDir: wsDir,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res == nil || res.Output == "" {
			t.Fatal("expected non-empty output")
		}
	})

	t.Run("valid absolute path executes successfully", func(t *testing.T) {
		docFile := filepath.Join(wsDir, "test_abs_doc.md")
		if err := os.WriteFile(docFile, []byte("# Markdown Document\nTesting absolute path."), 0644); err != nil {
			t.Fatalf("failed to write test file: %v", err)
		}

		_, res, err := valeHandler(context.Background(), nil, ValeParams{
			Path: docFile,
		}, Config{
			ValeBinPath:  fakeVale,
			WorkspaceDir: wsDir,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res == nil || res.Output == "" {
			t.Fatal("expected non-empty output")
		}
	})

	if runtime.GOOS != "windows" {
		t.Run("vale runtime error fails fast with stderr", func(t *testing.T) {
			errVale := filepath.Join(t.TempDir(), "err-vale")
			script := "#!/bin/sh\necho 'E100: invalid config syntax' >&2\nexit 2\n"
			if err := os.WriteFile(errVale, []byte(script), 0755); err != nil {
				t.Fatalf("failed to write failing vale script: %v", err)
			}

			_, _, err := valeHandler(context.Background(), nil, ValeParams{
				Text: "# Hello World",
			}, Config{
				ValeBinPath:  errVale,
				WorkspaceDir: wsDir,
			})
			if err == nil {
				t.Fatal("expected error when vale exits non-zero, got nil")
			}
			if !strings.Contains(err.Error(), "vale execution failed") || !strings.Contains(err.Error(), "E100: invalid config syntax") {
				t.Errorf("expected stderr in error message, got: %v", err)
			}
		})
	}
}

func TestResolveValeBinary(t *testing.T) {
	tmpDir := t.TempDir()

	t.Run("custom valid binary", func(t *testing.T) {
		validBin := filepath.Join(tmpDir, "custom-vale")
		if runtime.GOOS == "windows" {
			validBin += ".bat"
			if err := os.WriteFile(validBin, []byte("@echo 3.13.1\n"), 0755); err != nil {
				t.Fatalf("failed to create custom binary: %v", err)
			}
		} else {
			if err := os.WriteFile(validBin, []byte("#!/bin/sh\nexit 0\n"), 0755); err != nil {
				t.Fatalf("failed to create custom binary: %v", err)
			}
		}

		got, err := resolveValeBinary(validBin)
		if err != nil {
			t.Fatalf("resolveValeBinary() error = %v", err)
		}
		if got != validBin {
			t.Errorf("resolveValeBinary() = %v, want %v", got, validBin)
		}
		if !filepath.IsAbs(got) {
			t.Errorf("resolveValeBinary() returned non-absolute path: %s", got)
		}
	})

	t.Run("custom non-existent binary", func(t *testing.T) {
		_, err := resolveValeBinary(filepath.Join(tmpDir, "non_existent_binary"))
		if err == nil {
			t.Fatal("expected error for non-existent binary, got nil")
		}
	})

	t.Run("custom binary is a directory", func(t *testing.T) {
		_, err := resolveValeBinary(tmpDir)
		if err == nil {
			t.Fatal("expected error when binary path is a directory, got nil")
		}
	})

	if runtime.GOOS != "windows" {
		t.Run("custom binary not executable", func(t *testing.T) {
			nonExec := filepath.Join(tmpDir, "non-executable-bin")
			if err := os.WriteFile(nonExec, []byte("data"), 0644); err != nil {
				t.Fatalf("failed to write non-exec file: %v", err)
			}
			_, err := resolveValeBinary(nonExec)
			if err == nil {
				t.Fatal("expected error when binary is not executable, got nil")
			}
		})
	}

	t.Run("resolves from PATH via lookPathFunc", func(t *testing.T) {
		origLookPath := lookPathFunc
		defer func() { lookPathFunc = origLookPath }()

		fakeBin := filepath.Join(tmpDir, "vale")
		lookPathFunc = func(file string) (string, error) {
			return fakeBin, nil
		}

		got, err := resolveValeBinary("")
		if err != nil {
			t.Fatalf("resolveValeBinary(\"\") error = %v", err)
		}
		if got != fakeBin {
			t.Errorf("resolveValeBinary(\"\") = %v, want %v", got, fakeBin)
		}
	})

	t.Run("fails fast when vale is missing from PATH", func(t *testing.T) {
		origLookPath := lookPathFunc
		defer func() { lookPathFunc = origLookPath }()

		lookPathFunc = func(file string) (string, error) {
			return "", os.ErrNotExist
		}

		_, err := resolveValeBinary("")
		if err == nil {
			t.Fatal("expected error when vale is not in PATH, got nil")
		}
		if !strings.Contains(err.Error(), "vale binary not found in PATH") {
			t.Errorf("unexpected error message: %v", err)
		}
	})
}

func TestRegister(t *testing.T) {
	server := mcp.NewServer(&mcp.Implementation{Name: "test-server"}, nil)
	Register(server)

	serverWithCfg := mcp.NewServer(&mcp.Implementation{Name: "test-server-cfg"}, nil)
	Register(serverWithCfg, Config{
		WorkspaceDir: "/tmp",
		ValeBinPath:  "/custom/vale",
	})
}

func TestManageRules(t *testing.T) {
	wsDir := t.TempDir()
	iniPath := filepath.Join(wsDir, ".vale.ini")
	initialIni := `StylesPath = styles
MinAlertLevel = suggestion
Vocab = Speedgrapher

[*.md]
BasedOnStyles = Vale, Google, proselint, write-good
`
	if err := os.WriteFile(iniPath, []byte(initialIni), 0644); err != nil {
		t.Fatalf("failed to write .vale.ini: %v", err)
	}

	googleDir := filepath.Join(wsDir, "styles", "Google")
	if err := os.MkdirAll(googleDir, 0755); err != nil {
		t.Fatalf("failed to create Google styles dir: %v", err)
	}
	weRule := `extends: existence
message: "Try to avoid using first-person plural like '%s'."
link: 'https://developers.google.com/style/pronouns#personal-pronouns'
level: warning
tokens:
  - we
`
	if err := os.WriteFile(filepath.Join(googleDir, "We.yml"), []byte(weRule), 0644); err != nil {
		t.Fatalf("failed to write We.yml: %v", err)
	}

	vocabDir := filepath.Join(wsDir, "styles", "config", "vocabularies", "Speedgrapher")
	if err := os.MkdirAll(vocabDir, 0755); err != nil {
		t.Fatalf("failed to create vocab dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(vocabDir, "accept.txt"), []byte("[Ss]peedgrapher\nAntigravity\n"), 0644); err != nil {
		t.Fatalf("failed to write accept.txt: %v", err)
	}

	cfg := Config{WorkspaceDir: wsDir}

	// 1. List rules and vocabulary
	state, err := ManageRules(ValeRuleActionParams{Action: "list"}, cfg)
	if err != nil {
		t.Fatalf("ManageRules(list) unexpected error: %v", err)
	}
	if len(state.VocabTerms) != 2 {
		t.Errorf("expected 2 initial vocab terms, got %v", state.VocabTerms)
	}
	foundWe := false
	foundSpelling := false
	for _, r := range state.Rules {
		if r.ID == "Google.We" {
			foundWe = true
			if !r.Enabled || r.EffectiveLevel != "warning" {
				t.Errorf("expected Google.We enabled at warning level, got %+v", r)
			}
		}
		if r.ID == "Vale.Spelling" {
			foundSpelling = true
		}
	}
	if !foundWe || !foundSpelling {
		t.Errorf("expected Google.We and Vale.Spelling in rules list, got %+v", state.Rules)
	}

	// 2. Disable Google.We via set_rule
	disable := false
	state, err = ManageRules(ValeRuleActionParams{
		Action:  "set_rule",
		RuleID:  "Google.We",
		Enabled: &disable,
	}, cfg)
	if err != nil {
		t.Fatalf("ManageRules(set_rule disable) unexpected error: %v", err)
	}
	for _, r := range state.Rules {
		if r.ID == "Google.We" && (r.Enabled || r.EffectiveLevel != "NO") {
			t.Errorf("expected Google.We to be disabled (NO), got %+v", r)
		}
	}

	// 3. Re-enable Google.We via set_rule
	enable := true
	state, err = ManageRules(ValeRuleActionParams{
		Action:  "set_rule",
		RuleID:  "Google.We",
		Enabled: &enable,
	}, cfg)
	if err != nil {
		t.Fatalf("ManageRules(set_rule enable) unexpected error: %v", err)
	}
	for _, r := range state.Rules {
		if r.ID == "Google.We" && (!r.Enabled || r.EffectiveLevel != "warning") {
			t.Errorf("expected Google.We to be re-enabled (warning), got %+v", r)
		}
	}

	// 4. Add vocabulary term with CaseInsensitive=true
	state, err = ManageRules(ValeRuleActionParams{
		Action:          "add_vocab",
		Term:            "Ebitengine",
		CaseInsensitive: true,
	}, cfg)
	if err != nil {
		t.Fatalf("ManageRules(add_vocab) unexpected error: %v", err)
	}
	if len(state.VocabTerms) != 3 || state.VocabTerms[2] != "[Ee]bitengine" {
		t.Errorf("expected [Ee]bitengine added to VocabTerms, got %v", state.VocabTerms)
	}

	// 5. Remove vocabulary term
	state, err = ManageRules(ValeRuleActionParams{
		Action: "remove_vocab",
		Term:   "Ebitengine",
	}, cfg)
	if err != nil {
		t.Fatalf("ManageRules(remove_vocab) unexpected error: %v", err)
	}
	if len(state.VocabTerms) != 2 {
		t.Errorf("expected Ebitengine removed from VocabTerms, got %v", state.VocabTerms)
	}

	// 5b. All-uppercase acronym with CaseInsensitive=true does NOT convert to [Ww]ASM
	state, err = ManageRules(ValeRuleActionParams{
		Action:          "add_vocab",
		Term:            "WASM",
		CaseInsensitive: true,
	}, cfg)
	if err != nil {
		t.Fatalf("ManageRules(add_vocab WASM) unexpected error: %v", err)
	}
	if len(state.VocabTerms) != 3 || state.VocabTerms[2] != "WASM" {
		t.Errorf("expected WASM preserved without [Ww]ASM conversion, got %v", state.VocabTerms)
	}

	// 6. Error cases fail fast
	if _, err := ManageRules(ValeRuleActionParams{Action: "set_rule", RuleID: "NonExistent.Rule", Enabled: &disable}, cfg); err == nil {
		t.Error("expected error for unknown rule_id, got nil")
	}
	if _, err := ManageRules(ValeRuleActionParams{Action: "add_vocab", Term: "   "}, cfg); err == nil {
		t.Error("expected error for empty term, got nil")
	}
	if _, err := ManageRules(ValeRuleActionParams{Action: "add_vocab", Term: "[unclosed-regex"}, cfg); err == nil {
		t.Error("expected error for invalid regex term, got nil")
	}
	if _, err := ManageRules(ValeRuleActionParams{Action: "add_vocab", Term: "line1\nline2"}, cfg); err == nil {
		t.Error("expected error for term containing newline, got nil")
	}
	if _, err := ManageRules(ValeRuleActionParams{Action: "unknown_action"}, cfg); err == nil {
		t.Error("expected error for unknown action, got nil")
	}

	// 7. Invalid Vocab name in .vale.ini fails fast against path traversal
	if err := os.WriteFile(iniPath, []byte("StylesPath = styles\nVocab = ../../escape\n"), 0644); err != nil {
		t.Fatalf("failed to write .vale.ini: %v", err)
	}
	if _, err := ManageRules(ValeRuleActionParams{Action: "list"}, cfg); err == nil {
		t.Error("expected error for path-traversal Vocab name, got nil")
	}
}

func TestManageRules_GlobalAndLocalHierarchy(t *testing.T) {
	fakeHome := t.TempDir()
	globalPluginDir := filepath.Join(fakeHome, ".gemini", "config", "plugins", "speedgrapher")
	if err := os.MkdirAll(filepath.Join(globalPluginDir, "styles", "Google"), 0755); err != nil {
		t.Fatalf("failed to create global styles dir: %v", err)
	}
	weRule := `extends: existence
message: "Try to avoid using first-person plural like '%s'."
level: warning
tokens:
  - we
`
	if err := os.WriteFile(filepath.Join(globalPluginDir, "styles", "Google", "We.yml"), []byte(weRule), 0644); err != nil {
		t.Fatalf("failed to write global We.yml: %v", err)
	}
	globalVocabDir := filepath.Join(globalPluginDir, "styles", "config", "vocabularies", "Speedgrapher")
	if err := os.MkdirAll(globalVocabDir, 0755); err != nil {
		t.Fatalf("failed to create global vocab dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(globalVocabDir, "accept.txt"), []byte("GlobalTerm\n"), 0644); err != nil {
		t.Fatalf("failed to write global accept.txt: %v", err)
	}
	globalIni := "StylesPath = styles\nMinAlertLevel = suggestion\nVocab = Speedgrapher\n\n[*.md]\nBasedOnStyles = Vale, Google, proselint, write-good\nGoogle.We = NO\n"
	if err := os.WriteFile(filepath.Join(globalPluginDir, ".vale.ini"), []byte(globalIni), 0644); err != nil {
		t.Fatalf("failed to write global .vale.ini: %v", err)
	}

	localWs := t.TempDir()
	if err := os.MkdirAll(filepath.Join(localWs, "styles", "Google"), 0755); err != nil {
		t.Fatalf("failed to create local styles dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(localWs, "styles", "Google", "We.yml"), []byte(weRule), 0644); err != nil {
		t.Fatalf("failed to write local We.yml: %v", err)
	}
	localVocabDir := filepath.Join(localWs, "styles", "config", "vocabularies", "Speedgrapher")
	if err := os.MkdirAll(localVocabDir, 0755); err != nil {
		t.Fatalf("failed to create local vocab dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(localVocabDir, "accept.txt"), []byte("LocalTerm\n"), 0644); err != nil {
		t.Fatalf("failed to write local accept.txt: %v", err)
	}
	localIni := "StylesPath = styles\nMinAlertLevel = suggestion\nVocab = Speedgrapher\n\n[*.md]\nBasedOnStyles = Vale, Google, proselint, write-good\n"
	if err := os.WriteFile(filepath.Join(localWs, ".vale.ini"), []byte(localIni), 0644); err != nil {
		t.Fatalf("failed to write local .vale.ini: %v", err)
	}

	origExe := executablePathFunc
	origHome := userHomeDirFunc
	defer func() {
		executablePathFunc = origExe
		userHomeDirFunc = origHome
	}()
	executablePathFunc = func() (string, error) { return "", os.ErrNotExist }
	userHomeDirFunc = func() (string, error) { return fakeHome, nil }

	cfg := Config{WorkspaceDir: localWs}

	// 1. Local inherits Google.We = NO from global
	state, err := ManageRules(ValeRuleActionParams{Action: "list", Scope: "local"}, cfg)
	if err != nil {
		t.Fatalf("ManageRules(list) error: %v", err)
	}
	if !state.HasLocalConfig {
		t.Fatal("expected HasLocalConfig = true")
	}
	if len(state.MergedVocabTerms) != 2 {
		t.Errorf("expected 2 merged vocab terms (GlobalTerm + LocalTerm), got %v", state.MergedVocabTerms)
	}
	for _, r := range state.Rules {
		if r.ID == "Google.We" {
			if r.Enabled || r.ScopeSource != "global" {
				t.Errorf("expected Google.We inherited as disabled from global, got %+v", r)
			}
		}
	}

	// 2. Local override enables Google.We for this project while global remains disabled
	enable := true
	state, err = ManageRules(ValeRuleActionParams{
		Action:  "set_rule",
		Scope:   "local",
		RuleID:  "Google.We",
		Enabled: &enable,
	}, cfg)
	if err != nil {
		t.Fatalf("ManageRules(set_rule local enable) error: %v", err)
	}
	for _, r := range state.Rules {
		if r.ID == "Google.We" {
			if !r.Enabled || r.ScopeSource != "local" || r.GlobalEnabled {
				t.Errorf("expected Google.We locally enabled while globally disabled, got %+v", r)
			}
		}
	}

	// 3. Resetting local override restores inheritance from global
	state, err = ManageRules(ValeRuleActionParams{
		Action: "reset_rule",
		Scope:  "local",
		RuleID: "Google.We",
	}, cfg)
	if err != nil {
		t.Fatalf("ManageRules(reset_rule) error: %v", err)
	}
	for _, r := range state.Rules {
		if r.ID == "Google.We" {
			if r.Enabled || r.ScopeSource != "global" {
				t.Errorf("expected Google.We reset to inherit global disabled state, got %+v", r)
			}
		}
	}
}

func TestMaskHugoShortcodesForVale(t *testing.T) {
	input := `In the [previous article]({{< ref "/posts/20261006-building-agentic-backends-with-genkit-go" >}}), we built a Go agent. Also see {{< youtube "dQw4w9WgXcQ" >}} here.`
	masked := maskHugoShortcodesForVale(input)

	if len(masked) != len(input) {
		t.Fatalf("expected masked length %d to equal input length %d", len(masked), len(input))
	}
	if strings.Contains(masked, "{{") || strings.Contains(masked, "}}") {
		t.Errorf("expected all Hugo shortcodes to be masked, got %q", masked)
	}
	if !strings.Contains(masked, "[previous article](") {
		t.Errorf("expected link label to be preserved for Vale Markdown parsing, got %q", masked)
	}
	suffix := ", we built a Go agent. Also see "
	if strings.Index(masked, suffix) != strings.Index(input, suffix) {
		t.Errorf("expected byte offset of suffix after Hugo link to be preserved: got %d, want %d",
			strings.Index(masked, suffix), strings.Index(input, suffix))
	}
}
