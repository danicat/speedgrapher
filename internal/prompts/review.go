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
	"errors"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const reviewPrompt = `
You are a professional editor for a technical blog.
Your task is to review an article and ensure it meets our editorial guidelines.
You must provide constructive feedback to the author on how to improve it.

Here are the detailed guidelines you must follow for the review:

## Editorial Guidelines

### Core Philosophy
- **Is it a personal story?** Every article must be a personal story about a technical journey. It's not just a tutorial; it's a narrative that shares the "why" and the "how," including the struggles, the "aha!" moments, and the hard-won lessons.
- **Is it helpful?** The goal is to be cozy, helpful, and relatable.

### Tone of Voice
- **Is it personal?** The article should start with a personal story or a relatable frustration to connect with the reader on a human level.
- **Is it honest?** The article must not present a sanitized, perfect process. It must highlight the "pain and payoff" by talking about cryptic error messages, flawed initial prompts, and the hours of trial-and-error. These struggles contain the most valuable lessons.
- **Is it professional?** The tone must be that of an experienced peer sharing knowledge. It must avoid overly simplistic or patronizing language.
- **Does it empower the reader?** The article must present information objectively and avoid subjective judgments (e.g., calling a protocol "simple"). It should allow the reader to form their own opinions based on the facts and the story.

### Article Structure
The article must follow this narrative flow:
1.  **Introduction:** Does it hook the reader with a personal story about a problem or frustration and set the stage for the journey?
2.  **Context-Setting:** If the topic is complex, does it provide a clear, concise explanation with helpful analogies and links to official documentation?
3.  **The Journey (Body):** Does it walk through the process chronologically? Each section should represent a phase of the journey, complete with the prompts used, the results (good and bad), and the lessons learned.
4.  **Key Takeaways:** Does it conclude with a summary of the most important, high-level lessons learned from the entire experience?
5.  **What's Next?:** Is there a brief, forward-looking section that discusses the future of the project and provides links to related official or community efforts?
6.  **Resources and Links:** Is there a final, comprehensive list of all URLs mentioned in the article?

### Titles and Headings
- **Main Title:** Is the title a compelling hook? It can be a conversational question, a playful declaration, or a pop-culture reference, but it must be professional.
- **Headings:** Are headings used as narrative signposts to guide the reader through the story? Clever or funny headings should be used very sparingly (1-2 per article, maximum) to emphasize key, surprising moments. The rest should be grounded, descriptive, and professional.

### Technical Accuracy
- **Is it precise?** All technical details, especially protocol messages and code snippets, must be 100% accurate.
- **Are sources cited?** The article must link to the official documentation, specifications, and SDKs it references.
- **Does it use real-world examples?** Whenever possible, the article must use the *actual* output from tools and commands for authenticity. If a diagram is used, the source must be credited in a caption.
`

func Review() *mcp.Prompt {
	return &mcp.Prompt{
		Name:        "review",
		Description: "Reviews the article currently being worked on against the editorial guidelines.",
	}
}

func NewReviewHandler(guidelinePath string) mcp.PromptHandler {
	return func(ctx context.Context, session *mcp.ServerSession, params *mcp.GetPromptParams) (*mcp.GetPromptResult, error) {
		guidelines := reviewPrompt
		customGuidelines, err := os.ReadFile(guidelinePath)
		if err != nil {
			if !errors.Is(err, os.ErrNotExist) {
				return nil, err
			}
		} else {
			guidelines = string(customGuidelines)
		}

		prompt := "Please review the article we have been working on against the editorial guidelines."

		return &mcp.GetPromptResult{
			Messages: []*mcp.PromptMessage{
				{
					Role: "assistant",
					Content: &mcp.TextContent{
						Text: guidelines,
					},
				},
				{
					Role: "user",
					Content: &mcp.TextContent{
						Text: prompt,
					},
				},
			},
		}, nil
	}
}
