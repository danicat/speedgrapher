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

package server_test

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/danicat/speedgrapher/internal/config"
	"github.com/danicat/speedgrapher/internal/server"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestServer_RegisterHandlers_Idempotent(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tmpDir := t.TempDir()
	srv := server.New("1.2.3", server.WithWorkspaceDir(tmpDir))
	if srv == nil {
		t.Fatal("New returned nil server")
	}

	// Sequential idempotency check
	for i := 0; i < 3; i++ {
		if err := srv.RegisterHandlers(); err != nil {
			t.Fatalf("RegisterHandlers() iteration %d unexpected error = %v", i, err)
		}
	}

	// Concurrent idempotency check
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := srv.RegisterHandlers(); err != nil {
				t.Errorf("concurrent RegisterHandlers() error = %v", err)
			}
		}()
	}
	wg.Wait()

	client := mcp.NewClient(&mcp.Implementation{Name: "test-client", Version: "1.0.0"}, nil)
	clientTransport, serverTransport := mcp.NewInMemoryTransports()

	serverSession, err := srv.Connect(ctx, serverTransport, nil)
	if err != nil {
		t.Fatalf("server.Connect failed: %v", err)
	}
	defer serverSession.Close()

	clientSession, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatalf("client.Connect failed: %v", err)
	}
	defer clientSession.Close()

	// Verify Tools: exactly 4 tools registered: analyze_seo, fog, slop, vale
	toolsRes, err := clientSession.ListTools(ctx, nil)
	if err != nil {
		t.Fatalf("ListTools failed: %v", err)
	}

	var toolNames []string
	for _, tool := range toolsRes.Tools {
		toolNames = append(toolNames, tool.Name)
	}
	sort.Strings(toolNames)

	expectedTools := []string{"analyze_seo", "fog", "slop", "vale"}
	if len(toolNames) != len(expectedTools) {
		t.Fatalf("expected %d tools, got %d: %v", len(expectedTools), len(toolNames), toolNames)
	}
	for i, name := range expectedTools {
		if toolNames[i] != name {
			t.Errorf("tool[%d] = %q, expected %q", i, toolNames[i], name)
		}
	}

	// Verify Prompts: NO prompts registered
	promptsRes, err := clientSession.ListPrompts(ctx, nil)
	if err != nil {
		t.Fatalf("ListPrompts failed: %v", err)
	}
	if len(promptsRes.Prompts) != 0 {
		t.Errorf("expected 0 prompts registered, got %d", len(promptsRes.Prompts))
	}

	// Verify Resources: NO resources registered
	resourcesRes, err := clientSession.ListResources(ctx, nil)
	if err != nil {
		t.Fatalf("ListResources failed: %v", err)
	}
	if len(resourcesRes.Resources) != 0 {
		t.Errorf("expected 0 resources registered, got %d", len(resourcesRes.Resources))
	}

	// Verify Resource Templates: NO resource templates registered
	templatesRes, err := clientSession.ListResourceTemplates(ctx, nil)
	if err != nil {
		t.Fatalf("ListResourceTemplates failed: %v", err)
	}
	if len(templatesRes.ResourceTemplates) != 0 {
		t.Errorf("expected 0 resource templates registered, got %d", len(templatesRes.ResourceTemplates))
	}
}

func TestServer_Options(t *testing.T) {
	serverCfg := config.ServerConfig{
		ListenAddr:      ":9090",
		ReadTimeout:     20 * time.Second,
		WriteTimeout:    3 * time.Minute,
		IdleTimeout:     90 * time.Second,
		ShutdownTimeout: 8 * time.Second,
		AllowedOrigins:  []string{"https://example.com"},
	}

	s := server.New("2.0.0",
		server.WithServerConfig(serverCfg),
		server.WithWorkspaceDir(t.TempDir()),
		server.WithAllowedOrigins("https://override.com"),
		server.WithReadTimeout(15*time.Second),
		server.WithWriteTimeout(4*time.Minute),
		server.WithIdleTimeout(60*time.Second),
		server.WithShutdownTimeout(5*time.Second),
		server.WithInstructions("Custom Instructions"),
	)
	if s == nil {
		t.Fatal("New with server config returned nil server")
	}
	if err := s.RegisterHandlers(); err != nil {
		t.Fatalf("RegisterHandlers() unexpected error = %v", err)
	}
}

