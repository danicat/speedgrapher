// Copyright 2026 Google LLC
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
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/PuerkitoBio/goquery"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gopkg.in/yaml.v3"
)

// Config holds configuration options for the SEO tool.
type Config struct {
	WorkspaceDir string
}

// Register registers the seo tool with the server.
func Register(server *mcp.Server, cfg ...Config) {
	c := resolveConfig(cfg...)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "seo",
		Description: "Performs technical SEO and Generative Engine Optimization (GEO) audits on URLs, HTML, Markdown articles, or Hugo Markdown drafts. Verifies title tags, dual-purpose metadata (summary vs. description), H1 headings, heading hierarchy, image alt text, links, content length, quotability, and canonical URLs.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, input SEOParams) (*mcp.CallToolResult, *SEOResult, error) {
		return Handler(ctx, req, input, c)
	})
}

func resolveConfig(cfg ...Config) Config {
	var c Config
	if len(cfg) > 0 {
		c = cfg[0]
	}
	if c.WorkspaceDir == "" {
		if cwd, err := os.Getwd(); err == nil {
			c.WorkspaceDir = cwd
		} else {
			c.WorkspaceDir = "."
		}
	}
	if absDir, err := filepath.Abs(c.WorkspaceDir); err == nil {
		c.WorkspaceDir = absDir
	}
	return c
}

// SEOParams defines the input parameters for the seo tool.
type SEOParams struct {
	URL     string `json:"url,omitempty" jsonschema:"The full URL of the webpage to audit."`
	HTML    string `json:"html,omitempty" jsonschema:"The raw HTML or Markdown content to audit. Supports standalone Markdown and Hugo Markdown with YAML frontmatter."`
	Path    string `json:"path,omitempty" jsonschema:"Optional absolute or workspace-relative path to an HTML or Markdown file to audit."`
	Keyword string `json:"keyword,omitempty" jsonschema:"The target keyword to check for optimization in the title, description, and headings."`
	DocType string `json:"doc_type,omitempty" jsonschema:"Optional document type override: 'page' for published web pages/blog posts, or 'doc' for repository docs (README.md, AGENTS.md, SKILL.md)."`
}

// SEOCheck represents a single SEO or GEO check result.
type SEOCheck struct {
	Name        string `json:"name"`
	Status      string `json:"status"` // "pass", "fail", "warning"
	Description string `json:"description"`
	ScoreImpact int    `json:"score_impact"`
}

// HeadingItem represents an extracted document heading.
type HeadingItem struct {
	Level int    `json:"level"`
	Text  string `json:"text"`
	Line  int    `json:"line,omitempty"`
}

// SEOMetadata holds dual-purpose metadata telemetry (human card summary vs. search/LLM description).
type SEOMetadata struct {
	Title                    string `json:"title"`
	TitleLength              int    `json:"title_length"`
	Summary                  string `json:"summary"`
	SummaryLength            int    `json:"summary_length"`
	Description              string `json:"description"`
	DescriptionLength        int    `json:"description_length"`
	Canonical                string `json:"canonical,omitempty"`
	SummaryEqualsDescription bool   `json:"summary_equals_description"`
}

// GEOMetrics holds Generative Engine Optimization and structural quotability metrics.
type GEOMetrics struct {
	LeadWordCount        int  `json:"lead_word_count"`
	LeadHasKeyword       bool `json:"lead_has_keyword"`
	LeadHasConcreteClaim bool `json:"lead_has_concrete_claim"`
	CodeBlockCount       int  `json:"code_block_count"`
	UnlabeledCodeBlocks  int  `json:"unlabeled_code_blocks"`
	TableCount           int  `json:"table_count"`
	ListCount            int  `json:"list_count"`
	NumericClaimCount    int  `json:"numeric_claim_count"`
	TitleCaseHeadings    int  `json:"title_case_headings"`
}

// SEOImageIssue represents an image with missing or non-descriptive alt text.
type SEOImageIssue struct {
	Src    string `json:"src"`
	Alt    string `json:"alt,omitempty"`
	Line   int    `json:"line,omitempty"`
	Reason string `json:"reason"`
}

// SEOLinkIssue represents a link with missing, generic, or raw-URL anchor text.
type SEOLinkIssue struct {
	Href   string `json:"href"`
	Anchor string `json:"anchor,omitempty"`
	Line   int    `json:"line,omitempty"`
	Reason string `json:"reason"`
}

// SEOResult defines the structured output for the seo tool.
type SEOResult struct {
	Score       int             `json:"score"`
	GEOScore    int             `json:"geo_score"`
	DocType     string          `json:"doc_type"` // "page" or "doc"
	Title       string          `json:"title"`
	Summary     string          `json:"summary"`
	Description string          `json:"description"`
	H1          string          `json:"h1"`
	WordCount   int             `json:"word_count"`
	Metadata    SEOMetadata     `json:"metadata"`
	GEO         GEOMetrics      `json:"geo"`
	Headings    []HeadingItem   `json:"headings"`
	Checks      []SEOCheck      `json:"checks"`
	GEOChecks   []SEOCheck      `json:"geo_checks"`
	ImageIssues []SEOImageIssue `json:"image_issues"`
	LinkIssues  []SEOLinkIssue  `json:"link_issues"`
}

// FrontMatter defines the structure for Markdown/Hugo Front Matter (YAML or TOML).
type FrontMatter struct {
	Title       string `yaml:"title"`
	Summary     string `yaml:"summary"`
	Description string `yaml:"description"`
	Canonical   string `yaml:"canonical"`
	Slug        string `yaml:"slug"`
	URL         string `yaml:"url"`
	Date        string `yaml:"date"`
	Draft       bool   `yaml:"draft"`
}

// Analyze runs the technical SEO and GEO analysis directly.
func Analyze(ctx context.Context, input SEOParams, cfg ...Config) (*SEOResult, error) {
	_, res, err := seoHandler(ctx, nil, input, cfg...)
	return res, err
}

// Handler executes the seo tool logic.
func Handler(ctx context.Context, req *mcp.CallToolRequest, input SEOParams, cfg ...Config) (*mcp.CallToolResult, *SEOResult, error) {
	return seoHandler(ctx, req, input, cfg...)
}

func isRawHTML(content, filePath string) bool {
	ext := strings.ToLower(filepath.Ext(filePath))
	if ext == ".html" || ext == ".htm" {
		return true
	}
	if ext == ".md" || ext == ".markdown" {
		return false
	}
	lower := strings.ToLower(strings.TrimSpace(content))
	return strings.HasPrefix(lower, "<!doctype html") ||
		strings.HasPrefix(lower, "<html") ||
		strings.Contains(lower, "<head>") ||
		strings.Contains(lower, "<body>")
}

func parseFrontMatter(markdown string) (FrontMatter, string, bool, error) {
	var fm FrontMatter
	trimmed := strings.TrimLeft(markdown, " \t\r\n")
	if strings.HasPrefix(trimmed, "---") {
		rest := trimmed[3:]
		before, after0, ok := strings.Cut(rest, "\n---")
		if !ok {
			return fm, markdown, false, nil
		}
		fmRaw := before
		after := after0
		if err := yaml.Unmarshal([]byte(fmRaw), &fm); err != nil {
			return fm, markdown, true, fmt.Errorf("invalid YAML frontmatter: %w", err)
		}
		return fm, after, true, nil
	}
	if strings.HasPrefix(trimmed, "+++") {
		rest := trimmed[3:]
		before, after0, ok := strings.Cut(rest, "\n+++")
		if !ok {
			return fm, markdown, false, nil
		}
		fmRaw := before
		after := after0
		if err := parseTOMLFrontMatter(fmRaw, &fm); err != nil {
			return fm, markdown, true, fmt.Errorf("invalid TOML frontmatter: %w", err)
		}
		return fm, after, true, nil
	}
	return fm, markdown, false, nil
}

