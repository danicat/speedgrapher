package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/danicat/speedgrapher/internal/prompts"
	"github.com/danicat/speedgrapher/internal/tools/fog"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	server := mcp.NewServer(
		&mcp.Implementation{Name: "speedgrapher"},
		nil,
	)
	server.AddPrompt(prompts.Haiku(), prompts.HaikuHandler)
	server.AddPrompt(prompts.Interview(), prompts.InterviewHandler)
	server.AddPrompt(prompts.Localize(), prompts.LocalizeHandler)
	server.AddPrompt(prompts.Review(), prompts.ReviewHandler)
	server.AddPrompt(prompts.Reflect(), prompts.ReflectHandler)
	server.AddPrompt(prompts.Readability(), prompts.ReadabilityHandler)
	server.AddPrompt(prompts.Context(), prompts.ContextHandler)
	server.AddPrompt(prompts.Voice(), prompts.VoiceHandler)
	fog.Register(server)
	return server.Run(ctx, mcp.NewStdioTransport())
}
