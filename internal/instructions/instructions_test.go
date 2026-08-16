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

package instructions_test

import (
	"strings"
	"testing"

	"github.com/danicat/speedgrapher/internal/instructions"
)

func TestGetInstructions(t *testing.T) {
	instr := instructions.GetInstructions()

	if instr == "" {
		t.Fatal("expected non-empty system instructions")
	}

	// Verify alias Instructions() returns identical output
	if instructions.Instructions() != instr {
		t.Errorf("Instructions() alias returned different text than GetInstructions()")
	}

	// Verify multi-root absolute path requirements
	expectedMultiRootPhrases := []string{
		"Multi-Root",
		"absolute path",
	}
	for _, phrase := range expectedMultiRootPhrases {
		if !strings.Contains(strings.ToLower(instr), strings.ToLower(phrase)) {
			t.Errorf("expected instructions to contain multi-root requirement %q", phrase)
		}
	}

	// Verify all tools are documented
	expectedTools := []string{
		"fog",
		"slop",
		"analyze_seo",
		"vale",
	}
	for _, tool := range expectedTools {
		if !strings.Contains(instr, tool) {
			t.Errorf("expected instructions to document tool %q", tool)
		}
	}

	// Verify all prompts are documented
	expectedPrompts := []string{
		"/interview",
		"/review",
		"/readability",
		"/tropes",
	}
	for _, prompt := range expectedPrompts {
		if !strings.Contains(instr, prompt) {
			t.Errorf("expected instructions to document prompt %q", prompt)
		}
	}

	// Verify all personas are documented
	expectedPersonas := []string{
		"tech-interviewer",
		"tech-writer",
		"tech-reviewer",
		"tech-publisher",
	}
	for _, persona := range expectedPersonas {
		if !strings.Contains(instr, persona) {
			t.Errorf("expected instructions to document persona %q", persona)
		}
	}
}

func TestSectionGetters(t *testing.T) {
	multiRoot := instructions.GetMultiRootInstructions()
	if !strings.Contains(multiRoot, "Multi-Root") || !strings.Contains(multiRoot, "absolute") {
		t.Errorf("unexpected GetMultiRootInstructions output: %s", multiRoot)
	}

	tools := instructions.GetToolsInstructions()
	for _, tool := range []string{"fog", "slop", "analyze_seo", "vale"} {
		if !strings.Contains(tools, tool) {
			t.Errorf("GetToolsInstructions missing tool %q", tool)
		}
	}

	prompts := instructions.GetPromptsInstructions()
	for _, prompt := range []string{"/interview", "/review", "/readability", "/tropes"} {
		if !strings.Contains(prompts, prompt) {
			t.Errorf("GetPromptsInstructions missing prompt %q", prompt)
		}
	}

	personas := instructions.GetPersonasInstructions()
	for _, persona := range []string{"tech-interviewer", "tech-writer", "tech-reviewer", "tech-publisher"} {
		if !strings.Contains(personas, persona) {
			t.Errorf("GetPersonasInstructions missing persona %q", persona)
		}
	}
}

func TestFormatCustomInstructions(t *testing.T) {
	preamble := "Custom Preamble for Team A"
	customSection := "Additional Section: Security Rules"

	res := instructions.FormatCustomInstructions(preamble, customSection)

	if !strings.HasPrefix(res, preamble) {
		t.Errorf("expected output to start with preamble")
	}
	if !strings.Contains(res, instructions.SystemInstructions) {
		t.Errorf("expected output to contain default system instructions")
	}
	if !strings.HasSuffix(res, customSection) {
		t.Errorf("expected output to end with custom section")
	}

	// Test with empty preamble and empty custom section
	resEmpty := instructions.FormatCustomInstructions("", "")
	if resEmpty != instructions.SystemInstructions {
		t.Errorf("expected FormatCustomInstructions with empty args to equal SystemInstructions")
	}
}