func stripTOMLInlineComment(s string) string {
	inDouble := false
	inSingle := false
	escaped := false
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if escaped {
			escaped = false
			continue
		}
		if ch == '\\' && inDouble {
			escaped = true
			continue
		}
		if ch == '"' && !inSingle {
			inDouble = !inDouble
		} else if ch == '\'' && !inDouble {
			inSingle = !inSingle
		} else if ch == '#' && !inDouble && !inSingle {
			return strings.TrimSpace(s[:i])
		}
	}
	return strings.TrimSpace(s)
}

func parseTOMLFrontMatter(raw string, fm *FrontMatter) error {
	currentSection := ""
	lines := strings.Split(raw, "\n")
	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") {
			if !strings.HasSuffix(line, "]") {
				return fmt.Errorf("unclosed table header %q on line %d", line, i+1)
			}
			currentSection = strings.TrimSpace(strings.Trim(line, "[]"))
			continue
		}
		before, after, ok := strings.Cut(line, "=")
		if !ok {
			return fmt.Errorf("expected key = value on line %d: %q", i+1, line)
		}
		key := strings.ToLower(strings.TrimSpace(before))
		if key == "" {
			return fmt.Errorf("empty key on line %d", i+1)
		}
		valRaw := strings.TrimSpace(after)
		if valRaw == "" {
			return fmt.Errorf("empty value for key %q on line %d", key, i+1)
		}

		if strings.HasPrefix(valRaw, "[") {
			for !strings.HasSuffix(stripTOMLInlineComment(valRaw), "]") {
				i++
				if i >= len(lines) {
					return fmt.Errorf("unclosed array for key %q", key)
				}
				valRaw += " " + strings.TrimSpace(lines[i])
			}
			continue
		}

		var strVal string
		var isBool bool
		var boolVal bool
		switch {
		case strings.HasPrefix(valRaw, `"""`):
			rest := valRaw[3:]
			for !strings.Contains(rest, `"""`) {
				i++
				if i >= len(lines) {
					return fmt.Errorf("unclosed multi-line string for key %q", key)
				}
				rest += "\n" + lines[i]
			}
			endIdx := strings.Index(rest, `"""`)
			strVal = strings.TrimSpace(rest[:endIdx])
		case strings.HasPrefix(valRaw, `'''`):
			rest := valRaw[3:]
			for !strings.Contains(rest, `'''`) {
				i++
				if i >= len(lines) {
					return fmt.Errorf("unclosed multi-line literal string for key %q", key)
				}
				rest += "\n" + lines[i]
			}
			endIdx := strings.Index(rest, `'''`)
			strVal = strings.TrimSpace(rest[:endIdx])
		case strings.HasPrefix(valRaw, `"`):
			unquoted, err := strconv.Unquote(stripTOMLInlineComment(valRaw))
			if err != nil {
				return fmt.Errorf("invalid quoted string for key %q: %w", key, err)
			}
			strVal = unquoted
		case strings.HasPrefix(valRaw, `'`):
			cleaned := stripTOMLInlineComment(valRaw)
			if len(cleaned) < 2 || !strings.HasSuffix(cleaned, `'`) {
				return fmt.Errorf("unclosed single-quoted string for key %q", key)
			}
			strVal = cleaned[1 : len(cleaned)-1]
		default:
			cleaned := stripTOMLInlineComment(valRaw)
			if cleaned == "true" || cleaned == "false" {
				isBool = true
				boolVal = (cleaned == "true")
				strVal = cleaned
			} else if strings.ContainsAny(cleaned, " \t\"'[]") {
				return fmt.Errorf("invalid unquoted TOML value %q for key %q", cleaned, key)
			} else {
				strVal = cleaned
			}
		}

		if currentSection != "" {
			continue
		}

		switch key {
		case "title":
			fm.Title = strVal
		case "summary":
			fm.Summary = strVal
		case "description":
			fm.Description = strVal
		case "canonical":
			fm.Canonical = strVal
		case "slug":
			fm.Slug = strVal
		case "url":
			fm.URL = strVal
		case "date":
			fm.Date = strVal
		case "draft":
			if !isBool {
				return fmt.Errorf("expected boolean for draft in TOML frontmatter, got %q", strVal)
			}
			fm.Draft = boolVal
		}
	}
	return nil
}

func resolveDocType(explicitDocType string, isURL bool, rawContent, filePath, searchDir string) (string, error) {
	if !isURL && !isRawHTML(rawContent, filePath) {
		fm, _, hasFM, err := parseFrontMatter(rawContent)
		if err != nil {
			return "", err
		}
		switch strings.ToLower(strings.TrimSpace(explicitDocType)) {
		case "page":
			return "page", nil
		case "doc":
			return "doc", nil
		}
		if hasFM {
			if _, hugoErr := findHugoRoot(searchDir); hugoErr == nil {
				return "page", nil
			}
			if strings.TrimSpace(fm.Title) != "" || strings.TrimSpace(fm.Canonical) != "" || strings.TrimSpace(fm.Summary) != "" {
				return "page", nil
			}
		}
		return "doc", nil
	}

	switch strings.ToLower(strings.TrimSpace(explicitDocType)) {
	case "page":
		return "page", nil
	case "doc":
		return "doc", nil
	}
	return "page", nil
}

func extractMarkdownHeadings(markdown string) []HeadingItem {
	headings := []HeadingItem{}
	lines := strings.Split(markdown, "\n")
	inFrontmatter := false
	inFence := false

	for idx, rawLine := range lines {
		lineNum := idx + 1
		trimmed := strings.TrimSpace(rawLine)

		if idx == 0 && (trimmed == "---" || trimmed == "+++") {
			inFrontmatter = true
			continue
		}
		if inFrontmatter {
			if trimmed == "---" || trimmed == "..." || trimmed == "+++" {
				inFrontmatter = false
			}
			continue
		}

		if strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~") {
			inFence = !inFence
			continue
		}
		if inFence || trimmed == "" {
			continue
		}

		if strings.HasPrefix(trimmed, "#") {
			level := 0
			for level < len(trimmed) && trimmed[level] == '#' {
				level++
			}
			if level >= 1 && level <= 6 && level < len(trimmed) && trimmed[level] == ' ' {
				headingText := strings.TrimSpace(trimmed[level+1:])
				headings = append(headings, HeadingItem{
					Level: level,
					Text:  headingText,
					Line:  lineNum,
				})
			}
		}
	}
	return headings
}

func extractHTMLHeadings(doc *goquery.Document) []HeadingItem {
	headings := []HeadingItem{}
	doc.Find("h1, h2, h3, h4, h5, h6").Each(func(_ int, s *goquery.Selection) {
		nodeName := strings.ToLower(goquery.NodeName(s))
		if len(nodeName) == 2 && nodeName[0] == 'h' {
			level := int(nodeName[1] - '0')
			if level >= 1 && level <= 6 {
				headings = append(headings, HeadingItem{
					Level: level,
					Text:  strings.TrimSpace(s.Text()),
				})
			}
		}
	})
	return headings
}

