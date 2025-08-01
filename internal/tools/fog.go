package tools

import (
	"context"

	"github.com/danicat/speedgrapher/internal/tools/fog"
	"github.com/modelcontextprotocol/go-sdk/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type FogIn struct {
	Text string `json:"text" jsonschema:"The text to analyze."`
}

type FogOut struct {
	FogIndex       float64 `json:"fog_index"`
	Classification string  `json:"classification"`
}

func mustSchemaFor[T any]() *jsonschema.Schema {
	schema, err := jsonschema.For[T]()
	if err != nil {
		panic(err)
	}
	return schema
}

func Fog() *mcp.Tool {
	return &mcp.Tool{
		Name:        "fog",
		Description: "Calculates the Gunning Fog Index for a given text.",
		InputSchema: mustSchemaFor[FogIn](),
	}
}

func FogHandler(ctx context.Context, s *mcp.ServerSession, params *mcp.CallToolParamsFor[FogIn]) (*mcp.CallToolResultFor[FogOut], error) {
	fogIndex := fog.CalculateFogIndex(params.Arguments.Text)
	classification := fog.ClassifyFogIndex(fogIndex)

	return &mcp.CallToolResultFor[FogOut]{
		StructuredContent: FogOut{
			FogIndex:       fogIndex,
			Classification: classification,
		},
	}, nil
}
