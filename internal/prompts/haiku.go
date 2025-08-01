package prompts

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func Haiku() *mcp.Prompt {
	return &mcp.Prompt{
		Name:        "haiku",
		Description: "Creates a haiku about a given topic.",
		Arguments: []*mcp.PromptArgument{
			{
				Name:        "topic",
				Description: "The topic for the haiku.",
				Required:    true,
			},
		},
	}
}

func HaikuHandler(ctx context.Context, session *mcp.ServerSession, params *mcp.GetPromptParams) (*mcp.GetPromptResult, error) {
	topic, ok := params.Arguments["topic"]
	if !ok {
		return nil, fmt.Errorf("topic argument not provided")
	}

	prompt := fmt.Sprintf("The user wants to have some fun and has requested a haiku about the following topic: %s", topic)

	return &mcp.GetPromptResult{
		Messages: []*mcp.PromptMessage{
			{
				Role: "user",
				Content: &mcp.TextContent{
					Text: prompt,
				},
			},
		},
	}, nil
}
