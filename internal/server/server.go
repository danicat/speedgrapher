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
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/danicat/speedgrapher/internal/config"
	"github.com/danicat/speedgrapher/internal/instructions"
	"github.com/danicat/speedgrapher/internal/tools/fog"
	"github.com/danicat/speedgrapher/internal/tools/seo"
	"github.com/danicat/speedgrapher/internal/tools/slop"
	"github.com/danicat/speedgrapher/internal/tools/vale"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Option defines a functional option for configuring a Server.
type Option func(*Server)

// WithServerConfig configures allowed origins and timeouts from config.ServerConfig.
func WithServerConfig(cfg config.ServerConfig) Option {
	return func(s *Server) {
		if len(cfg.AllowedOrigins) > 0 {
			s.allowedOrigins = cfg.AllowedOrigins
		}
		if cfg.ReadTimeout > 0 {
			s.readTimeout = cfg.ReadTimeout
		}
		if cfg.WriteTimeout > 0 {
			s.writeTimeout = cfg.WriteTimeout
		}
		if cfg.IdleTimeout > 0 {
			s.idleTimeout = cfg.IdleTimeout
		}
		if cfg.ShutdownTimeout > 0 {
			s.shutdownTimeout = cfg.ShutdownTimeout
		}
	}
}

// WithWorkspaceDir sets the workspace directory for the server and registered tools.
func WithWorkspaceDir(dir string) Option {
	return func(s *Server) {
		s.workspaceDir = dir
	}
}

// WithAllowedOrigins sets the allowed CORS origins.
func WithAllowedOrigins(origins ...string) Option {
	return func(s *Server) {
		s.allowedOrigins = origins
	}
}

// WithReadTimeout sets the HTTP server ReadTimeout.
func WithReadTimeout(d time.Duration) Option {
	return func(s *Server) {
		s.readTimeout = d
	}
}

// WithWriteTimeout sets the HTTP server WriteTimeout.
func WithWriteTimeout(d time.Duration) Option {
	return func(s *Server) {
		s.writeTimeout = d
	}
}

// WithIdleTimeout sets the HTTP server IdleTimeout.
func WithIdleTimeout(d time.Duration) Option {
	return func(s *Server) {
		s.idleTimeout = d
	}
}

// WithShutdownTimeout sets the HTTP server ShutdownTimeout.
func WithShutdownTimeout(d time.Duration) Option {
	return func(s *Server) {
		s.shutdownTimeout = d
	}
}

// WithInstructions sets custom MCP server instructions.
func WithInstructions(instructions string) Option {
	return func(s *Server) {
		s.instructions = instructions
	}
}

// Server encapsulates the MCP server and its lifecycle configuration.
type Server struct {
	mcpServer       *mcp.Server
	registerOnce    sync.Once
	workspaceDir    string
	allowedOrigins  []string
	instructions    string
	readTimeout     time.Duration
	writeTimeout    time.Duration
	idleTimeout     time.Duration
	shutdownTimeout time.Duration
}

// New creates a new Server instance.
func New(version string, opts ...Option) *Server {
	if version == "" {
		version = "dev"
	}

	srv := &Server{
		instructions:    instructions.GetInstructions(),
		readTimeout:     30 * time.Second,
		writeTimeout:    5 * time.Minute,
		idleTimeout:     120 * time.Second,
		shutdownTimeout: 10 * time.Second,
	}

	for _, opt := range opts {
		opt(srv)
	}

	wsDir := srv.workspaceDir
	if wsDir == "" {
		if cwd, err := os.Getwd(); err == nil {
			wsDir = cwd
		} else {
			wsDir = "."
		}
	}
	if absWorkspace, err := filepath.Abs(wsDir); err == nil {
		srv.workspaceDir = absWorkspace
	}

	srv.mcpServer = mcp.NewServer(&mcp.Implementation{
		Name:    "speedgrapher",
		Version: version,
	}, &mcp.ServerOptions{
		Instructions: srv.instructions,
	})

	return srv
}

