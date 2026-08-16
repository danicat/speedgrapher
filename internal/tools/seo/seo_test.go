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

package seo

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/PuerkitoBio/goquery"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const perfectBody = `
	<p>This is some content. It needs to be long enough to pass the word count check.
	Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
	Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
	Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.
	Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
	Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
	Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
	Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.
	Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
	Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
	Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
	Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.
	Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
	Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
	Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
	Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.
	Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
	Extra words to make sure we pass the count. Extra words to make sure we pass the count.
	</p>
`

func TestAnalyzeSEO_PassingScore(t *testing.T) {
	html := `
		<html>
			<head>
				<title>Perfect SEO Title Example For Testing Keyword</title>
				<meta name="description" content="This is a perfect meta description that is long enough to pass the check and contains the keyword we are looking for in this test case.">
				<link rel="canonical" href="https://example.com/page">
			</head>
			<body>
				<h1>Main Keyword Heading</h1>
				` + perfectBody + `
				<img src="image.jpg" alt="Description of image">
				<a href="/internal">Internal Link</a>
			</body>
		</html>
	`

	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		t.Fatalf("Failed to parse HTML: %v", err)
	}

	result := analyzeSEO(doc, "keyword")

	if result.Score != 100 {
		t.Errorf("Expected score 100, got %d", result.Score)
		for _, check := range result.Checks {
			if check.Status != "pass" {
				t.Logf("Failed check: %s - %s", check.Name, check.Description)
			}
		}
	}

	if result.Title != "Perfect SEO Title Example For Testing Keyword" {
		t.Errorf("Expected title 'Perfect SEO Title Example For Testing Keyword', got '%s'", result.Title)
	}
	if result.H1 != "Main Keyword Heading" {
		t.Errorf("Expected H1 'Main Keyword Heading', got '%s'", result.H1)
	}
	if result.WordCount < 300 {
		t.Errorf("Expected word count >= 300, got %d", result.WordCount)
	}
}

func TestAnalyzeSEO_IndividualChecks(t *testing.T) {
	tests := []struct {
		name         string
		html         string
		keyword      string
		expectedPass map[string]bool // check name -> true if pass, false if fail/warning
	}{
		{
			name: "Missing Title",
			html: `<html><head><meta name="description" content="This is a valid meta description that has between 120 and 160 characters to pass the check cleanly without triggering length warning."><link rel="canonical" href="https://example.com"></head><body><h1>Valid Heading</h1><a href="/">Home</a><img src="a.jpg" alt="Alt">` + perfectBody + `</body></html>`,
			expectedPass: map[string]bool{
				"Title Tag": false,
			},
		},
		{
			name: "Short Title",
			html: `<html><head><title>Too Short</title><meta name="description" content="This is a valid meta description that has between 120 and 160 characters to pass the check cleanly without triggering length warning."><link rel="canonical" href="https://example.com"></head><body><h1>Valid Heading</h1><a href="/">Home</a><img src="a.jpg" alt="Alt">` + perfectBody + `</body></html>`,
			expectedPass: map[string]bool{
				"Title Tag": false,
			},
		},
		{
			name: "Long Title",
			html: `<html><head><title>This title is intentionally made way too long to exceed the sixty characters maximum limit for SEO titles</title><meta name="description" content="This is a valid meta description that has between 120 and 160 characters to pass the check cleanly without triggering length warning."><link rel="canonical" href="https://example.com"></head><body><h1>Valid Heading</h1><a href="/">Home</a><img src="a.jpg" alt="Alt">` + perfectBody + `</body></html>`,
			expectedPass: map[string]bool{
				"Title Tag": false,
			},
		},
		{
			name:    "Missing Keyword in Title",
			html:    `<html><head><title>A Valid Length Title Without Given Term</title><meta name="description" content="This is a valid meta description that has between 120 and 160 characters to pass the check and contains target keyword."><link rel="canonical" href="https://example.com"></head><body><h1>Target Keyword Heading</h1><a href="/">Home</a><img src="a.jpg" alt="Alt">` + perfectBody + `</body></html>`,
			keyword: "target",
			expectedPass: map[string]bool{
				"Title Tag": false,
			},
		},
		{
			name: "Missing Meta Description",
			html: `<html><head><title>A Valid Length Title For Testing Here</title><link rel="canonical" href="https://example.com"></head><body><h1>Valid Heading</h1><a href="/">Home</a><img src="a.jpg" alt="Alt">` + perfectBody + `</body></html>`,
			expectedPass: map[string]bool{
				"Meta Description": false,
			},
		},
		{
			name: "Short Meta Description",
			html: `<html><head><title>A Valid Length Title For Testing Here</title><meta name="description" content="Too short description."><link rel="canonical" href="https://example.com"></head><body><h1>Valid Heading</h1><a href="/">Home</a><img src="a.jpg" alt="Alt">` + perfectBody + `</body></html>`,
			expectedPass: map[string]bool{
				"Meta Description": false,
			},
		},
		{
			name: "Long Meta Description",
			html: `<html><head><title>A Valid Length Title For Testing Here</title><meta name="description" content="This meta description is way too long because it has way more than one hundred and sixty characters in total and should therefore trigger a warning check from the SEO analysis tool."><link rel="canonical" href="https://example.com"></head><body><h1>Valid Heading</h1><a href="/">Home</a><img src="a.jpg" alt="Alt">` + perfectBody + `</body></html>`,
			expectedPass: map[string]bool{
				"Meta Description": false,
			},
		},
		{
			name:    "Missing Keyword in Description",
			html:    `<html><head><title>A Valid Title Containing Target Term</title><meta name="description" content="This is a valid meta description that has between 120 and 160 characters to pass the check cleanly without triggering any length warnings."><link rel="canonical" href="https://example.com"></head><body><h1>Target Heading</h1><a href="/">Home</a><img src="a.jpg" alt="Alt">` + perfectBody + `</body></html>`,
			keyword: "target",
			expectedPass: map[string]bool{
				"Meta Description": false,
			},
		},
		{
			name: "Missing H1",
			html: `<html><head><title>A Valid Length Title For Testing Here</title><meta name="description" content="This is a valid meta description that has between 120 and 160 characters to pass the check cleanly without triggering length warning."><link rel="canonical" href="https://example.com"></head><body><h2>Subheading Only</h2><a href="/">Home</a><img src="a.jpg" alt="Alt">` + perfectBody + `</body></html>`,
			expectedPass: map[string]bool{
				"H1 Tag": false,
			},
		},
		{
			name: "Multiple H1 Tags",
			html: `<html><head><title>A Valid Length Title For Testing Here</title><meta name="description" content="This is a valid meta description that has between 120 and 160 characters to pass the check cleanly without triggering length warning."><link rel="canonical" href="https://example.com"></head><body><h1>First Heading</h1><h1>Second Heading</h1><a href="/">Home</a><img src="a.jpg" alt="Alt">` + perfectBody + `</body></html>`,
			expectedPass: map[string]bool{
				"H1 Tag": false,
			},
		},
		{
			name:    "Missing Keyword in H1",
			html:    `<html><head><title>A Valid Title Containing Target Term</title><meta name="description" content="This is a valid meta description that has between 120 and 160 characters to pass the check and contains target keyword."><link rel="canonical" href="https://example.com"></head><body><h1>Unrelated Heading</h1><a href="/">Home</a><img src="a.jpg" alt="Alt">` + perfectBody + `</body></html>`,
			keyword: "target",
			expectedPass: map[string]bool{
				"H1 Tag": false,
			},
		},
		{
			name: "Missing Image Alt",
			html: `<html><head><title>A Valid Length Title For Testing Here</title><meta name="description" content="This is a valid meta description that has between 120 and 160 characters to pass the check cleanly without triggering length warning."><link rel="canonical" href="https://example.com"></head><body><h1>Valid Heading</h1><a href="/">Home</a><img src="a.jpg">` + perfectBody + `</body></html>`,
			expectedPass: map[string]bool{
				"Image Alt Text": false,
			},
		},
		{
			name: "No Links Found",
			html: `<html><head><title>A Valid Length Title For Testing Here</title><meta name="description" content="This is a valid meta description that has between 120 and 160 characters to pass the check cleanly without triggering length warning."><link rel="canonical" href="https://example.com"></head><body><h1>Valid Heading</h1><img src="a.jpg" alt="Alt">` + perfectBody + `</body></html>`,
			expectedPass: map[string]bool{
				"Links": false,
			},
		},
		{
			name: "Thin Content",
			html: `<html><head><title>A Valid Length Title For Testing Here</title><meta name="description" content="This is a valid meta description that has between 120 and 160 characters to pass the check cleanly without triggering length warning."><link rel="canonical" href="https://example.com"></head><body><h1>Valid Heading</h1><a href="/">Home</a><img src="a.jpg" alt="Alt"><p>Short content.</p></body></html>`,
			expectedPass: map[string]bool{
				"Content Length": false,
			},
		},
		{
			name: "Missing Canonical",
			html: `<html><head><title>A Valid Length Title For Testing Here</title><meta name="description" content="This is a valid meta description that has between 120 and 160 characters to pass the check cleanly without triggering length warning."></head><body><h1>Valid Heading</h1><a href="/">Home</a><img src="a.jpg" alt="Alt">` + perfectBody + `</body></html>`,
			expectedPass: map[string]bool{
				"Canonical Tag": false,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			doc, err := goquery.NewDocumentFromReader(strings.NewReader(tt.html))
			if err != nil {
				t.Fatalf("Failed to parse HTML: %v", err)
			}
			result := analyzeSEO(doc, tt.keyword)
			for checkName, expected := range tt.expectedPass {
				found := false
				for _, check := range result.Checks {
					if check.Name == checkName {
						found = true
						if expected && check.Status != "pass" {
							t.Errorf("Expected check %q to pass, got status %q (%s)", checkName, check.Status, check.Description)
						}
						if !expected && check.Status == "pass" {
							t.Errorf("Expected check %q to fail/warn, got status 'pass'", checkName)
						}
					}
				}
				if !found {
					t.Errorf("Check %q not found in results", checkName)
				}
			}
		})
	}
}

func TestAnalyzeSEO_ScoreFloor(t *testing.T) {
	// Empty body, missing all tags
	html := `<html><body></body></html>`
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		t.Fatalf("Failed to parse HTML: %v", err)
	}

	result := analyzeSEO(doc, "keyword")
	if result.Score < 0 {
		t.Errorf("Score should not be negative, got %d", result.Score)
	}
}

func TestSEOHandler_EmptyInput(t *testing.T) {
	_, _, err := seoHandler(context.Background(), nil, SEOParams{})
	if err == nil {
		t.Fatal("Expected error for empty input, got nil")
	}
	if !strings.Contains(err.Error(), "either url, html, or path must be provided") {
		t.Errorf("Unexpected error message: %v", err)
	}
}

func TestSEOHandler_HTMLInput(t *testing.T) {
	html := `<html><head><title>A Test Page Title for Direct HTML</title><meta name="description" content="This is a test meta description that has between 120 and 160 characters in total for SEO auditing purposes."><link rel="canonical" href="https://example.com"></head><body><h1>Direct HTML Heading</h1><a href="/home">Link</a>` + perfectBody + `</body></html>`
	_, result, err := seoHandler(context.Background(), nil, SEOParams{HTML: html})
	if err != nil {
		t.Fatalf("seoHandler failed with HTML input: %v", err)
	}
	if result == nil {
		t.Fatal("Expected non-nil result")
	}
	if result.Title != "A Test Page Title for Direct HTML" {
		t.Errorf("Expected title 'A Test Page Title for Direct HTML', got %q", result.Title)
	}
	if result.H1 != "Direct HTML Heading" {
		t.Errorf("Expected H1 'Direct HTML Heading', got %q", result.H1)
	}
}

func TestSEOHandler_PathInput_AbsoluteHTML(t *testing.T) {
	tempDir := t.TempDir()
	htmlPath := filepath.Join(tempDir, "page.html")
	html := `<html><head><title>Absolute Path Test Title Example</title><meta name="description" content="This is a test meta description that has between 120 and 160 characters in total for SEO auditing purposes."><link rel="canonical" href="https://example.com"></head><body><h1>Page from Absolute Path</h1><a href="/test">Link</a>` + perfectBody + `</body></html>`
	if err := os.WriteFile(htmlPath, []byte(html), 0644); err != nil {
		t.Fatalf("Failed to write html file: %v", err)
	}

	_, result, err := seoHandler(context.Background(), nil, SEOParams{Path: htmlPath})
	if err != nil {
		t.Fatalf("seoHandler failed with Path input: %v", err)
	}
	if result == nil {
		t.Fatal("Expected non-nil result")
	}
	if result.Title != "Absolute Path Test Title Example" {
		t.Errorf("Expected title 'Absolute Path Test Title Example', got %q", result.Title)
	}
	if result.H1 != "Page from Absolute Path" {
		t.Errorf("Expected H1 'Page from Absolute Path', got %q", result.H1)
	}
}

func TestSEOHandler_PathInput_RelativeHTML(t *testing.T) {
	tempDir := t.TempDir()
	subDir := filepath.Join(tempDir, "public")
	if err := os.MkdirAll(subDir, 0755); err != nil {
		t.Fatalf("Failed to create sub dir: %v", err)
	}

	htmlPath := filepath.Join(subDir, "about.html")
	html := `<html><head><title>Relative Path Test Title Example</title><meta name="description" content="This is a test meta description that has between 120 and 160 characters in total for SEO auditing purposes."><link rel="canonical" href="https://example.com"></head><body><h1>Page from Relative Path</h1><a href="/test">Link</a>` + perfectBody + `</body></html>`
	if err := os.WriteFile(htmlPath, []byte(html), 0644); err != nil {
		t.Fatalf("Failed to write html file: %v", err)
	}

	cfg := Config{WorkspaceDir: tempDir}
	_, result, err := seoHandler(context.Background(), nil, SEOParams{Path: filepath.Join("public", "about.html")}, cfg)
	if err != nil {
		t.Fatalf("seoHandler failed with relative Path input: %v", err)
	}
	if result == nil {
		t.Fatal("Expected non-nil result")
	}
	if result.Title != "Relative Path Test Title Example" {
		t.Errorf("Expected title 'Relative Path Test Title Example', got %q", result.Title)
	}
	if result.H1 != "Page from Relative Path" {
		t.Errorf("Expected H1 'Page from Relative Path', got %q", result.H1)
	}
}

func TestSEOHandler_PathInput_NonExistentFile(t *testing.T) {
	tempDir := t.TempDir()
	nonExistentPath := filepath.Join(tempDir, "does_not_exist.html")
	_, _, err := seoHandler(context.Background(), nil, SEOParams{Path: nonExistentPath})
	if err == nil {
		t.Fatal("Expected error for non-existent file path, got nil")
	}
	if !strings.Contains(err.Error(), "failed to read file") {
		t.Errorf("Unexpected error message: %v", err)
	}
}

func TestSEOHandler_URLInput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/404" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`<html><head><title>Mock Server Title For Test Purposes</title><meta name="description" content="This is a test meta description that has between 120 and 160 characters in total for SEO auditing purposes."><link rel="canonical" href="https://example.com"></head><body><h1>Server H1 Title</h1><a href="/link">Link</a>` + perfectBody + `</body></html>`))
	}))
	defer server.Close()

	// 1. Success case
	_, result, err := seoHandler(context.Background(), nil, SEOParams{URL: server.URL})
	if err != nil {
		t.Fatalf("seoHandler failed for valid URL: %v", err)
	}
	if result.Title != "Mock Server Title For Test Purposes" {
		t.Errorf("Expected title 'Mock Server Title For Test Purposes', got %q", result.Title)
	}

	// 2. Status code error
	_, _, err = seoHandler(context.Background(), nil, SEOParams{URL: server.URL + "/404"})
	if err == nil {
		t.Fatal("Expected error for 404 URL, got nil")
	}
	if !strings.Contains(err.Error(), "status code: 404") {
		t.Errorf("Unexpected error: %v", err)
	}

	// 3. Network error
	_, _, err = seoHandler(context.Background(), nil, SEOParams{URL: "http://127.0.0.1:0/nonexistent"})
	if err == nil {
		t.Fatal("Expected network error for invalid address, got nil")
	}
}

func TestFindHugoRoot(t *testing.T) {
	configs := []string{"hugo.toml", "hugo.yaml", "hugo.json", "config.toml", "config.yaml", "config.json"}

	for _, cfgName := range configs {
		t.Run(cfgName, func(t *testing.T) {
			tempDir := t.TempDir()
			if err := os.WriteFile(filepath.Join(tempDir, cfgName), []byte(`baseURL = "https://example.org"`), 0644); err != nil {
				t.Fatalf("Failed to write config file %s: %v", cfgName, err)
			}

			// 1. Direct directory
			root, err := findHugoRoot(tempDir)
			if err != nil {
				t.Fatalf("findHugoRoot failed for %s: %v", cfgName, err)
			}
			if root != tempDir {
				t.Errorf("Expected root %s, got %s", tempDir, root)
			}

			// 2. Nested directory
			nestedDir := filepath.Join(tempDir, "content", "posts", "sub")
			if err := os.MkdirAll(nestedDir, 0755); err != nil {
				t.Fatalf("Failed to create nested dir: %v", err)
			}

			root, err = findHugoRoot(nestedDir)
			if err != nil {
				t.Fatalf("findHugoRoot failed from nested dir for %s: %v", cfgName, err)
			}
			if root != tempDir {
				t.Errorf("Expected root %s from nested dir, got %s", tempDir, root)
			}
		})
	}

	t.Run("NoHugoRootFound", func(t *testing.T) {
		tempDir := t.TempDir()
		_, err := findHugoRoot(tempDir)
		if err == nil {
			t.Fatal("Expected error when Hugo root is missing, got nil")
		}
		if !strings.Contains(err.Error(), "hugo root not found") {
			t.Errorf("Unexpected error: %v", err)
		}
	})

	t.Run("EmptyStartDir", func(t *testing.T) {
		// findHugoRoot with "" falls back to current working directory
		cwd, _ := os.Getwd()
		_, err := findHugoRoot("")
		// May or may not find hugo depending on where tests run, but should not crash
		_ = err
		_ = cwd
	})
}

func TestConvertHugoMarkdownToHTML(t *testing.T) {
	tempDir := t.TempDir()

	// Create a dummy hugo.toml
	if err := os.WriteFile(filepath.Join(tempDir, "hugo.toml"), []byte(`baseURL = "http://example.org/"`), 0644); err != nil {
		t.Fatalf("Failed to write hugo.toml: %v", err)
	}

	// Create layouts/_default directory
	if err := os.MkdirAll(filepath.Join(tempDir, "layouts", "_default"), 0755); err != nil {
		t.Fatalf("Failed to create layouts dir: %v", err)
	}

	// Create content directory
	if err := os.Mkdir(filepath.Join(tempDir, "content"), 0755); err != nil {
		t.Fatalf("Failed to create content dir: %v", err)
	}

	// Create a minimal single.html template
	template := `
