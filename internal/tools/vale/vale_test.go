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
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestFindBundledValeConfig(t *testing.T) {
	// Create temporary directory structure:
	// tmp/
	//   .vale.ini
	//   bin/
	//     sub/
	//       deep/
	tmpDir := t.TempDir()

	iniPath := filepath.Join(tmpDir, ".vale.ini")
	if err := os.WriteFile(iniPath, []byte("StylesPath = styles\n"), 0644); err != nil {
		t.Fatalf("failed to write test .vale.ini: %v", err)
	}

	binDir := filepath.Join(tmpDir, "bin")
	subDir := filepath.Join(binDir, "sub")
	deepDir := filepath.Join(subDir, "deep")
	if err := os.MkdirAll(deepDir, 0755); err != nil {
		t.Fatalf("failed to create test dirs: %v", err)
	}

	tests := []struct {
		name    string
		exeDir  string
		want    string
		wantErr bool
	}{
		{
			name:    "config in same directory",
			exeDir:  tmpDir,
			want:    iniPath,
			wantErr: false,
		},
		{
			name:    "config in parent directory (e.g. bin/)",
			exeDir:  binDir,
			want:    iniPath,
			wantErr: false,
		},
		{
			name:    "config in ancestor directory (e.g. bin/sub/)",
			exeDir:  subDir,
			want:    iniPath,
			wantErr: false,
		},
		{
			name:    "config in deep ancestor directory (e.g. bin/sub/deep/)",
			exeDir:  deepDir,
			want:    iniPath,
			wantErr: false,
		},
		{
			name:    "config missing in empty directory tree",
			exeDir:  t.TempDir(),
			want:    "",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := findBundledValeConfig(tt.exeDir)
			if (err != nil) != tt.wantErr {
				t.Fatalf("findBundledValeConfig() error = %v, wantErr %v", err, tt.wantErr)
			}
			if got != tt.want {
				t.Errorf("findBundledValeConfig() = %v, want %v", got, tt.want)
			}
			if got != "" && !filepath.IsAbs(got) {
				t.Errorf("findBundledValeConfig() returned non-absolute path: %s", got)
			}
		})
	}
}

func TestSetupValeConfig_WorkspaceDir(t *testing.T) {
	// Test resolving .vale.ini from configured WorkspaceDir
	wsDir := t.TempDir()
	iniPath := filepath.Join(wsDir, ".vale.ini")
	if err := os.WriteFile(iniPath, []byte("StylesPath = styles\n"), 0644); err != nil {
		t.Fatalf("failed to write .vale.ini: %v", err)
	}
	stylesDir := filepath.Join(wsDir, "styles")
	if err := os.MkdirAll(stylesDir, 0755); err != nil {
		t.Fatalf("failed to create styles dir: %v", err)
	}

	got, err := setupValeConfig("fake-vale", wsDir)
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

func TestSetupValeConfig_Fallback(t *testing.T) {
	// Test fallback to cwd when WorkspaceDir has no .vale.ini
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

	// 1. WorkspaceDir is empty, should fall back to cwd
	got, err := setupValeConfig("fake-vale", "")
	if err != nil {
		t.Fatalf("setupValeConfig(\"\") error: %v", err)
	}
	if !filepath.IsAbs(got) {
		t.Errorf("setupValeConfig(\"\") returned non-absolute path: %s", got)
	}
	gotReal, _ := filepath.EvalSymlinks(got)
	cwdIniReal, _ := filepath.EvalSymlinks(cwdIni)
	if gotReal != cwdIniReal {
		t.Errorf("setupValeConfig(\"\") = %s, want %s", got, cwdIni)
	}

	// 2. WorkspaceDir is provided but has no .vale.ini, should fall back to cwd
	emptyWs := t.TempDir()
	gotWs, err := setupValeConfig("fake-vale", emptyWs)
	if err != nil {
		t.Fatalf("setupValeConfig(emptyWs) error: %v", err)
	}
	if !filepath.IsAbs(gotWs) {
		t.Errorf("setupValeConfig(emptyWs) returned non-absolute path: %s", gotWs)
	}
	gotWsReal, _ := filepath.EvalSymlinks(gotWs)
	if gotWsReal != cwdIniReal {
		t.Errorf("setupValeConfig(emptyWs) = %s, want %s", gotWs, cwdIni)
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
		script := "#!/bin/sh\nif [ \"$1\" = \"sync\" ]; then\n  exit 0\nfi\necho '{\"stdin.md\": []}'\n"
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
}

func TestBootstrapVale_CustomBin(t *testing.T) {
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

		got, err := bootstrapVale(validBin)
		if err != nil {
			t.Fatalf("bootstrapVale() error = %v", err)
		}
		if got != validBin {
			t.Errorf("bootstrapVale() = %v, want %v", got, validBin)
		}
		if !filepath.IsAbs(got) {
			t.Errorf("bootstrapVale() returned non-absolute path: %s", got)
		}
	})

	t.Run("custom non-existent binary", func(t *testing.T) {
		_, err := bootstrapVale(filepath.Join(tmpDir, "non_existent_binary"))
		if err == nil {
			t.Fatal("expected error for non-existent binary, got nil")
		}
	})

	t.Run("custom binary is a directory", func(t *testing.T) {
		_, err := bootstrapVale(tmpDir)
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
			_, err := bootstrapVale(nonExec)
			if err == nil {
				t.Fatal("expected error when binary is not executable, got nil")
			}
		})
	}
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