// RegisterHandlers wires all tools idempotently using sync.Once.
func (s *Server) RegisterHandlers() error {
	s.registerOnce.Do(func() {
		fog.Register(s.mcpServer, fog.Config{WorkspaceDir: s.workspaceDir})
		slop.Register(s.mcpServer, slop.Config{WorkspaceDir: s.workspaceDir})
		seo.Register(s.mcpServer, seo.Config{WorkspaceDir: s.workspaceDir})
		vale.Register(s.mcpServer, vale.Config{WorkspaceDir: s.workspaceDir})
	})
	return nil
}

// Run starts the MCP server using Stdio transport with clean disconnect handling.
func (s *Server) Run(ctx context.Context) error {
	if err := s.RegisterHandlers(); err != nil {
		return fmt.Errorf("failed to register handlers: %w", err)
	}
	err := s.mcpServer.Run(ctx, &mcp.StdioTransport{})
	if err != nil {
		if errors.Is(err, io.EOF) || errors.Is(err, context.Canceled) || errors.Is(err, io.ErrClosedPipe) {
			return nil
		}
		msg := err.Error()
		if strings.Contains(msg, "EOF") ||
			strings.Contains(msg, "server is closing") ||
			strings.Contains(msg, "closed pipe") ||
			strings.Contains(msg, "file already closed") ||
			strings.Contains(msg, "context canceled") {
			return nil
		}
		return err
	}
	return nil
}

// ServeHTTP starts the server over HTTP using StreamableHTTP with graceful shutdown.
func (s *Server) ServeHTTP(ctx context.Context, addr string) error {
	if err := s.RegisterHandlers(); err != nil {
		return fmt.Errorf("failed to register handlers: %w", err)
	}

	mcpHandler := mcp.NewStreamableHTTPHandler(func(_ *http.Request) *mcp.Server {
		return s.mcpServer
	}, &mcp.StreamableHTTPOptions{
		Stateless: true,
	})

	readTimeout := s.readTimeout
	if readTimeout <= 0 {
		readTimeout = 30 * time.Second
	}
	writeTimeout := s.writeTimeout
	if writeTimeout <= 0 {
		writeTimeout = 5 * time.Minute
	}
	idleTimeout := s.idleTimeout
	if idleTimeout <= 0 {
		idleTimeout = 120 * time.Second
	}
	shutdownTimeout := s.shutdownTimeout
	if shutdownTimeout <= 0 {
		shutdownTimeout = 10 * time.Second
	}

	httpServer := &http.Server{
		Addr:         addr,
		Handler:      s.createHTTPHandler(mcpHandler),
		ReadTimeout:  readTimeout,
		WriteTimeout: writeTimeout,
		IdleTimeout:  idleTimeout,
	}

	serverDone := make(chan struct{})
	var shutdownErr error
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		select {
		case <-ctx.Done():
			shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), shutdownTimeout)
			defer cancel()
			if err := httpServer.Shutdown(shutdownCtx); err != nil {
				log.Printf("HTTP server shutdown error: %v", err)
				shutdownErr = err
			}
		case <-serverDone:
			return
		}
	}()

	log.Printf("speedgrapher MCP server listening on HTTP %s", addr)
	err := httpServer.ListenAndServe()
	close(serverDone)
	wg.Wait()

	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("HTTP server error: %w", err)
	}

	if shutdownErr != nil {
		return fmt.Errorf("HTTP server shutdown error: %w", shutdownErr)
	}

	return nil
}

// createHTTPHandler wraps mcpHandler with CORS validation and panic recovery middleware.
func (s *Server) createHTTPHandler(mcpHandler http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("panic recovered in HTTP handler: %v", rec)
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			}
		}()

		origin := r.Header.Get("Origin")
		isAllowed := origin != "" && s.isAllowedOrigin(origin)

		if isAllowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id")
			w.Header().Set("Access-Control-Expose-Headers", "Mcp-Session-Id")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}

		if r.Method == http.MethodOptions {
			if origin != "" && !isAllowed {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusOK)
			return
		}

		mcpHandler.ServeHTTP(w, r)
	})
}

