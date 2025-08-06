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

package prompts

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const outlinePrompt = `You are an expert technical writer. Your mission is to generate a structured outline of the current draft, concept, or interview report.

The outline should contain a title, section titles, and bullet points covering all topics in each section. The bullet points should be concise, precise, and direct. The author's voice will be applied at a different step.

Please analyze the provided text and generate the outline.
`

const outlineUserPrompt = "Please generate an outline for the current text."

func Outline() *mcp.Prompt {
	return &mcp.Prompt{
		Name:        "outline",
		Description: "Generates a structured outline of the current draft, concept or interview report.",
	}
}

func OutlineHandler(ctx context.Context, session *mcp.ServerSession, params *mcp.GetPromptParams) (*mcp.GetPromptResult, error) {
	return &mcp.GetPromptResult{
		Messages: []*mcp.PromptMessage{
			{
				Role: "assistant",
				Content: &mcp.TextContent{
					Text: outlinePrompt,
				},
			},
			{
				Role: "user",
				Content: &mcp.TextContent{
					Text: outlineUserPrompt,
				},
			},
		},
	}, nil
}