func renderContentToHTML(ctx context.Context, content, filePath, searchDir, docType string) (string, error) {
	if isRawHTML(content, filePath) {
		return content, nil
	}

	_, _, hasFM, err := parseFrontMatter(content)
	if err != nil {
		return "", err
	}

	// If inside a Hugo repository, docType is not "doc", and the Markdown has frontmatter (YAML or TOML), render with Hugo CLI.
	if docType != "doc" && hasFM {
		if _, err := findHugoRoot(searchDir); err == nil {
			return convertHugoMarkdownToHTML(ctx, content, searchDir)
		}
	}

	return convertMarkdownToHTML(content)
}

var (
	mdHugoImagePattern = regexp.MustCompile(`(?s)!\[([^\]]*)\]\(\s*(\{\{.*?\}\})\s*\)`)
	mdHugoLinkPattern  = regexp.MustCompile(`(?s)\[([^\]]+)\]\(\s*(\{\{.*?\}\})\s*\)`)
	mdImagePattern     = regexp.MustCompile(`!\[([^\]]*)\]\(([^)]+)\)`)
	mdLinkPattern      = regexp.MustCompile(`\[([^\]]+)\]\(([^)]+)\)`)
	hugoShortcodeStrip = regexp.MustCompile(`(?s)\{\{.*?\}\}`)
	htmlCommentStrip   = regexp.MustCompile(`(?s)<!--.*?-->`)
	numericClaimRe     = regexp.MustCompile(`\b\d+(?:\.\d+)?(?:\s*(?:%|ms|ns|us|s|x|MB|GB|KB|KiB|MiB|fps|req/s|ops/s|words|chars))?\b`)
	mdTableSepLineRe   = regexp.MustCompile(`^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$`)
	mdListLineRe       = regexp.MustCompile(`^\s*(?:[-*+]|\d+[.)])\s+`)
)

func hasMarkdownH1(body string) bool {
	inFence := false
	for rawLine := range strings.SplitSeq(body, "\n") {
		line := strings.TrimSpace(rawLine)
		if strings.HasPrefix(line, "```") || strings.HasPrefix(line, "~~~") {
			inFence = !inFence
			continue
		}
		if inFence || line == "" {
			continue
		}
		if strings.HasPrefix(line, "# ") {
			return true
		}
	}
	return false
}

// convertMarkdownToHTML converts standalone Markdown (with optional YAML or TOML frontmatter)
// into a semantic HTML document so goquery can audit title, meta description, canonical,
// headings, image alt text, links, and word count deterministically.
func convertMarkdownToHTML(markdown string) (string, error) {
	fm, body, _, err := parseFrontMatter(markdown)
	if err != nil {
		return "", err
	}
	body = htmlCommentStrip.ReplaceAllString(body, "")

	var headBuilder strings.Builder
	if strings.TrimSpace(fm.Title) != "" {
		headBuilder.WriteString("<title>" + html.EscapeString(strings.TrimSpace(fm.Title)) + "</title>\n")
	}
	if strings.TrimSpace(fm.Summary) != "" {
		headBuilder.WriteString(`<meta name="summary" content="` + html.EscapeString(strings.TrimSpace(fm.Summary)) + `">` + "\n")
	}
	if strings.TrimSpace(fm.Description) != "" {
		headBuilder.WriteString(`<meta name="description" content="` + html.EscapeString(strings.TrimSpace(fm.Description)) + `">` + "\n")
	}
	if strings.TrimSpace(fm.Canonical) != "" {
		headBuilder.WriteString(`<link rel="canonical" href="` + html.EscapeString(strings.TrimSpace(fm.Canonical)) + `">` + "\n")
	}

	var bodyBuilder strings.Builder
	if strings.TrimSpace(fm.Title) != "" && !hasMarkdownH1(body) {
		bodyBuilder.WriteString("<h1>" + html.EscapeString(strings.TrimSpace(fm.Title)) + "</h1>\n")
	}

	inFence := false
	for rawLine := range strings.SplitSeq(body, "\n") {
		line := strings.TrimSpace(rawLine)
		if strings.HasPrefix(line, "```") || strings.HasPrefix(line, "~~~") {
			inFence = !inFence
			continue
		}
		if inFence || line == "" {
			continue
		}

		// Extract images first and replace them in line so their brackets aren't matched as links
		hugoImagesMatches := mdHugoImagePattern.FindAllStringSubmatch(line, -1)
		for _, m := range hugoImagesMatches {
			altText := html.EscapeString(m[1])
			srcText := html.EscapeString(m[2])
			bodyBuilder.WriteString(fmt.Sprintf(`<img src="%s" alt="%s">`, srcText, altText) + "\n")
		}
		lineWithoutImages := mdHugoImagePattern.ReplaceAllString(line, "")
		imagesMatches := mdImagePattern.FindAllStringSubmatch(lineWithoutImages, -1)
		for _, m := range imagesMatches {
			altText := html.EscapeString(m[1])
			srcText := html.EscapeString(m[2])
			bodyBuilder.WriteString(fmt.Sprintf(`<img src="%s" alt="%s">`, srcText, altText) + "\n")
		}
		lineWithoutImages = mdImagePattern.ReplaceAllString(lineWithoutImages, "")

		// Extract links (including Hugo shortcode links)
		hugoLinkMatches := mdHugoLinkPattern.FindAllStringSubmatch(lineWithoutImages, -1)
		for _, m := range hugoLinkMatches {
			label := html.EscapeString(m[1])
			href := html.EscapeString(m[2])
			bodyBuilder.WriteString(fmt.Sprintf(`<a href="%s">%s</a>`, href, label) + "\n")
		}
		lineAfterHugoLinks := mdHugoLinkPattern.ReplaceAllString(lineWithoutImages, "$1")
		linkMatches := mdLinkPattern.FindAllStringSubmatch(lineAfterHugoLinks, -1)
		for _, m := range linkMatches {
			label := html.EscapeString(m[1])
			href := html.EscapeString(m[2])
			bodyBuilder.WriteString(fmt.Sprintf(`<a href="%s">%s</a>`, href, label) + "\n")
		}

		// Check ATX headings (# Heading)
		if strings.HasPrefix(line, "#") {
			level := 0
			for level < len(line) && line[level] == '#' {
				level++
			}
			if level >= 1 && level <= 6 && level < len(line) && line[level] == ' ' {
				headingText := strings.TrimSpace(hugoShortcodeStrip.ReplaceAllString(line[level+1:], ""))
				_, _ = fmt.Fprintf(&bodyBuilder, "<h%d>%s</h%d>\n", level, html.EscapeString(headingText), level)
				continue
			}
		}

		// Plain text line for word count
		cleanLine := mdLinkPattern.ReplaceAllString(lineAfterHugoLinks, "$1")
		cleanLine = strings.TrimSpace(hugoShortcodeStrip.ReplaceAllString(cleanLine, " "))
		if cleanLine != "" {
			bodyBuilder.WriteString("<p>" + html.EscapeString(cleanLine) + "</p>\n")
		}
	}

	return fmt.Sprintf("<html><head>\n%s</head><body>\n%s</body></html>", headBuilder.String(), bodyBuilder.String()), nil
}