// isAllowedOrigin strictly validates CORS origins against localhost / loopback or configured allowed list.
func (s *Server) isAllowedOrigin(origin string) bool {
	if origin == "" {
		return false
	}

	for _, allowed := range s.allowedOrigins {
		if allowed == origin || allowed == "*" {
			return true
		}
		if strings.HasSuffix(allowed, "*") && strings.HasPrefix(origin, strings.TrimSuffix(allowed, "*")) {
			return true
		}
	}

	u, err := url.Parse(origin)
	if err != nil {
		return false
	}

	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return false
	}

	hostname := strings.ToLower(u.Hostname())
	if hostname == "localhost" || hostname == "127.0.0.1" || hostname == "::1" || hostname == "[::1]" {
		return true
	}

	return false
}

// Connect connects the server to a transport for in-memory or custom testing sessions.
func (s *Server) Connect(ctx context.Context, transport mcp.Transport, initOpts *mcp.ServerSessionOptions) (*mcp.ServerSession, error) {
	if err := s.RegisterHandlers(); err != nil {
		return nil, fmt.Errorf("failed to register handlers: %w", err)
	}
	return s.mcpServer.Connect(ctx, transport, initOpts)
}

// MCPServer returns the underlying mcp.Server instance.
func (s *Server) MCPServer() *mcp.Server {
	_ = s.RegisterHandlers()
	return s.mcpServer
}

// HTTPHandler returns the HTTP handler wrapping the streamable MCP handler.
func (s *Server) HTTPHandler() http.Handler {
	_ = s.RegisterHandlers()
	mcpHandler := mcp.NewStreamableHTTPHandler(func(_ *http.Request) *mcp.Server {
		return s.mcpServer
	}, &mcp.StreamableHTTPOptions{
		Stateless: true,
	})
	return s.createHTTPHandler(mcpHandler)
}

// Config holds legacy configuration parameters for initializing the Speedgrapher MCP server.
type Config struct {
	WorkspaceDir string
	Version      string
}

// NewServer creates the server and registers fog, slop, seo, and vale tools.
// Deprecated: Use New(version, opts...) instead.
func NewServer(cfg Config) (*mcp.Server, error) {
	s := New(cfg.Version, WithWorkspaceDir(cfg.WorkspaceDir))
	if err := s.RegisterHandlers(); err != nil {
		return nil, err
	}
	return s.mcpServer, nil
}

// RunStdio runs stdio transport using s.Run(ctx, &mcp.StdioTransport{}).
// Deprecated: Use Server.Run instead.
func RunStdio(ctx context.Context, s *mcp.Server) error {
	err := s.Run(ctx, &mcp.StdioTransport{})
	if err != nil {
		if errors.Is(err, io.EOF) || errors.Is(err, context.Canceled) || errors.Is(err, io.ErrClosedPipe) {
			return nil
		}
		msg := err.Error()
		if strings.Contains(msg, "EOF") ||
			strings.Contains(msg, "server is closing") ||
			strings.Contains(msg, "closed pipe") ||
			strings.Contains(msg, "file already closed") ||
			strings.Contains(msg, "context canceled") {
			return nil
		}
		return err
	}
	return nil
}

// NewStreamableHandler creates streamable HTTP handler using mcp.NewStreamableHTTPHandler.
// Deprecated: Use Server.HTTPHandler or Server.ServeHTTP instead.
func NewStreamableHandler(s *mcp.Server, opts *mcp.StreamableHTTPOptions) http.Handler {
	if opts == nil {
		opts = &mcp.StreamableHTTPOptions{Stateless: true}
	}
	return mcp.NewStreamableHTTPHandler(func(_ *http.Request) *mcp.Server {
		return s
	}, opts)
}

// RunStreamableHTTP starts an http.Server with graceful shutdown on context cancellation.
// Deprecated: Use Server.ServeHTTP instead.
func RunStreamableHTTP(ctx context.Context, s *mcp.Server, addr string) error {
	srv := New("", WithInstructions(instructions.GetInstructions()))
	srv.mcpServer = s
	return srv.ServeHTTP(ctx, addr)
}
