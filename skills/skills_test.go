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

package skills

import (
	"bytes"
	"io/fs"
	"path"
	"strings"
	"testing"
)

func TestEmbeddedSkills(t *testing.T) {
	expectedSkills := []string{
		"deslopify",
		"inverted-pyramid",
		"tech-interviewer",
		"tech-publisher",
		"tech-reviewer",
		"tech-writer",
	}

	for _, skillName := range expectedSkills {
		t.Run(skillName, func(t *testing.T) {
			skillFile := path.Join(skillName, "SKILL.md")
			data, err := FS.ReadFile(skillFile)
			if err != nil {
				t.Fatalf("failed to read embedded file %s: %v", skillFile, err)
			}
			if len(data) == 0 {
				t.Fatalf("embedded file %s is empty", skillFile)
			}

			// Verify frontmatter contains skill name
			if !bytes.Contains(data, []byte("name: "+skillName)) {
				t.Errorf("expected %s to contain frontmatter with name: %s", skillFile, skillName)
			}
		})
	}
}

func TestEmbeddedTropesReference(t *testing.T) {
	tropesPath := "deslopify/references/tropes.md"
	data, err := FS.ReadFile(tropesPath)
	if err != nil {
		t.Fatalf("failed to read %s: %v", tropesPath, err)
	}
	if len(data) == 0 {
		t.Fatalf("%s is empty", tropesPath)
	}
	if !strings.Contains(string(data), "AI Writing Tropes to Avoid") {
		t.Errorf("expected tropes.md to contain header 'AI Writing Tropes to Avoid'")
	}
}

func TestGetSkill(t *testing.T) {
	for _, name := range SkillNames {
		data, err := GetSkill(name)
		if err != nil {
			t.Errorf("GetSkill(%q) returned error: %v", name, err)
		}
		if len(data) == 0 {
			t.Errorf("GetSkill(%q) returned empty content", name)
		}
	}

	// Test non-existent skill
	_, err := GetSkill("non-existent-skill")
	if err == nil {
		t.Error("expected error for non-existent skill, got nil")
	}
}

func TestGetFile(t *testing.T) {
	data, err := GetFile("deslopify/references/tropes.md")
	if err != nil {
		t.Fatalf("GetFile failed for tropes.md: %v", err)
	}
	if len(data) == 0 {
		t.Fatal("GetFile returned empty data for tropes.md")
	}

	_, err = GetFile("non/existent/file.md")
	if err == nil {
		t.Error("expected error for non-existent file, got nil")
	}
}

func TestListSkills(t *testing.T) {
	skills := ListSkills()
	if len(skills) != 6 {
		t.Fatalf("expected 6 skills, got %d: %v", len(skills), skills)
	}

	// Verify mutating returned slice does not affect SkillNames
	skills[0] = "mutated"
	if SkillNames[0] == "mutated" {
		t.Errorf("ListSkills did not return a separate copy of SkillNames")
	}
}

func TestWalkEmbeddedFS(t *testing.T) {
	var filesFound []string
	err := fs.WalkDir(FS, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			filesFound = append(filesFound, p)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("fs.WalkDir failed: %v", err)
	}

	if len(filesFound) < 7 {
		t.Errorf("expected at least 7 files (6 SKILL.md + tropes.md), found: %v", filesFound)
	}
}
