// Copyright 2025 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

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
	server.AddPrompt(prompts.Publish(), prompts.PublishHandler)
	fog.Register(server)
	return server.Run(ctx, mcp.NewStdioTransport())
}
