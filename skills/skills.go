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
	"embed"
	"fmt"
	"path"
)

// FS contains the embedded skill definitions and reference materials.
//
//go:embed deslopify inverted-pyramid tech-interviewer tech-publisher tech-reviewer tech-writer
var FS embed.FS

// SkillNames lists all canonical skills embedded in this package.
var SkillNames = []string{
	"deslopify",
	"inverted-pyramid",
	"tech-interviewer",
	"tech-publisher",
	"tech-reviewer",
	"tech-writer",
}

// GetSkill reads the primary SKILL.md for the requested skill name.
func GetSkill(name string) ([]byte, error) {
	skillPath := path.Join(name, "SKILL.md")
	data, err := FS.ReadFile(skillPath)
	if err != nil {
		return nil, fmt.Errorf("read skill %s: %w", name, err)
	}
	return data, nil
}

// GetFile reads any embedded file from the skills filesystem.
func GetFile(filePath string) ([]byte, error) {
	data, err := FS.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("read skill file %s: %w", filePath, err)
	}
	return data, nil
}

// ListSkills returns a copy of the list of embedded skill names.
func ListSkills() []string {
	names := make([]string, len(SkillNames))
	copy(names, SkillNames)
	return names
}
