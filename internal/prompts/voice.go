package prompts

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func Voice() *mcp.Prompt {
	return &mcp.Prompt{
		Name:        "voice",
		Description: "Analyzes the voice and tone of the user's writing to replicate it in generated text.",
		Arguments: []*mcp.PromptArgument{
			{
				Name:        "hint",
				Description: "Optional hint to locate the reference content (file, path, glob, or URL).",
				Required:    false,
			},
		},
	}
}

func VoiceHandler(ctx context.Context, session *mcp.ServerSession, params *mcp.GetPromptParams) (*mcp.GetPromptResult, error) {
	prompt := "Please analyze the voice and tone of my writing by discovering my content within the current project. Look for my blog articles, book chapters, or other written materials. I want you to replicate my style in future generated text. Analyze ALL of my writing that you can find."
	if hint, ok := params.Arguments["hint"]; ok && hint != "" {
		prompt = fmt.Sprintf("Please analyze the voice and tone of my writing. The user has provided the following hint to help you locate the content: '%s'. Please interpret this hint to find the relevant materials (it could be a file path, a glob pattern, a URL, or just a description). Analyze ALL of my writing that you can find based on this hint so you can replicate my style in future generated text.", hint)
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