func seoHandler(ctx context.Context, _ *mcp.CallToolRequest, input SEOParams, cfg ...Config) (*mcp.CallToolResult, *SEOResult, error) {
	c := resolveConfig(cfg...)
	var doc *goquery.Document
	var err error
	var rawContent string
	var docType string

	searchDir := c.WorkspaceDir
	var resolvedFilePath string
	if input.Path != "" {
		filePath := input.Path
		if !filepath.IsAbs(filePath) {
			filePath = filepath.Join(c.WorkspaceDir, filePath)
		}
		absPath, absErr := filepath.Abs(filePath)
		if absErr != nil {
			return nil, nil, fmt.Errorf("failed to resolve path %s: %w", input.Path, absErr)
		}
		resolvedFilePath = absPath
		searchDir = filepath.Dir(absPath)
	}

	if input.URL != "" {
		u, parseErr := url.Parse(input.URL)
		if parseErr != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return nil, nil, fmt.Errorf("invalid URL %q: scheme must be http or https", input.URL)
		}
		host := strings.ToLower(u.Hostname())
		if host == "169.254.169.254" || host == "metadata.google.internal" || strings.HasPrefix(host, "169.254.") {
			return nil, nil, fmt.Errorf("blocked URL host %q: link-local and cloud metadata addresses are not allowed", host)
		}
		req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, input.URL, nil)
		if reqErr != nil {
			return nil, nil, fmt.Errorf("failed to create HTTP request: %w", reqErr)
		}
		client := &http.Client{Timeout: 15 * time.Second}
		resp, fetchErr := client.Do(req)
		if fetchErr != nil {
			return nil, nil, fmt.Errorf("failed to fetch URL: %w", fetchErr)
		}
		defer func() { _ = resp.Body.Close() }()
		if resp.StatusCode != http.StatusOK {
			return nil, nil, fmt.Errorf("failed to fetch URL, status code: %d", resp.StatusCode)
		}
		docType, err = resolveDocType(input.DocType, true, "", "", searchDir)
		if err != nil {
			return nil, nil, err
		}
		doc, err = goquery.NewDocumentFromReader(io.LimitReader(resp.Body, 10*1024*1024))
	} else if input.HTML != "" {
		rawContent = input.HTML
		var docErr error
		docType, docErr = resolveDocType(input.DocType, false, rawContent, resolvedFilePath, searchDir)
		if docErr != nil {
			return nil, nil, fmt.Errorf("failed to render content for SEO analysis: %w", docErr)
		}
		htmlContent, convErr := renderContentToHTML(ctx, rawContent, resolvedFilePath, searchDir, docType)
		if convErr != nil {
			return nil, nil, fmt.Errorf("failed to render content for SEO analysis: %w", convErr)
		}
		doc, err = goquery.NewDocumentFromReader(strings.NewReader(htmlContent))
	} else if resolvedFilePath != "" {
		data, readErr := os.ReadFile(resolvedFilePath)
		if readErr != nil {
			return nil, nil, fmt.Errorf("failed to read file %s: %w", resolvedFilePath, readErr)
		}
		rawContent = string(data)
		var docErr error
		docType, docErr = resolveDocType(input.DocType, false, rawContent, resolvedFilePath, searchDir)
		if docErr != nil {
			return nil, nil, fmt.Errorf("failed to render %s for SEO analysis: %w", resolvedFilePath, docErr)
		}
		htmlContent, convErr := renderContentToHTML(ctx, rawContent, resolvedFilePath, searchDir, docType)
		if convErr != nil {
			return nil, nil, fmt.Errorf("failed to render %s for SEO analysis: %w", resolvedFilePath, convErr)
		}
		doc, err = goquery.NewDocumentFromReader(strings.NewReader(htmlContent))
	} else {
		return nil, nil, fmt.Errorf("either url, html, or path must be provided")
	}

	if err != nil {
		return nil, nil, fmt.Errorf("failed to parse HTML: %w", err)
	}

	var headings []HeadingItem
	if rawContent != "" && !isRawHTML(rawContent, resolvedFilePath) {
		headings = extractMarkdownHeadings(rawContent)
		fm, _, hasFM, fmErr := parseFrontMatter(rawContent)
		if fmErr != nil {
			return nil, nil, fmErr
		}
		if hasFM && strings.TrimSpace(fm.Title) != "" {
			hasH1 := false
			for _, h := range headings {
				if h.Level == 1 {
					hasH1 = true
					break
				}
			}
			if !hasH1 {
				headings = append([]HeadingItem{{
					Level: 1,
					Text:  strings.TrimSpace(fm.Title),
				}}, headings...)
			}
		}
	} else {
		headings = extractHTMLHeadings(doc)
	}

	var result *SEOResult
	if docType == "doc" {
		result = analyzeDocStructure(doc, headings, input.Keyword)
	} else {
		result = analyzeSEO(doc, input.Keyword)
		result.DocType = "page"
		result.Headings = headings
	}

	if err := enrichWithGEO(result, doc, rawContent, resolvedFilePath, input.Keyword); err != nil {
		return nil, nil, err
	}
	return nil, result, nil
}

func findHugoRoot(startDir string) (string, error) {
	if startDir == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return "", err
		}
		startDir = cwd
	}
	absDir, err := filepath.Abs(startDir)
	if err != nil {
		return "", fmt.Errorf("failed to resolve absolute path for %s: %w", startDir, err)
	}
	curr := absDir
	for {
		for _, config := range []string{"hugo.toml", "hugo.yaml", "hugo.json", "config.toml", "config.yaml", "config.json"} {
			if _, err := os.Stat(filepath.Join(curr, config)); err == nil {
				return curr, nil
			}
		}
		parent := filepath.Dir(curr)
		if parent == curr {
			break
		}
		curr = parent
	}
	return "", fmt.Errorf("hugo root not found")
}

func convertHugoMarkdownToHTML(ctx context.Context, markdown string, workspaceDir string) (string, error) {
	fm, _, hasFM, err := parseFrontMatter(markdown)
	if err != nil {
		return "", err
	}

	root, err := findHugoRoot(workspaceDir)
	if err != nil {
		return "", fmt.Errorf("hugo root not found: %w", err)
	}

	contentDir := filepath.Join(root, "content")
	if err := os.MkdirAll(contentDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create content dir: %w", err)
	}

	// Create a unique temp file in content
	tmpFile, err := os.CreateTemp(contentDir, "speedgrapher_seo_*.md")
	if err != nil {
		return "", fmt.Errorf("failed to create temp markdown: %w", err)
	}
	tempFilePath := tmpFile.Name()
	defer func() { _ = os.Remove(tempFilePath) }()

	if _, err := tmpFile.WriteString(markdown); err != nil {
		_ = tmpFile.Close()
		return "", fmt.Errorf("failed to write temp markdown: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		return "", fmt.Errorf("failed to close temp markdown: %w", err)
	}

	tempOut, err := os.MkdirTemp("", "speedgrapher_hugo_out")
	if err != nil {
		return "", fmt.Errorf("failed to create temp out dir: %w", err)
	}
	defer func() { _ = os.RemoveAll(tempOut) }()

	tempOutAbs, err := filepath.Abs(tempOut)
	if err == nil {
		tempOut = tempOutAbs
	}

	baseName := strings.TrimSuffix(filepath.Base(tempFilePath), filepath.Ext(tempFilePath))
	targetSlug := strings.ToLower(baseName)
	if hasFM {
		if strings.TrimSpace(fm.URL) != "" {
			targetSlug = strings.Trim(strings.TrimSpace(fm.URL), "/")
		} else if strings.TrimSpace(fm.Slug) != "" {
			targetSlug = strings.TrimSpace(fm.Slug)
		}
	}

	renderedPath := filepath.Join(tempOut, targetSlug, "index.html")
	cleanTempOut := filepath.Clean(tempOut)
	cleanRendered := filepath.Clean(renderedPath)
	if !strings.HasPrefix(cleanRendered, cleanTempOut+string(filepath.Separator)) {
		return "", fmt.Errorf("invalid frontmatter slug/url %q: path escapes Hugo output directory", targetSlug)
	}

	// Run hugo with --buildDrafts, --buildFuture, and --buildExpired so draft and scheduled posts render properly
	hugoCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(hugoCtx, "hugo", "--buildDrafts", "--buildFuture", "--buildExpired", "--destination", tempOut, "--quiet")
	cmd.Dir = root
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("hugo failed: %s (error: %w)", string(out), err)
	}

	htmlBytes, err := os.ReadFile(cleanRendered)
	if err != nil {
		return "", fmt.Errorf("expected rendered Hugo output at %s not found: %w", cleanRendered, err)
	}

	return string(htmlBytes), nil
}

