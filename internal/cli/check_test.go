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
	"strings"
	"testing"
)

type mockCheckRunner struct {
	paths    map[string]string
	outputs  map[string][]byte
	cmdError error
}

func (m *mockCheckRunner) LookPath(file string) (string, error) {
	if p, ok := m.paths[file]; ok {
		return p, nil
	}
	return "", errors.New("executable file not found in $PATH")
}

func (m *mockCheckRunner) RunCommand(_ context.Context, name string, _ ...string) ([]byte, error) {
	if m.cmdError != nil {
		return nil, m.cmdError
	}
	if out, ok := m.outputs[name]; ok {
		return out, nil
	}
	return []byte(""), nil
}

func TestParseVersion(t *testing.T) {
	tests := []struct {
		input      string
		wantMajor  int
		wantMinor  int
		wantPatch  int
		wantPre    string
		wantDevel  bool
	}{
		{"v3.9.1", 3, 9, 1, "", false},
		{"3.9.1", 3, 9, 1, "", false},
		{"go1.26.3", 1, 26, 3, "", false},
		{"v0.146.0-beta", 0, 146, 0, "beta", false},
		{"devel", 0, 0, 0, "", true},
		{"(devel)", 0, 0, 0, "", true},
		{"devel (abc1234)", 0, 0, 0, "", true},
		{"", 0, 0, 0, "", false},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			v := ParseVersion(tc.input)
			if v.Major != tc.wantMajor || v.Minor != tc.wantMinor || v.Patch != tc.wantPatch || v.Prerelease != tc.wantPre || v.IsDevel != tc.wantDevel {
				t.Errorf("ParseVersion(%q) = %+v, want M=%d m=%d p=%d pre=%s devel=%v",
					tc.input, v, tc.wantMajor, tc.wantMinor, tc.wantPatch, tc.wantPre, tc.wantDevel)
			}
		})
	}
}

func TestVersionCompareAndSatisfies(t *testing.T) {
	v1 := ParseVersion("v1.24.0")
	v2 := ParseVersion("v1.26.3")
	v3 := ParseVersion("v1.24.0")

	if v1.Compare(v2) >= 0 {
		t.Errorf("expected v1.24.0 < v1.26.3")
	}
	if v2.Compare(v1) <= 0 {
		t.Errorf("expected v1.26.3 > v1.24.0")
	}
	if v1.Compare(v3) != 0 {
		t.Errorf("expected v1.24.0 == v1.24.0")
	}

	// Satisfies tests
	if !Satisfies(v2, ">=1.24.0") {
		t.Errorf("expected 1.26.3 to satisfy >=1.24.0")
	}
	if Satisfies(v1, ">1.24.0") {
		t.Errorf("expected 1.24.0 to NOT satisfy >1.24.0")
	}
	if !Satisfies(v1, "<=1.24.0") {
		t.Errorf("expected 1.24.0 to satisfy <=1.24.0")
	}
	if !Satisfies(v1, "=1.24.0") {
		t.Errorf("expected 1.24.0 to satisfy =1.24.0")
	}
	if !Satisfies(v2, "latest") {
		t.Errorf("expected 1.26.3 to satisfy latest")
	}
	if !Satisfies(ParseVersion("devel"), ">=1.24.0") {
		t.Errorf("expected devel to satisfy constraint")
	}
}

func TestExtractVersion(t *testing.T) {
	tests := []struct {
		text string
		want string
	}{
		{"vale version 3.9.1", "3.9.1"},
		{"git version 2.39.5 (Apple Git-154)", "2.39.5"},
		{"hugo v0.146.0+extended darwin/arm64", "0.146.0"},
		{"go version go1.26.3 darwin/arm64", "1.26.3"},
	}

	for _, tc := range tests {
		t.Run(tc.text, func(t *testing.T) {
			got := ExtractVersion(tc.text, genericSemverRe)
			if got != tc.want {
				t.Errorf("ExtractVersion(%q) = %q, want %q", tc.text, got, tc.want)
			}
		})
	}
}