func TestServer_ServeHTTP_CORS(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen on free port: %v", err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()

	srv := server.New("test", server.WithServerConfig(config.ServerConfig{
		AllowedOrigins: []string{"https://custom.allowed.corp"},
	}))
	errCh := make(chan error, 1)

	go func() {
		errCh <- srv.ServeHTTP(ctx, addr)
	}()

	client := &http.Client{Timeout: 2 * time.Second}
	waitForServerReady(ctx, t, client, addr)

	tests := corsTestCases()
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			verifyCORSResponse(ctx, t, client, addr, tc)
		})
	}

	// Trigger graceful shutdown
	cancel()

	select {
	case err := <-errCh:
		if err != nil {
			t.Errorf("ServeHTTP returned unexpected error on shutdown: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for HTTP server to shut down")
	}
}

type corsTestCase struct {
	name           string
	origin         string
	expectedStatus int
	expectAllow    bool
}

func corsTestCases() []corsTestCase {
	return []corsTestCase{
		{
			name:           "localhost port 3000 allowed",
			origin:         "http://localhost:3000",
			expectedStatus: http.StatusOK,
			expectAllow:    true,
		},
		{
			name:           "127.0.0.1 port 8080 allowed",
			origin:         "http://127.0.0.1:8080",
			expectedStatus: http.StatusOK,
			expectAllow:    true,
		},
		{
			name:           "https localhost allowed",
			origin:         "https://localhost:5173",
			expectedStatus: http.StatusOK,
			expectAllow:    true,
		},
		{
			name:           "configured custom origin allowed",
			origin:         "https://custom.allowed.corp",
			expectedStatus: http.StatusOK,
			expectAllow:    true,
		},
		{
			name:           "attacker prefix subdomain rejected",
			origin:         "http://localhost.attacker.com",
			expectedStatus: http.StatusForbidden,
			expectAllow:    false,
		},
		{
			name:           "arbitrary untrusted https origin rejected",
			origin:         "https://evil-site.com",
			expectedStatus: http.StatusForbidden,
			expectAllow:    false,
		},
		{
			name:           "arbitrary untrusted http origin rejected",
			origin:         "http://attacker.com",
			expectedStatus: http.StatusForbidden,
			expectAllow:    false,
		},
	}
}

func waitForServerReady(ctx context.Context, t *testing.T, client *http.Client, addr string) {
	t.Helper()
	for i := 0; i < 20; i++ {
		time.Sleep(50 * time.Millisecond)
		req, _ := http.NewRequestWithContext(ctx, http.MethodOptions, "http://"+addr+"/", nil)
		if resp, err := client.Do(req); err == nil {
			_ = resp.Body.Close()
			return
		}
	}
	t.Fatal("timed out waiting for HTTP server to become ready")
}

func verifyCORSResponse(ctx context.Context, t *testing.T, client *http.Client, addr string, tc corsTestCase) {
	t.Helper()
	req, err := http.NewRequestWithContext(ctx, http.MethodOptions, "http://"+addr+"/", nil)
	if err != nil {
		t.Fatalf("failed to create OPTIONS request: %v", err)
	}
	req.Header.Set("Origin", tc.origin)

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != tc.expectedStatus {
		t.Errorf("expected status %d, got %d", tc.expectedStatus, resp.StatusCode)
	}

	allowOrigin := resp.Header.Get("Access-Control-Allow-Origin")
	if tc.expectAllow {
		if allowOrigin != tc.origin {
			t.Errorf("expected Access-Control-Allow-Origin %q, got %q", tc.origin, allowOrigin)
		}
		if resp.Header.Get("Access-Control-Allow-Credentials") != "true" {
			t.Error("expected Access-Control-Allow-Credentials to be true for allowed origin")
		}
	} else if allowOrigin != "" {
		t.Errorf("expected no Access-Control-Allow-Origin header for rejected origin, got %q", allowOrigin)
	}
}

func TestServer_ServeHTTP_BindFailure(t *testing.T) {
	ctx := context.Background()
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to create test listener: %v", err)
	}
	defer func() { _ = ln.Close() }()
	addr := ln.Addr().String()

	srv := server.New("test")

	// ServeHTTP on the already bound address should fail immediately and not hang
	errCh := make(chan error, 1)
	go func() {
		errCh <- srv.ServeHTTP(ctx, addr)
	}()

	select {
	case err := <-errCh:
		if err == nil {
			t.Fatal("expected ServeHTTP to return error when binding to used port, got nil")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("ServeHTTP hung instead of returning error on bind failure")
	}
}

