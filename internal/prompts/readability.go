package prompts

import (
	"context"
	"fmt"

	"github.com/danicat/speedgrapher/internal/tools/fog"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const readabilityPromptTemplate = `**Objective: Improve Readability**

You are an expert editor. Your task is to analyze the most recent text you have generated in this session, assess its readability using the Gunning Fog Index, and then suggest specific improvements to align it with the target readability level of **%s**.

**Analysis Steps:**

1.  **Identify the Text:** Use the most recent, complete text block you generated in this session as the source material.
2.  **Assess Current Readability:** Use the ` + "`fog`" + ` tool to calculate the current Gunning Fog Index and classification for the text.
3.  **Compare and Strategize:** Compare the current classification with the target of **%s**. Based on the gap, formulate a strategy for revision.
4.  **Provide Actionable Feedback:** Offer concrete, line-by-line suggestions for improvement. Provide rewritten examples.

**Your Task:**

Now, execute the plan. First, call the ` + "`fog`" + ` tool on the text you just wrote. Then, provide your analysis and suggested revisions.`

func Readability() *mcp.Prompt {
	return &mcp.Prompt{
		Name:        "readability",
		Description: "Analyzes the last generated text for readability and suggests improvements.",
		Arguments: []*mcp.PromptArgument{
			{
				Name:        "target",
				Description: "The target readability category.",
				Required:    false,
			},
		},
	}
}

func ReadabilityHandler(ctx context.Context, s *mcp.ServerSession, params *mcp.GetPromptParams) (*mcp.GetPromptResult, error) {
	target, ok := params.Arguments["target"]
	if !ok || target == "" {
		target = fog.FogCategoryProfessional
	}

	promptText := fmt.Sprintf(readabilityPromptTemplate, target, target)

	return &mcp.GetPromptResult{
		Messages: []*mcp.PromptMessage{
			{
				Role: "assistant",
				Content: &mcp.TextContent{
					Text: promptText,
				},
			},
		},
	}, nil
}
