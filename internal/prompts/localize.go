package prompts

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const localizePrompt = `
You are a localization specialist. Your task is to translate an article into a target language while strictly adhering to our localization guidelines.

You must follow these rules:

**1. Do Not Translate Technical Terms:**
   - All technical computer science and software engineering terms must remain in English. This is not an exhaustive list; use your best judgment for similar jargon.
   - Examples: ` + "`API`" + `, ` + "`backend`" + `, ` + "`CLI`" + `, ` + "`commit`" + `, ` + "`database`" + `, ` + "`frontend`" + `, ` + "`JSON`" + `, ` + "`LLM`" + `, ` + "`prompt`" + `.

**2. Do Not Translate Product & Brand Names:**
   - All product, company, and brand names must remain in their original form.
   - Examples: ` + "`Claude`" + `, ` + "`Gemini CLI`" + `, ` + "`Go`" + `, ` + "`GoDoctor`" + `, ` + "`Google Cloud`" + `, ` + "`Jules`" + `, ` + "`osquery`" + `.

**3. Maintain Formatting:**
   - Preserve all markdown formatting, including headings, lists, bold/italic text, and links.
   - Do not translate content within code blocks (` + "```" + `). Comments within code may be translated.
   - Keep all URLs and links unchanged.

**4. Tone and Style:**
   - Review existing articles in the target language to match the established professional yet approachable tone.
`

func Localize() *mcp.Prompt {
	return &mcp.Prompt{
		Name:        "localize",
		Description: "Translates the article currently being worked on into a target language.",
		Arguments: []*mcp.PromptArgument{
			{
				Name:        "target_language",
				Description: "The language to translate the article into.",
				Required:    true,
			},
		},
	}
}

func LocalizeHandler(ctx context.Context, session *mcp.ServerSession, params *mcp.GetPromptParams) (*mcp.GetPromptResult, error) {
	targetLanguage, ok := params.Arguments["target_language"]
	if !ok {
		return nil, fmt.Errorf("target_language argument not provided")
	}

	prompt := fmt.Sprintf("Translate the article we have been working on to %s. Adhere to the localization guidelines.", targetLanguage)

	return &mcp.GetPromptResult{
			Messages: []*mcp.PromptMessage{
				{
					Role: "assistant",
					Content: &mcp.TextContent{
						Text: localizePrompt,
					},
				},
				{
					Role: "user",
					Content: &mcp.TextContent{
						Text: prompt,
					},
				},
			},
		},
		nil
}