<html>
<head>
<title>{{ .Title }}</title>
<meta name="description" content="{{ .Description }}">
<link rel="canonical" href="{{ .Permalink }}">
</head>
<body>
<h1>{{ .Title }}</h1>
{{ .Content }}
</body>
</html>
`
	if err := os.WriteFile(filepath.Join(tempDir, "layouts", "_default", "single.html"), []byte(template), 0644); err != nil {
		t.Fatalf("Failed to write template: %v", err)
	}

	markdown := `---
title: "My Hugo Post Title"
description: "This is a description for the Hugo post that is long enough."
canonical: "https://example.com/hugo-post"
---

# Heading 1

This is the body content.
[Link](https://example.com)
`

	html, err := convertHugoMarkdownToHTML(markdown, tempDir)
	if err != nil {
		if strings.Contains(err.Error(), "executable file not found in $PATH") {
			t.Skip("Hugo binary not installed, skipping integration test")
		}
		t.Fatalf("Failed to convert markdown: %v", err)
	}

	if !strings.Contains(html, "<title>My Hugo Post Title</title>") {
		t.Error("HTML missing title from front matter")
	}
	if !strings.Contains(html, `content="This is a description for the Hugo post that is long enough."`) {
		t.Error("HTML missing description from front matter")
	}

	// Test seoHandler with Hugo Markdown directly
	_, res, err := seoHandler(context.Background(), nil, SEOParams{HTML: markdown}, Config{WorkspaceDir: tempDir})
	if err != nil {
		if strings.Contains(err.Error(), "executable file not found in $PATH") {
			t.Skip("Hugo binary not installed, skipping integration test")
		}
		t.Fatalf("seoHandler failed with Hugo markdown HTML: %v", err)
	}
	if res != nil && res.Title != "My Hugo Post Title" {
		t.Errorf("Expected title 'My Hugo Post Title', got %q", res.Title)
	}

	// Test seoHandler with Path pointing to Hugo Markdown file
	mdPath := filepath.Join(tempDir, "content", "post.md")
	if err := os.WriteFile(mdPath, []byte(markdown), 0644); err != nil {
		t.Fatalf("Failed to write md file: %v", err)
	}
	_, res, err = seoHandler(context.Background(), nil, SEOParams{Path: mdPath}, Config{WorkspaceDir: tempDir})
	if err != nil {
		if strings.Contains(err.Error(), "executable file not found in $PATH") {
			t.Skip("Hugo binary not installed, skipping integration test")
		}
		t.Fatalf("seoHandler failed with Hugo markdown Path: %v", err)
	}
	if res != nil && res.Title != "My Hugo Post Title" {
		t.Errorf("Expected title 'My Hugo Post Title', got %q", res.Title)
	}
}

func TestRegister(t *testing.T) {
	server := mcp.NewServer(&mcp.Implementation{Name: "test-server"}, nil)
	Register(server)

	serverWithCfg := mcp.NewServer(&mcp.Implementation{Name: "test-server-2"}, nil)
	Register(serverWithCfg, Config{WorkspaceDir: "/tmp"})
}