func TestServer_RunStdio_ContextCancellation(t *testing.T) {
	srv := server.New("test")
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	// Run should return nil cleanly on cancelled context
	if err := srv.Run(ctx); err != nil {
		t.Fatalf("srv.Run unexpected error on cancelled context: %v", err)
	}
}

func TestServer_HTTPHandler_StreamableToolCall(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tmpDir := t.TempDir()
	srv := server.New("1.0.0", server.WithWorkspaceDir(tmpDir))

	handler := srv.HTTPHandler()
	if handler == nil {
		t.Fatal("expected non-nil HTTP handler")
	}

	ts := httptest.NewServer(handler)
	defer ts.Close()

	client := mcp.NewClient(&mcp.Implementation{Name: "http-client", Version: "1.0.0"}, nil)
	clientTransport := &mcp.StreamableClientTransport{
		Endpoint: ts.URL,
	}

	clientSession, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatalf("client.Connect over StreamableHTTP failed: %v", err)
	}
	defer clientSession.Close()

	// Verify ListTools over Streamable HTTP
	toolsRes, err := clientSession.ListTools(ctx, nil)
	if err != nil {
		t.Fatalf("ListTools over Streamable HTTP failed: %v", err)
	}
	if len(toolsRes.Tools) != 4 {
		t.Errorf("expected 4 tools over HTTP, got %d", len(toolsRes.Tools))
	}

	// Test calling fog tool over Streamable HTTP
	fogArgs, err := json.Marshal(map[string]string{
		"text": "This is a clean and straightforward sentence. Reading this should be easy.",
	})
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}

	callRes, err := clientSession.CallTool(ctx, &mcp.CallToolParams{
		Name:      "fog",
		Arguments: json.RawMessage(fogArgs),
	})
	if err != nil {
		t.Fatalf("CallTool 'fog' over HTTP failed: %v", err)
	}
	if callRes.IsError {
		t.Fatalf("CallTool 'fog' returned error result")
	}
	if len(callRes.Content) == 0 {
		t.Errorf("expected non-empty CallTool content")
	}
}

func TestServer_WorkspaceDirFileResolution(t *testing.T) {
	tmpDir := t.TempDir()
	sampleFile := filepath.Join(tmpDir, "article.txt")
	if err := os.WriteFile(sampleFile, []byte("Speedgrapher is an editorial tool."), 0600); err != nil {
		t.Fatalf("failed to write sample file: %v", err)
	}

	srv := server.New("test", server.WithWorkspaceDir(tmpDir))

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	client := mcp.NewClient(&mcp.Implementation{Name: "test-client", Version: "1.0.0"}, nil)
	clientTransport, serverTransport := mcp.NewInMemoryTransports()

	serverSession, err := srv.Connect(ctx, serverTransport, nil)
	if err != nil {
		t.Fatalf("server.Connect failed: %v", err)
	}
	defer serverSession.Close()

	clientSession, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatalf("client.Connect failed: %v", err)
	}
	defer clientSession.Close()

	// Call fog tool using relative path within workspace
	fogArgs, _ := json.Marshal(map[string]string{
		"path": "article.txt",
	})
	res, err := clientSession.CallTool(ctx, &mcp.CallToolParams{
		Name:      "fog",
		Arguments: json.RawMessage(fogArgs),
	})
	if err != nil {
		t.Fatalf("CallTool fog with relative path failed: %v", err)
	}
	if res.IsError {
		t.Fatalf("CallTool fog returned error")
	}
}

func TestServer_LegacyCompatibility(t *testing.T) {
	tmpDir := t.TempDir()
	legacyServer, err := server.NewServer(server.Config{
		WorkspaceDir: tmpDir,
		Version:      "legacy-v1",
	})
	if err != nil {
		t.Fatalf("NewServer failed: %v", err)
	}
	if legacyServer == nil {
		t.Fatal("expected non-nil legacy server")
	}

	handler := server.NewStreamableHandler(legacyServer, nil)
	if handler == nil {
		t.Fatal("expected non-nil legacy streamable handler")
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := server.RunStdio(ctx, legacyServer); err != nil {
		t.Errorf("RunStdio unexpected error on cancelled context: %v", err)
	}
}