func analyzeSEO(doc *goquery.Document, keyword string) *SEOResult {
	checks := []SEOCheck{}
	score := 100
	keyword = strings.ToLower(keyword)

	// 1. Title Check
	title := strings.TrimSpace(doc.Find("title").Text())
	titleCheck := SEOCheck{Name: "Title Tag", Status: "pass", Description: "Title tag exists and is within optimal length."}
	if title == "" {
		titleCheck.Status = "fail"
		titleCheck.Description = "Title tag is missing."
		titleCheck.ScoreImpact -= 10
		score -= 10
	} else if len(title) < 30 || len(title) > 60 {
		titleCheck.Status = "warning"
		titleCheck.Description = fmt.Sprintf("Title length (%d) is not optimal (30-60 chars).", len(title))
		titleCheck.ScoreImpact -= 5
		score -= 5
	}
	if keyword != "" && !strings.Contains(strings.ToLower(title), keyword) {
		titleCheck.Status = "warning"
		titleCheck.Description += fmt.Sprintf(" Keyword '%s' not found in title.", keyword)
		titleCheck.ScoreImpact -= 5
		score -= 5
	}
	checks = append(checks, titleCheck)

	// 2. Meta Description Check
	desc := ""
	doc.Find("meta[name='description']").Each(func(i int, s *goquery.Selection) {
		if content, exists := s.Attr("content"); exists {
			desc = strings.TrimSpace(content)
		}
	})
	descCheck := SEOCheck{Name: "Meta Description", Status: "pass", Description: "Meta description exists and is within optimal length."}
	if desc == "" {
		descCheck.Status = "fail"
		descCheck.Description = "Meta description is missing."
		descCheck.ScoreImpact -= 10
		score -= 10
	} else if len(desc) < 120 || len(desc) > 160 {
		descCheck.Status = "warning"
		descCheck.Description = fmt.Sprintf("Description length (%d) is not optimal (120-160 chars).", len(desc))
		descCheck.ScoreImpact -= 5
		score -= 5
	}
	if keyword != "" && !strings.Contains(strings.ToLower(desc), keyword) {
		descCheck.Status = "warning"
		descCheck.Description += fmt.Sprintf(" Keyword '%s' not found in description.", keyword)
		descCheck.ScoreImpact -= 5
		score -= 5
	}
	checks = append(checks, descCheck)

	// 3. H1 Check
	h1s := doc.Find("h1")
	h1Text := ""
	h1Check := SEOCheck{Name: "H1 Tag", Status: "pass", Description: "Exactly one H1 tag exists."}
	if h1s.Length() == 0 {
		h1Check.Status = "fail"
		h1Check.Description = "No H1 tag found."
		h1Check.ScoreImpact -= 10
		score -= 10
	} else if h1s.Length() > 1 {
		h1Check.Status = "warning"
		h1Check.Description = fmt.Sprintf("Found %d H1 tags. There should be exactly one.", h1s.Length())
		h1Check.ScoreImpact -= 5
		score -= 5
		h1Text = strings.TrimSpace(h1s.First().Text())
	} else {
		h1Text = strings.TrimSpace(h1s.First().Text())
	}
	if keyword != "" && h1Text != "" && !strings.Contains(strings.ToLower(h1Text), keyword) {
		h1Check.Status = "warning"
		h1Check.Description += fmt.Sprintf(" Keyword '%s' not found in H1.", keyword)
		h1Check.ScoreImpact -= 5
		score -= 5
	}
	checks = append(checks, h1Check)

	// 4. Images Alt Text
	imgs := doc.Find("img")
	missingAlt := 0
	imgs.Each(func(i int, s *goquery.Selection) {
		if alt, exists := s.Attr("alt"); !exists || strings.TrimSpace(alt) == "" {
			missingAlt++
		}
	})
	imgCheck := SEOCheck{Name: "Image Alt Text", Status: "pass", Description: "All images have alt text."}
	if missingAlt > 0 {
		imgCheck.Status = "warning"
		imgCheck.Description = fmt.Sprintf("%d images are missing alt text.", missingAlt)
		imgCheck.ScoreImpact = -5
		score -= 5
	}
	checks = append(checks, imgCheck)

	// 5. Links
	links := doc.Find("a")
	linkCheck := SEOCheck{Name: "Links", Status: "pass", Description: fmt.Sprintf("Found %d links.", links.Length())}
	if links.Length() == 0 {
		linkCheck.Status = "warning"
		linkCheck.Description = "No links found on the page."
		linkCheck.ScoreImpact = -5
		score -= 5
	}
	checks = append(checks, linkCheck)

	// 6. Word Count (Simple approximation)
	bodyText := strings.TrimSpace(doc.Find("body").Text())
	words := strings.Fields(bodyText)
	wordCount := len(words)
	wordCheck := SEOCheck{Name: "Content Length", Status: "pass", Description: fmt.Sprintf("Content length is good (%d words).", wordCount)}
	if wordCount < 300 {
		wordCheck.Status = "warning"
		wordCheck.Description = fmt.Sprintf("Content is thin (%d words). Aim for at least 300 words.", wordCount)
		wordCheck.ScoreImpact = -10
		score -= 10
	}
	checks = append(checks, wordCheck)

	// 7. Canonical Tag
	canonical := ""
	doc.Find("link[rel='canonical']").Each(func(i int, s *goquery.Selection) {
		if href, exists := s.Attr("href"); exists {
			canonical = href
		}
	})
	canonCheck := SEOCheck{Name: "Canonical Tag", Status: "pass", Description: "Canonical tag exists."}
	if canonical == "" {
		canonCheck.Status = "warning"
		canonCheck.Description = "Canonical tag is missing."
		canonCheck.ScoreImpact = -5
		score -= 5
	}
	checks = append(checks, canonCheck)

	if score < 0 {
		score = 0
	}

	headings := extractHTMLHeadings(doc)
	return &SEOResult{
		Score:       score,
		DocType:     "page",
		Title:       title,
		Description: desc,
		H1:          h1Text,
		WordCount:   wordCount,
		Headings:    headings,
		Checks:      checks,
	}
}

