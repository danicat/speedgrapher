package prompts

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const readabilityPrompt = `**Objective: Evaluate Readability**

You are an expert editor. Your task is to analyze the most recent text you have generated in this session and assess its readability using the Gunning Fog Index.

**Analysis Steps:**

1.  **Identify the Text:** Use the most recent, complete text block you generated in this session as the source material.
2.  **Assess Current Readability:** Use the ` + "`fog`" + ` tool to calculate the current Gunning Fog Index and classification for the text.

**Your Task:**

Now, execute the plan. First, call the ` + "`fog`" + ` tool on the text you just wrote. Then, provide your analysis.`

func Readability() *mcp.Prompt {
	return &mcp.Prompt{
		Name:        "readability",
		Description: "Analyzes the last generated text for readability using the Gunning Fog Index.",
	}
}

func ReadabilityHandler(ctx context.Context, s *mcp.ServerSession, params *mcp.GetPromptParams) (*mcp.GetPromptResult, error) {
	return &mcp.GetPromptResult{
		Messages: []*mcp.PromptMessage{
			{
				Role: "assistant",
				Content: &mcp.TextContent{
					Text: readabilityPrompt,
				},
			},
		},
	}, nil
}
