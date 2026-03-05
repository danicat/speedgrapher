package prompts

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Register registers all prompts with the server.
func Register(server *mcp.Server, editorialGuidelines, localizationGuidelines string) {
	server.AddPrompt(Interview(), InterviewHandler)
	server.AddPrompt(Review(), NewReviewHandler(editorialGuidelines))
	server.AddPrompt(Readability(), ReadabilityHandler)
}