func analyzeDocStructure(doc *goquery.Document, headings []HeadingItem, keyword string) *SEOResult {
	if headings == nil {
		headings = []HeadingItem{}
	}
	checks := []SEOCheck{}
	score := 100
	keyword = strings.ToLower(strings.TrimSpace(keyword))

	// Extract H1 and WordCount
	h1s := doc.Find("h1")
	h1Text := ""
	if h1s.Length() > 0 {
		h1Text = strings.TrimSpace(h1s.First().Text())
	}

	title := strings.TrimSpace(doc.Find("title").Text())
	if title == "" {
		title = h1Text
	}
	desc := ""
	doc.Find("meta[name='description']").Each(func(_ int, s *goquery.Selection) {
		if content, exists := s.Attr("content"); exists {
			desc = strings.TrimSpace(content)
		}
	})

	bodyText := strings.TrimSpace(doc.Find("body").Text())
	wordCount := len(strings.Fields(bodyText))

	// 1. H1 Heading
	h1Check := SEOCheck{Name: "H1 Heading", Status: "pass", Description: "Document has a single top-level H1 heading."}
	if h1s.Length() == 0 {
		h1Check.Status = "fail"
		h1Check.Description = "No H1 heading found."
		h1Check.ScoreImpact = -15
		score -= 15
	} else if h1s.Length() > 1 {
		h1Check.Status = "warning"
		h1Check.Description = fmt.Sprintf("Found %d H1 headings. Use a single top-level H1.", h1s.Length())
		h1Check.ScoreImpact = -10
		score -= 10
	}
	if keyword != "" && h1Text != "" && !strings.Contains(strings.ToLower(h1Text), keyword) {
		if h1Check.Status == "pass" {
			h1Check.Status = "warning"
			h1Check.Description = fmt.Sprintf("Keyword '%s' not found in H1 heading.", keyword)
		} else {
			h1Check.Description += fmt.Sprintf(" Keyword '%s' not found in H1 heading.", keyword)
		}
		h1Check.ScoreImpact -= 5
		score -= 5
	}
	checks = append(checks, h1Check)

	// 2. Heading Hierarchy
	hierarchyCheck := SEOCheck{Name: "Heading Hierarchy", Status: "pass", Description: "Headings follow a sequential hierarchy without skipping levels."}
	var hierarchyViolation string
	prevLevel := 0
	for i, h := range headings {
		if i == 0 && h.Level > 1 {
			hierarchyViolation = fmt.Sprintf("First heading %q starts at H%d instead of H1.", h.Text, h.Level)
			break
		}
		if prevLevel > 0 && h.Level > prevLevel+1 {
			hierarchyViolation = fmt.Sprintf("Heading %q (H%d) skips a level after H%d.", h.Text, h.Level, prevLevel)
			break
		}
		prevLevel = h.Level
	}
	if hierarchyViolation != "" {
		hierarchyCheck.Status = "warning"
		hierarchyCheck.Description = hierarchyViolation
		hierarchyCheck.ScoreImpact = -10
		score -= 10
	}
	checks = append(checks, hierarchyCheck)

	// 3. Section Structure
	h2Count := doc.Find("h2").Length()
	sectionCheck := SEOCheck{Name: "Section Structure", Status: "pass", Description: "Document is organized with H2 section headings."}
	if wordCount >= 100 && h2Count == 0 {
		sectionCheck.Status = "warning"
		sectionCheck.Description = fmt.Sprintf("Document has %d words but no H2 section headings.", wordCount)
		sectionCheck.ScoreImpact = -5
		score -= 5
	} else if h2Count == 0 {
		sectionCheck.Description = "Short document does not require H2 section headings."
	}
	checks = append(checks, sectionCheck)

	// 4. Image Alt Text
	imgs := doc.Find("img")
	missingAlt := 0
	imgs.Each(func(_ int, s *goquery.Selection) {
		if alt, exists := s.Attr("alt"); !exists || strings.TrimSpace(alt) == "" {
			missingAlt++
		}
	})
	imgCheck := SEOCheck{Name: "Image Alt Text", Status: "pass", Description: "All images have descriptive alt text."}
	if missingAlt > 0 {
		imgCheck.Status = "warning"
		imgCheck.Description = fmt.Sprintf("%d images are missing alt text.", missingAlt)
		imgCheck.ScoreImpact = -5
		score -= 5
	}
	checks = append(checks, imgCheck)

	// 5. Link Hygiene
	genericAnchors := map[string]bool{
		"click here": true,
		"here":       true,
		"link":       true,
	}
	badLinks := 0
	doc.Find("a").Each(func(_ int, s *goquery.Selection) {
		anchor := strings.ToLower(strings.TrimSpace(s.Text()))
		if anchor == "" || genericAnchors[anchor] {
			badLinks++
		}
	})
	linkCheck := SEOCheck{Name: "Link Hygiene", Status: "pass", Description: "All links use descriptive anchor text."}
	if badLinks > 0 {
		linkCheck.Status = "warning"
		linkCheck.Description = fmt.Sprintf("%d links have empty or generic anchor text (e.g., 'click here', 'here', 'link').", badLinks)
		linkCheck.ScoreImpact = -5
		score -= 5
	}
	checks = append(checks, linkCheck)

	if score < 0 {
		score = 0
	}

	return &SEOResult{
		Score:       score,
		DocType:     "doc",
		Title:       title,
		Description: desc,
		H1:          h1Text,
		WordCount:   wordCount,
		Headings:    headings,
		Checks:      checks,
	}
}

func isTitleCaseHeading(text string) bool {
	words := strings.Fields(text)
	if len(words) < 3 {
		return false
	}
	minor := map[string]bool{
		"a": true, "an": true, "the": true, "and": true, "but": true, "or": true, "for": true, "nor": true,
		"on": true, "at": true, "to": true, "from": true, "by": true, "in": true, "of": true, "with": true, "as": true, "vs": true, "vs.": true,
	}
	majorCount := 0
	capitalizedMajor := 0
	for i, w := range words {
		if i == 0 {
			continue
		}
		clean := strings.Trim(w, "\"'()[]{}:;,.!?")
		if clean == "" || minor[strings.ToLower(clean)] {
			continue
		}
		// Skip ALL-CAPS acronyms (e.g. API, SEO, GEO, JSON)
		allUpper := true
		for _, r := range clean {
			if unicode.IsLetter(r) && !unicode.IsUpper(r) {
				allUpper = false
				break
			}
		}
		if allUpper && len(clean) >= 2 {
			continue
		}
		majorCount++
		firstRune := []rune(clean)[0]
		if unicode.IsUpper(firstRune) {
			capitalizedMajor++
		}
	}
	return majorCount >= 2 && capitalizedMajor == majorCount
}

