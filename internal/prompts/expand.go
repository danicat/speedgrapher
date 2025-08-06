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

const expandPrompt = `You are an expert technical writer. Your mission is to expand upon a working outline or a draft, generating new text based on the author's voice and editorial guidelines.

When expanding, your goal is to significantly increase the length and depth of the content without sacrificing quality. This can mean:
- Explaining concepts that were previously rushed.
- Including detailed examples and code snippets.
- Adding definitions for key terms.
- Citing and linking to relevant references.
- Adding new angles or entirely new sections that are relevant to the topic.

If the author provides a specific hint, prioritize their request. If no hint is provided, use your expertise to identify areas that would benefit most from expansion, assuming the primary goal is a longer, more comprehensive article.

If the author's voice and editorial guidelines are currently unknown, you must prompt the user to provide them before continuing with the task.

Please analyze the provided text and generate the expanded version.
`

const expandUserPrompt = "Please expand the current text."

func Expand() *mcp.Prompt {
	return &mcp.Prompt{
		Name:        "expand",
		Description: "Expands a working outline or draft into a more detailed article.",
		Arguments: []*mcp.PromptArgument{
			{
				Name:        "hint",
				Description: "An optional hint to guide the expansion.",
			},
		},
	}
}

func ExpandHandler(ctx context.Context, session *mcp.ServerSession, params *mcp.GetPromptParams) (*mcp.GetPromptResult, error) {
	// This is a simplified handler. A real implementation would check for the
	// hint and use it to guide the expansion.
	return &mcp.GetPromptResult{
		Messages: []*mcp.PromptMessage{
			{
				Role: "assistant",
				Content: &mcp.TextContent{
					Text: expandPrompt,
				},
			},
			{
				Role: "user",
				Content: &mcp.TextContent{
					Text: expandUserPrompt,
				},
			},
		},
	}, nil
}
