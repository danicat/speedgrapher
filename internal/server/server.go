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

// Package server provides the MCP server implementation for Speedgrapher.
package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/danicat/speedgrapher/internal/instructions"
	"github.com/danicat/speedgrapher/internal/tools/fog"
	"github.com/danicat/speedgrapher/internal/tools/seo"
	"github.com/danicat/speedgrapher/internal/tools/slop"
	"github.com/danicat/speedgrapher/internal/tools/vale"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Config holds configuration parameters for initializing the Speedgrapher MCP server.
type Config struct {
	WorkspaceDir string
	Version      string
}

// NewServer creates the server and registers fog, slop, seo (analyze_seo), and vale tools
// with their respective configs (passing absolute WorkspaceDir).
func NewServer(cfg Config) (*mcp.Server, error) {
	wsDir := cfg.WorkspaceDir
	if wsDir == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return nil, fmt.Errorf("failed to get current working directory: %w", err)
		}
		wsDir = cwd
	}
	absWorkspace, err := filepath.Abs(wsDir)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve workspace directory %q: %w", wsDir, err)
	}

	version := cfg.Version
	if version == "" {
		version = "dev"
	}

	server := mcp.NewServer(
		&mcp.Implementation{
			Name:    "speedgrapher",
			Version: version,
		},
		&mcp.ServerOptions{
			Instructions: instructions.GetInstructions(),
		},
	)

	fog.Register(server, fog.Config{WorkspaceDir: absWorkspace})
	slop.Register(server, slop.Config{WorkspaceDir: absWorkspace})
	seo.Register(server, seo.Config{WorkspaceDir: absWorkspace})
	vale.Register(server, vale.Config{WorkspaceDir: absWorkspace})

	return server, nil
}

// RunStdio runs stdio transport using s.Run(ctx, &mcp.StdioTransport{}).
func RunStdio(ctx context.Context, s *mcp.Server) error {
	return s.Run(ctx, &mcp.StdioTransport{})
}

// NewStreamableHandler creates streamable HTTP handler using mcp.NewStreamableHTTPHandler.
func NewStreamableHandler(s *mcp.Server, opts *mcp.StreamableHTTPOptions) http.Handler {
	return mcp.NewStreamableHTTPHandler(func(_ *http.Request) *mcp.Server {
		return s
	}, opts)
}

// RunStreamableHTTP starts an http.Server with graceful shutdown on context cancellation.
func RunStreamableHTTP(ctx context.Context, s *mcp.Server, addr string) error {
	handler := NewStreamableHandler(s, nil)
	httpServer := &http.Server{
		Addr:    addr,
		Handler: handler,
	}

	errChan := make(chan error, 1)
	go func() {
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errChan <- err
		}
		close(errChan)
	}()

	select {
	case err := <-errChan:
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("http server shutdown failed: %w", err)
		}
		return <-errChan
	}
}
