package prompts

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func Context() *mcp.Prompt {
	return &mcp.Prompt{
		Name:        "context",
		Description: "Loads the current work-in-progress article to context for further commands.",
		Arguments:   []*mcp.PromptArgument{},
	}
}

func ContextHandler(ctx context.Context, session *mcp.ServerSession, params *mcp.GetPromptParams) (*mcp.GetPromptResult, error) {
	return &mcp.GetPromptResult{
		Messages: []*mcp.PromptMessage{
			{
				Role: "user",
				Content: &mcp.TextContent{
					Text: "Please reload the current work-in-progress article in its entirety. I need to ensure you have the full, most up-to-date version of the text before we proceed with the next task, which might be an editorial review, a full-text analysis, or another operation that requires the complete document.",
				},
			},
		},
	}, nil
}
