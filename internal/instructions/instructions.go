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

// Package instructions provides dynamic system instructions for the Speedgrapher MCP server.
package instructions

import (
	"strings"
)

// MultiRootInstructions defines the multi-root absolute path requirements.
const MultiRootInstructions = `## Multi-Root Workspace & Path Requirements
- In multi-root workspaces or distributed environments, all file paths MUST be absolute paths.
- Do not assume a single working directory or rely on relative file paths.
- Always resolve and validate absolute paths before passing them to tools or accessing workspace guidelines and configuration files.`

// ToolsInstructions describes all tools exposed by the Speedgrapher MCP server.
const ToolsInstructions = `## Available Tools
1. **fog**: Calculates the Gunning Fog Index to estimate readability of English text. Returns readability index, total words, sentence count, average sentence length, complex word count/percentage, and readability classification (Simplistic, General Audiences, Professional Audiences, Hard to Read, Unreadable).
2. **slop**: Analyzes text for AI clichés, buzzwords, and stylistic patterns using 5 weighted metrics: Lexical Slop, Filler Words, Structural Clichés, Rhythm Variance, and Syntactic Voice. Produces an overall slop score from 0 (human) to 100 (heavy AI clichés).
3. **analyze_seo**: Performs technical SEO audits on URLs or raw HTML (including Hugo Markdown with front matter). Validates title tag, meta description, H1 heading structure, image alt text, links, word count, and canonical tags.
4. **vale**: Executes Vale static analysis for style, prose, and grammar against project-specific (.vale.ini) or bundled guidelines.`

// PromptsInstructions describes interactive prompts / slash commands.
const PromptsInstructions = `## Interactive Prompts
1. **/interview**: Conducts a structured open-focused-closed interview to uncover technical struggles, error logs, and breakthroughs, producing an outline and transcript.
2. **/review**: Audits draft articles against editorial guidelines using objective analytical tools ('fog', 'slop', 'vale').
3. **/readability**: Assesses the readability of the most recent text block using the Gunning Fog Index.
4. **/tropes**: Provides guidelines and reference patterns to avoid common AI writing clichés and buzzwords.`

// PersonasInstructions describes the specialized editorial personas.
const PersonasInstructions = `## Editorial Personas
1. **tech-interviewer**: Inquisitive peer interviewer who asks targeted questions to extract raw artifacts, error logs, code samples, and lessons learned.
2. **tech-writer**: Collaborative drafting partner focusing on clear, conversational, and human technical prose following cozy web principles.
3. **tech-reviewer**: Analytical editor auditing drafts for style, tone, readability, and AI slop using automated analysis tools.
4. **tech-publisher**: Publication gatekeeper auditing technical SEO, handling localization guidelines, and executing final pre-publish checks.`

// SystemInstructions is the combined default system instructions string for the Speedgrapher MCP server.
const SystemInstructions = `# Speedgrapher MCP Server Instructions

Speedgrapher is an MCP server providing editorial assistance, readability analysis, AI slop detection, technical SEO auditing, and style linting for technical content creators.

` + MultiRootInstructions + `

` + ToolsInstructions + `

` + PromptsInstructions + `

` + PersonasInstructions

// GetInstructions returns the complete system instructions for the Speedgrapher MCP server.
func GetInstructions() string {
	return SystemInstructions
}

// Instructions is a convenience alias for GetInstructions.
func Instructions() string {
	return GetInstructions()
}

// GetMultiRootInstructions returns the multi-root workspace path instructions.
func GetMultiRootInstructions() string {
	return MultiRootInstructions
}

// GetToolsInstructions returns the tools section of the instructions.
func GetToolsInstructions() string {
	return ToolsInstructions
}

// GetPromptsInstructions returns the prompts section of the instructions.
func GetPromptsInstructions() string {
	return PromptsInstructions
}

// GetPersonasInstructions returns the personas section of the instructions.
func GetPersonasInstructions() string {
	return PersonasInstructions
}

// FormatCustomInstructions formats dynamic system instructions with custom preamble or appendable notes.
func FormatCustomInstructions(preamble string, customSections ...string) string {
	var parts []string
	if strings.TrimSpace(preamble) != "" {
		parts = append(parts, strings.TrimSpace(preamble))
	}
	parts = append(parts, SystemInstructions)
	for _, sec := range customSections {
		if strings.TrimSpace(sec) != "" {
			parts = append(parts, strings.TrimSpace(sec))
		}
	}
	return strings.Join(parts, "\n\n")
}