func TestChecker_CheckAll_WithMock(t *testing.T) {
	runner := &mockCheckRunner{
		paths: map[string]string{
			"vale": "/usr/local/bin/vale",
			"git":  "/usr/bin/git",
			"go":   "/usr/local/go/bin/go",
		},
		outputs: map[string][]byte{
			"/usr/local/bin/vale":   []byte("vale version 3.9.1"),
			"/usr/bin/git":          []byte("git version 2.39.5"),
			"/usr/local/go/bin/go":  []byte("go version go1.26.3 darwin/arm64"),
		},
	}

	checker := NewChecker(runner)
	statuses, err := checker.CheckAll(context.Background())
	if err != nil {
		t.Fatalf("CheckAll failed: %v", err)
	}

	if len(statuses) != 4 {
		t.Fatalf("expected 4 tool statuses, got %d", len(statuses))
	}

	statusMap := make(map[string]ToolStatus)
	for _, st := range statuses {
		statusMap[st.ID] = st
	}

	if statusMap["vale"].Status != StatusOk {
		t.Errorf("expected vale to be OK, got %s", statusMap["vale"].Status)
	}
	if statusMap["git"].Status != StatusOk {
		t.Errorf("expected git to be OK, got %s", statusMap["git"].Status)
	}
	if statusMap["go"].Status != StatusOk {
		t.Errorf("expected go to be OK, got %s", statusMap["go"].Status)
	}
	if statusMap["hugo"].Status != StatusMissing {
		t.Errorf("expected hugo to be MISSING, got %s", statusMap["hugo"].Status)
	}
}

func TestFormatStatusTable(t *testing.T) {
	statuses := []ToolStatus{
		{
			ID:                 "vale",
			DisplayName:        "Vale Linter",
			Status:             StatusOk,
			InstalledVersion:   "3.9.1",
			RecommendedVersion: "latest",
			UpgradeCommand:     "",
		},
		{
			ID:                 "hugo",
			DisplayName:        "Hugo SSG",
			Status:             StatusMissing,
			InstalledVersion:   "",
			RecommendedVersion: "latest",
			UpgradeCommand:     "brew install hugo",
		},
		{
			ID:                 "git",
			DisplayName:        "Git VCS",
			Status:             StatusOutdated,
			InstalledVersion:   "2.20.0",
			RecommendedVersion: ">=2.30.0",
			UpgradeCommand:     "brew upgrade git",
		},
	}

	table := FormatStatusTable(statuses)
	if !strings.Contains(table, "Speedgrapher Environment & Tool Diagnostic Check") {
		t.Errorf("expected table header in output")
	}
	if !strings.Contains(table, "✓ OK") {
		t.Errorf("expected OK badge in output")
	}
	if !strings.Contains(table, "✗ MISSING") {
		t.Errorf("expected MISSING badge in output")
	}
	if !strings.Contains(table, "⚠️ OUTDATED") {
		t.Errorf("expected OUTDATED badge in output")
	}
	if !strings.Contains(table, "Summary: 1/3 tools healthy, 1 outdated, 1 missing.") {
		t.Errorf("expected summary line in output, got:\n%s", table)
	}
}

func TestOutputCheckResults_JSON(t *testing.T) {
	statuses := []ToolStatus{
		{
			ID:                 "vale",
			DisplayName:        "Vale Linter",
			Status:             StatusOk,
			InstalledVersion:   "3.9.1",
			RecommendedVersion: "latest",
		},
	}

	var buf bytes.Buffer
	err := outputCheckResults(&buf, statuses, true)
	if err != nil {
		t.Fatalf("outputCheckResults failed: %v", err)
	}

	var parsed []ToolStatus
	if err := json.Unmarshal(buf.Bytes(), &parsed); err != nil {
		t.Fatalf("failed to parse JSON output: %v", err)
	}

	if len(parsed) != 1 || parsed[0].ID != "vale" {
		t.Errorf("unexpected parsed JSON: %+v", parsed)
	}
}
