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

const publishPrompt = `You are an expert technical editor. Your mission is to publish the final version of an article.

The current version of the article is now considered final and accepted for publishing. You must now initiate the publishing process.

To do this, you must first determine the correct publishing workflow for this project.
1.  **Inspect the README:** Look for a "Publishing" or "Deployment" section in the project's README file for specific instructions.
2.  **Ask the Author:** If the process is not documented in the README, you must ask the author for instructions on how to publish the article.

As a general guideline for tech blogs, the publishing process often involves:
- Inspecting the project directory for changed files.
- Preparing a commit with a descriptive message.
- Pushing the commit to the remote repository.

Please proceed with publishing the article.
`

const publishUserPrompt = "The current article is ready to be published."

func Publish() *mcp.Prompt {
	return &mcp.Prompt{
		Name:        "publish",
		Description: "Publishes the final version of the article.",
	}
}

func PublishHandler(ctx context.Context, session *mcp.ServerSession, params *mcp.GetPromptParams) (*mcp.GetPromptResult, error) {
	return &mcp.GetPromptResult{
		Messages: []*mcp.PromptMessage{
			{
				Role: "assistant",
				Content: &mcp.TextContent{
					Text: publishPrompt,
				},
			},
			{
				Role: "user",
				Content: &mcp.TextContent{
					Text: publishUserPrompt,
				},
			},
		},
	}, nil
}
