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
	"errors"
	"net"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/danicat/speedgrapher/internal/server"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestNewServer_RegistersToolsAndNoPromptsOrResources(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tmpDir := t.TempDir()
	srv, err := server.NewServer(server.Config{
		WorkspaceDir: tmpDir,
		Version:      "1.2.3",
	})
	if err != nil {
		t.Fatalf("NewServer failed: %v", err)
	}

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

func TestNewServer_WorkspaceResolution(t *testing.T) {
	// 1. Empty workspace dir defaults to cwd
	srv, err := server.NewServer(server.Config{
		WorkspaceDir: "",
		Version:      "",
	})
	if err != nil {
		t.Fatalf("NewServer with empty config failed: %v", err)
	}
	if srv == nil {
		t.Fatal("expected non-nil server")
	}

	// 2. Relative workspace dir is resolved to absolute path
	srvRel, err := server.NewServer(server.Config{
		WorkspaceDir: ".",
		Version:      "v1.0.0",
	})
	if err != nil {
		t.Fatalf("NewServer with relative path failed: %v", err)
	}
	if srvRel == nil {
		t.Fatal("expected non-nil server")
	}

	// 3. Absolute workspace path
	absDir := t.TempDir()
	srvAbs, err := server.NewServer(server.Config{
		WorkspaceDir: absDir,
		Version:      "v2.0.0",
	})
	if err != nil {
		t.Fatalf("NewServer with absolute path failed: %v", err)
	}
	if srvAbs == nil {
		t.Fatal("expected non-nil server")
	}
}

func TestNewStreamableHandler(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tmpDir := t.TempDir()
	srv, err := server.NewServer(server.Config{
		WorkspaceDir: tmpDir,
		Version:      "1.0.0",
	})
	if err != nil {
		t.Fatalf("NewServer failed: %v", err)
	}

	handler := server.NewStreamableHandler(srv, nil)
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

func TestRunStdio_ContextCancellation(t *testing.T) {
	srv, err := server.NewServer(server.Config{})
	if err != nil {
		t.Fatalf("NewServer failed: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	// RunStdio should return quickly on cancelled context
	_ = server.RunStdio(ctx, srv)
}

func TestRunStreamableHTTP_GracefulShutdown(t *testing.T) {
	srv, err := server.NewServer(server.Config{})
	if err != nil {
		t.Fatalf("NewServer failed: %v", err)
	}

	// Find a free TCP port
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen failed: %v", err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()

	ctx, cancel := context.WithCancel(context.Background())
	errChan := make(chan error, 1)

	go func() {
		errChan <- server.RunStreamableHTTP(ctx, srv, addr)
	}()

	// Give the server time to start listening
	time.Sleep(100 * time.Millisecond)

	// Trigger graceful shutdown
	cancel()

	select {
	case err := <-errChan:
		if err != nil && !errors.Is(err, context.Canceled) {
			t.Errorf("unexpected error from RunStreamableHTTP shutdown: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for RunStreamableHTTP graceful shutdown")
	}
}

func TestRunStreamableHTTP_ListenError(t *testing.T) {
	srv, err := server.NewServer(server.Config{})
	if err != nil {
		t.Fatalf("NewServer failed: %v", err)
	}

	// Bind a port first so RunStreamableHTTP fails to listen on it
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen failed: %v", err)
	}
	defer ln.Close()
	addr := ln.Addr().String()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	err = server.RunStreamableHTTP(ctx, srv, addr)
	if err == nil {
		t.Fatal("expected listen error for occupied port, got nil")
	}
}

func TestNewServer_WorkspaceDirFileResolution(t *testing.T) {
	// Create temporary workspace with a sample file
	tmpDir := t.TempDir()
	sampleFile := filepath.Join(tmpDir, "article.txt")
	if err := os.WriteFile(sampleFile, []byte("Speedgrapher is an editorial tool."), 0600); err != nil {
		t.Fatalf("failed to write sample file: %v", err)
	}

	srv, err := server.NewServer(server.Config{
		WorkspaceDir: tmpDir,
	})
	if err != nil {
		t.Fatalf("NewServer failed: %v", err)
	}

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
