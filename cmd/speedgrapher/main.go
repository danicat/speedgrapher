package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/danicat/speedgrapher/internal/prompts"
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
	return server.Run(ctx, mcp.NewStdioTransport())
}
