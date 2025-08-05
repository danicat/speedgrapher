package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/danicat/speedgrapher/internal/prompts"
	"github.com/danicat/speedgrapher/internal/tools/fog"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func main() {
	editorialGuidelines := flag.String("editorial", "EDITORIAL.md", "Path to the editorial guidelines file.")
	localizationGuidelines := flag.String("localization", "LOCALIZATION.md", "Path to the localization guidelines file.")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, *editorialGuidelines, *localizationGuidelines); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context, editorialGuidelines, localizationGuidelines string) error {
	server := mcp.NewServer(
		&mcp.Implementation{Name: "speedgrapher"},
		nil,
	)
	server.AddPrompt(prompts.Haiku(), prompts.HaikuHandler)
	server.AddPrompt(prompts.Interview(), prompts.InterviewHandler)
	server.AddPrompt(prompts.Localize(), prompts.NewLocalizeHandler(localizationGuidelines))
	server.AddPrompt(prompts.Review(), prompts.NewReviewHandler(editorialGuidelines))
	server.AddPrompt(prompts.Reflect(), prompts.ReflectHandler)
	server.AddPrompt(prompts.Readability(), prompts.ReadabilityHandler)
	server.AddPrompt(prompts.Context(), prompts.ContextHandler)
	server.AddPrompt(prompts.Voice(), prompts.VoiceHandler)
	server.AddPrompt(prompts.Outline(), prompts.OutlineHandler)
	server.AddPrompt(prompts.Expand(), prompts.ExpandHandler)
	fog.Register(server)
	return server.Run(ctx, mcp.NewStdioTransport())
}
