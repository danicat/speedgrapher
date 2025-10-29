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

const publishPrompt = `You are an expert technical editor. Your mission is to facilitate the publishing of the final version of an article.

The current version of the article is now considered final and accepted for publishing.

**Your Task:**
1.  **Determine Workflow:** Inspect the project's 'README.md' or other documentation to identify the established publishing or deployment workflow.
2.  **Create a Plan:** Based on your findings, create a step-by-step plan to publish the article. This often involves git operations (add, commit, push).
3.  **Seek Confirmation:** Present this plan to the user and ask for explicit confirmation before executing any of the steps, especially those that modify the remote repository.

Please proceed with determining the workflow and creating the plan.
`

const publishUserPrompt = "The work-in-progress article currently in your context is ready to be published. Please initiate the publishing process."

func Publish() *mcp.Prompt {
	return &mcp.Prompt{
		Name:        "publish",
		Description: "Publishes the final version of the article.",
	}
}

func PublishHandler(ctx context.Context, req *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
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
