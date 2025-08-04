package prompts

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func Haiku() *mcp.Prompt {
	return &mcp.Prompt{
		Name:        "haiku",
		Description: "Creates a haiku about a given topic, or infers the topic from the current conversation.",
		Arguments: []*mcp.PromptArgument{
			{
				Name:        "topic",
				Description: "The topic for the haiku. If not provided, the model will infer it from the conversation.",
				Required:    false,
			},
		},
	}
}

func HaikuHandler(ctx context.Context, session *mcp.ServerSession, params *mcp.GetPromptParams) (*mcp.GetPromptResult, error) {
	prompt := "Write a haiku about the main subject of our conversation."
	if topic, ok := params.Arguments["topic"]; ok && topic != "" {
		prompt = fmt.Sprintf("The user wants to have some fun and has requested a haiku about the following topic: %s", topic)
	}

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