func enrichWithGEO(res *SEOResult, doc *goquery.Document, rawContent, filePath, keyword string) error {
	kwLower := strings.ToLower(strings.TrimSpace(keyword))

	summary := ""
	doc.Find("meta[name='summary'], meta[property='og:description']").Each(func(_ int, s *goquery.Selection) {
		if summary == "" {
			if content, exists := s.Attr("content"); exists {
				summary = strings.TrimSpace(content)
			}
		}
	})
	canonical := ""
	doc.Find("link[rel='canonical']").Each(func(_ int, s *goquery.Selection) {
		if href, exists := s.Attr("href"); exists {
			canonical = strings.TrimSpace(href)
		}
	})

	if rawContent != "" && !isRawHTML(rawContent, filePath) {
		fm, _, hasFM, err := parseFrontMatter(rawContent)
		if err != nil {
			return err
		}
		if hasFM {
			if strings.TrimSpace(fm.Summary) != "" {
				summary = strings.TrimSpace(fm.Summary)
			}
			if canonical == "" && strings.TrimSpace(fm.Canonical) != "" {
				canonical = strings.TrimSpace(fm.Canonical)
			}
		}
	}

	res.Summary = summary
	summaryEqualsDesc := summary != "" && res.Description != "" && strings.EqualFold(summary, res.Description)
	res.Metadata = SEOMetadata{
		Title:                    res.Title,
		TitleLength:              len(res.Title),
		Summary:                  summary,
		SummaryLength:            len(summary),
		Description:              res.Description,
		DescriptionLength:        len(res.Description),
		Canonical:                canonical,
		SummaryEqualsDescription: summaryEqualsDesc,
	}

	// Compute GEO metrics & line-indexed image/link issues
	var geo GEOMetrics
	imageIssues := []SEOImageIssue{}
	linkIssues := []SEOLinkIssue{}
	genericAnchors := map[string]bool{
		"click here": true,
		"here":       true,
		"link":       true,
		"read more":  true,
		"this":       true,
	}

	if rawContent != "" && !isRawHTML(rawContent, filePath) {
		masked := htmlCommentStrip.ReplaceAllString(rawContent, "")
		lines := strings.Split(masked, "\n")
		inFrontmatter := false
		inFence := false
		fenceMarker := ""
		inTable := false

		for idx, rawLine := range lines {
			lineNum := idx + 1
			trimmed := strings.TrimSpace(rawLine)
			if idx == 0 && (trimmed == "---" || trimmed == "+++") {
				inFrontmatter = true
				continue
			}
			if inFrontmatter {
				if trimmed == "---" || trimmed == "..." || trimmed == "+++" {
					inFrontmatter = false
				}
				continue
			}

			if !inFence {
				if strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~") {
					inFence = true
					fenceMarker = trimmed[:3]
					geo.CodeBlockCount++
					lang := strings.TrimSpace(trimmed[3:])
					if lang == "" {
						geo.UnlabeledCodeBlocks++
					}
					continue
				}
			} else {
				if strings.HasPrefix(trimmed, fenceMarker) {
					inFence = false
					fenceMarker = ""
				}
				continue
			}

			if mdTableSepLineRe.MatchString(trimmed) {
				if !inTable {
					geo.TableCount++
					inTable = true
				}
				continue
			} else if !strings.Contains(trimmed, "|") {
				inTable = false
			}

			if mdListLineRe.MatchString(rawLine) {
				geo.ListCount++
			}

			// Check images on this line
			for _, m := range mdImagePattern.FindAllStringSubmatch(rawLine, -1) {
				alt := strings.TrimSpace(m[1])
				src := strings.TrimSpace(m[2])
				if alt == "" {
					imageIssues = append(imageIssues, SEOImageIssue{
						Src:    src,
						Alt:    alt,
						Line:   lineNum,
						Reason: "Missing alt text.",
					})
				} else if len(strings.Fields(alt)) < 2 && len(alt) < 10 {
					imageIssues = append(imageIssues, SEOImageIssue{
						Src:    src,
						Alt:    alt,
						Line:   lineNum,
						Reason: "Alt text is too brief; describe what the image shows.",
					})
				}
			}

			lineWithoutImg := mdImagePattern.ReplaceAllString(rawLine, "")
			for _, m := range mdLinkPattern.FindAllStringSubmatch(lineWithoutImg, -1) {
				anchor := strings.TrimSpace(m[1])
				href := strings.TrimSpace(m[2])
				lowerAnchor := strings.ToLower(anchor)
				switch {
				case anchor == "":
					linkIssues = append(linkIssues, SEOLinkIssue{
						Href:   href,
						Anchor: anchor,
						Line:   lineNum,
						Reason: "Empty link anchor text.",
					})
				case genericAnchors[lowerAnchor]:
					linkIssues = append(linkIssues, SEOLinkIssue{
						Href:   href,
						Anchor: anchor,
						Line:   lineNum,
						Reason: fmt.Sprintf("Generic anchor text %q; use a descriptive noun phrase.", anchor),
					})
				case strings.HasPrefix(lowerAnchor, "http://") || strings.HasPrefix(lowerAnchor, "https://"):
					linkIssues = append(linkIssues, SEOLinkIssue{
						Href:   href,
						Anchor: anchor,
						Line:   lineNum,
						Reason: "Raw URL used as anchor text; use a descriptive label.",
					})
				}
			}
		}
	} else {
		geo.CodeBlockCount = doc.Find("pre").Length()
		geo.TableCount = doc.Find("table").Length()
		geo.ListCount = doc.Find("li").Length()

		doc.Find("img").Each(func(_ int, s *goquery.Selection) {
			src, _ := s.Attr("src")
			alt, exists := s.Attr("alt")
			alt = strings.TrimSpace(alt)
			if !exists || alt == "" {
				imageIssues = append(imageIssues, SEOImageIssue{
					Src:    src,
					Alt:    alt,
					Reason: "Missing alt text.",
				})
			} else if len(strings.Fields(alt)) < 2 && len(alt) < 10 {
				imageIssues = append(imageIssues, SEOImageIssue{
					Src:    src,
					Alt:    alt,
					Reason: "Alt text is too brief; describe what the image shows.",
				})
			}
		})

		doc.Find("a").Each(func(_ int, s *goquery.Selection) {
			href, _ := s.Attr("href")
			anchor := strings.TrimSpace(s.Text())
			lowerAnchor := strings.ToLower(anchor)
			switch {
			case anchor == "":
				linkIssues = append(linkIssues, SEOLinkIssue{
					Href:   href,
					Anchor: anchor,
					Reason: "Empty link anchor text.",
				})
			case genericAnchors[lowerAnchor]:
				linkIssues = append(linkIssues, SEOLinkIssue{
					Href:   href,
					Anchor: anchor,
					Reason: fmt.Sprintf("Generic anchor text %q; use a descriptive noun phrase.", anchor),
				})
			case strings.HasPrefix(lowerAnchor, "http://") || strings.HasPrefix(lowerAnchor, "https://"):
				linkIssues = append(linkIssues, SEOLinkIssue{
					Href:   href,
					Anchor: anchor,
					Reason: "Raw URL used as anchor text; use a descriptive label.",
				})
			}
		})
	}

	// Lead (first 150 words) analysis
	bodyText := strings.TrimSpace(doc.Find("body").Text())
	bodyWords := strings.Fields(bodyText)
	leadCount := min(len(bodyWords), 150)
	geo.LeadWordCount = leadCount
	leadText := strings.Join(bodyWords[:leadCount], " ")
	geo.LeadHasKeyword = kwLower == "" || strings.Contains(strings.ToLower(leadText), kwLower)
	geo.NumericClaimCount = len(numericClaimRe.FindAllString(bodyText, -1))
	leadNumeric := len(numericClaimRe.FindAllString(leadText, -1))
	lowerLead := strings.ToLower(leadText)
	hasThroatClearing := strings.Contains(lowerLead, "in today's") || strings.Contains(lowerLead, "let's dive in") || strings.Contains(lowerLead, "imagine a world")
	geo.LeadHasConcreteClaim = !hasThroatClearing && (leadNumeric > 0 || leadCount >= 15)

	// Heading hierarchy & sentence case check
	var hierarchyViolation string
	prevLevel := 0
	for i, h := range res.Headings {
		if i == 0 && h.Level > 1 {
			hierarchyViolation = fmt.Sprintf("First heading %q starts at H%d instead of H1.", h.Text, h.Level)
		} else if prevLevel > 0 && h.Level > prevLevel+1 && hierarchyViolation == "" {
			hierarchyViolation = fmt.Sprintf("Heading %q (H%d) skips a level after H%d.", h.Text, h.Level, prevLevel)
		}
		prevLevel = h.Level
		if h.Level >= 2 && isTitleCaseHeading(h.Text) {
			geo.TitleCaseHeadings++
		}
	}

	// Build the 6 GEO checks and compute GEOScore
	geoScore := 100
	geoChecks := make([]SEOCheck, 0, 6)

	// 1. Dual-Purpose Metadata Split
	metaSplitCheck := SEOCheck{
		Name:        "Dual-Purpose Metadata Split",
		Status:      "pass",
		Description: "Distinct human card summary and search/LLM meta description are configured.",
	}
	if res.DocType == "page" {
		switch {
		case res.Description == "" && summary == "":
			metaSplitCheck.Status = "fail"
			metaSplitCheck.Description = "Both summary and description are missing; provide a human teaser in summary (80-180 chars) and an LLM/search abstract in description (120-160 chars)."
			metaSplitCheck.ScoreImpact = -20
			geoScore -= 20
		case summary == "":
			metaSplitCheck.Status = "warning"
			metaSplitCheck.Description = "Frontmatter summary is missing; add a distinct human teaser alongside description."
			metaSplitCheck.ScoreImpact = -10
			geoScore -= 10
		case res.Description == "":
			metaSplitCheck.Status = "warning"
			metaSplitCheck.Description = "Meta description is missing; add an information-dense search/LLM abstract (120-160 chars)."
			metaSplitCheck.ScoreImpact = -15
			geoScore -= 15
		case summaryEqualsDesc:
			metaSplitCheck.Status = "warning"
			metaSplitCheck.Description = "Summary and description are identical; split into a concise human card teaser (summary) and a factual LLM synthesis abstract (description)."
			metaSplitCheck.ScoreImpact = -10
			geoScore -= 10
		}
	} else {
		if summaryEqualsDesc {
			metaSplitCheck.Status = "warning"
			metaSplitCheck.Description = "Summary and description are identical; differentiate them or omit redundant summary."
			metaSplitCheck.ScoreImpact = -10
			geoScore -= 10
		} else {
			metaSplitCheck.Description = "Document metadata and lead summary are cleanly structured."
		}
	}
	geoChecks = append(geoChecks, metaSplitCheck)

	// 2. Inverted Pyramid Lead (First 150 Words)
	leadCheck := SEOCheck{
		Name:        "Inverted Pyramid Lead (First 150 Words)",
		Status:      "pass",
		Description: "Opening 150 words front-load core conclusions without synthetic throat-clearing.",
	}
	if hasThroatClearing {
		leadCheck.Status = "warning"
		leadCheck.Description = "Opening 150 words contain formulaic throat-clearing; lead directly with the conclusion or key metric."
		leadCheck.ScoreImpact = -15
		geoScore -= 15
	} else if kwLower != "" && !geo.LeadHasKeyword {
		leadCheck.Status = "warning"
		leadCheck.Description = fmt.Sprintf("Target keyword %q does not appear in the first 150 words.", keyword)
		leadCheck.ScoreImpact = -10
		geoScore -= 10
	}
	geoChecks = append(geoChecks, leadCheck)

	// 3. Quotability & Code Hygiene
	quotabilityCheck := SEOCheck{
		Name:        "Quotability & Code Hygiene",
		Status:      "pass",
		Description: fmt.Sprintf("Contains quotable artifacts (%d numeric claims, %d code blocks, %d tables, %d list items).", geo.NumericClaimCount, geo.CodeBlockCount, geo.TableCount, geo.ListCount),
	}
	if geo.UnlabeledCodeBlocks > 0 {
		quotabilityCheck.Status = "warning"
		quotabilityCheck.Description = fmt.Sprintf("%d fenced code block(s) lack a language tag; add explicit language identifiers for LLM parsing.", geo.UnlabeledCodeBlocks)
		quotabilityCheck.ScoreImpact = -10
		geoScore -= 10
	} else if res.WordCount >= 300 && geo.NumericClaimCount == 0 && geo.CodeBlockCount == 0 && geo.TableCount == 0 && geo.ListCount == 0 {
		quotabilityCheck.Status = "warning"
		quotabilityCheck.Description = "Long-form content lacks concrete numbers, code blocks, tables, or structured lists for generative citation."
		quotabilityCheck.ScoreImpact = -10
		geoScore -= 10
	}
	geoChecks = append(geoChecks, quotabilityCheck)

	// 4. Heading Hierarchy & Sentence Case
	headingGeoCheck := SEOCheck{
		Name:        "Heading Hierarchy & Sentence Case",
		Status:      "pass",
		Description: "Headings follow sequential hierarchy and sentence-case style.",
	}
	if hierarchyViolation != "" {
		headingGeoCheck.Status = "warning"
		headingGeoCheck.Description = hierarchyViolation
		headingGeoCheck.ScoreImpact = -10
		geoScore -= 10
	} else if geo.TitleCaseHeadings > 0 {
		headingGeoCheck.Status = "warning"
		headingGeoCheck.Description = fmt.Sprintf("%d section heading(s) use Title Case; prefer sentence case per Google developer style.", geo.TitleCaseHeadings)
		headingGeoCheck.ScoreImpact = -5
		geoScore -= 5
	}
	geoChecks = append(geoChecks, headingGeoCheck)

	// 5. Descriptive Image Alt-Text
	imgGeoCheck := SEOCheck{
		Name:        "Descriptive Image Alt-Text",
		Status:      "pass",
		Description: "All images include descriptive alt text.",
	}
	if len(imageIssues) > 0 {
		imgGeoCheck.Status = "warning"
		imgGeoCheck.Description = fmt.Sprintf("%d image(s) have missing or overly brief alt text.", len(imageIssues))
		imgGeoCheck.ScoreImpact = -10
		geoScore -= 10
	}
	geoChecks = append(geoChecks, imgGeoCheck)

	// 6. Link & Anchor Hygiene
	linkGeoCheck := SEOCheck{
		Name:        "Link & Anchor Hygiene",
		Status:      "pass",
		Description: "All links use descriptive anchor text.",
	}
	if len(linkIssues) > 0 {
		linkGeoCheck.Status = "warning"
		linkGeoCheck.Description = fmt.Sprintf("%d link(s) use empty, generic, or raw-URL anchor text.", len(linkIssues))
		linkGeoCheck.ScoreImpact = -10
		geoScore -= 10
	}
	geoChecks = append(geoChecks, linkGeoCheck)

	if geoScore < 0 {
		geoScore = 0
	}

	res.GEOScore = geoScore
	res.GEO = geo
	res.GEOChecks = geoChecks
	res.ImageIssues = imageIssues
	res.LinkIssues = linkIssues
	return nil
}
