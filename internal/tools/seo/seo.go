package seo

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/PuerkitoBio/goquery"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gopkg.in/yaml.v3"
)

// Register registers the analyze_seo tool with the server.
func Register(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "analyze_seo",
		Description: "Performs technical SEO audits on URLs or Hugo Markdown. Uses the Hugo CLI to accurately verify titles, descriptions, and H1 tags from frontmatter and templates.",
	}, seoHandler)
}

// SEOParams defines the input parameters for the seo_audit tool.
type SEOParams struct {
	URL     string `json:"url,omitempty" jsonschema:"The full URL of the webpage to audit. Either 'url' or 'html' must be provided."`
	HTML    string `json:"html,omitempty" jsonschema:"The raw HTML content to audit. Use this if the content is not yet published. Supports Hugo Markdown with Front Matter."`
	Keyword string `json:"keyword,omitempty" jsonschema:"The target keyword to check for optimization in the title, description, and headings."`
}

// SEOCheck represents a single SEO check result.
type SEOCheck struct {
	Name        string `json:"name"`
	Status      string `json:"status"` // "pass", "fail", "warning"
	Description string `json:"description"`
	ScoreImpact int    `json:"score_impact"`
}

// SEOResult defines the structured output for the seo_audit tool.
type SEOResult struct {
	Score       int        `json:"score"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	H1          string     `json:"h1"`
	WordCount   int        `json:"word_count"`
	Checks      []SEOCheck `json:"checks"`
}

// FrontMatter defines the structure for Hugo Front Matter (YAML).
type FrontMatter struct {
	Title       string `yaml:"title"`
	Description string `yaml:"description"`
	Canonical   string `yaml:"canonical"`
}

func seoHandler(_ context.Context, _ *mcp.CallToolRequest, input SEOParams) (*mcp.CallToolResult, *SEOResult, error) {
	var doc *goquery.Document
	var err error

	if input.URL != "" {
		resp, fetchErr := http.Get(input.URL)
		if fetchErr != nil {
			return nil, nil, fmt.Errorf("failed to fetch URL: %w", fetchErr)
		}
		defer func() { _ = resp.Body.Close() }()
		if resp.StatusCode != http.StatusOK {
			return nil, nil, fmt.Errorf("failed to fetch URL, status code: %d", resp.StatusCode)
		}
		doc, err = goquery.NewDocumentFromReader(resp.Body)
	} else if input.HTML != "" {
		// Check if input is Hugo Markdown (starts with ---)
		if strings.HasPrefix(strings.TrimSpace(input.HTML), "---") {
			htmlContent, convErr := convertHugoMarkdownToHTML(input.HTML)
			if convErr != nil {
				return nil, nil, fmt.Errorf("failed to convert Hugo Markdown: %w", convErr)
			}
			doc, err = goquery.NewDocumentFromReader(strings.NewReader(htmlContent))
		} else {
			doc, err = goquery.NewDocumentFromReader(strings.NewReader(input.HTML))
		}
	} else {
		return nil, nil, fmt.Errorf("either url or html must be provided")
	}

	if err != nil {
		return nil, nil, fmt.Errorf("failed to parse HTML: %w", err)
	}

	result := analyzeSEO(doc, input.Keyword)
	return nil, result, nil
}

func findHugoRoot() (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		for _, config := range []string{"hugo.toml", "hugo.yaml", "hugo.json", "config.toml", "config.yaml", "config.json"} {
			if _, err := os.Stat(filepath.Join(cwd, config)); err == nil {
				return cwd, nil
			}
		}
		parent := filepath.Dir(cwd)
		if parent == cwd {
			break
		}
		cwd = parent
	}
	return "", fmt.Errorf("hugo root not found")
}

func convertHugoMarkdownToHTML(markdown string) (string, error) {
	root, err := findHugoRoot()
	if err != nil {
		return "", fmt.Errorf("hugo root not found: %w", err)
	}

	// Create a unique temp file in content
	tempFileName := "speedgrapher_seo_temp.md"
	tempFilePath := filepath.Join(root, "content", tempFileName)
	if err := os.WriteFile(tempFilePath, []byte(markdown), 0644); err != nil {
		return "", fmt.Errorf("failed to write temp markdown: %w", err)
	}
	defer os.Remove(tempFilePath)

	tempOut, err := os.MkdirTemp("", "speedgrapher_hugo_out")
	if err != nil {
		return "", fmt.Errorf("failed to create temp out dir: %w", err)
	}
	defer os.RemoveAll(tempOut)

	// Run hugo
	cmd := exec.Command("hugo", "--destination", tempOut, "--quiet")
	cmd.Dir = root
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("hugo failed: %s (error: %w)", string(out), err)
	}

	// Try to find the rendered HTML.
	// We check for the filename without extension, then look for index.html there.
	targetSlug := "speedgrapher_seo_temp"

	// Parse frontmatter to check for slug or url overrides which change the output path
	parts := strings.SplitN(markdown, "---", 3)
	if len(parts) >= 3 {
		var fm map[string]interface{}
		if err := yaml.Unmarshal([]byte(parts[1]), &fm); err == nil {
			if url, ok := fm["url"].(string); ok {
				targetSlug = strings.Trim(url, "/")
			} else if slug, ok := fm["slug"].(string); ok {
				targetSlug = slug
			}
		}
	}

	renderedPath := filepath.Join(tempOut, targetSlug, "index.html")

	// If the expected path doesn't exist, search for any index.html as a fallback
	if _, err := os.Stat(renderedPath); os.IsNotExist(err) {
		found := ""
		_ = filepath.Walk(tempOut, func(path string, info os.FileInfo, err error) error {
			if err == nil && !info.IsDir() && strings.HasSuffix(path, "index.html") {
				// We prefer a path that contains our slug
				if strings.Contains(path, targetSlug) {
					found = path
					return fmt.Errorf("found")
				}
				// Otherwise, keep the first one we find
				if found == "" {
					found = path
				}
			}
			return nil
		})
		renderedPath = found
	}

	if renderedPath == "" {
		return "", fmt.Errorf("could not find rendered HTML in %s", tempOut)
	}

	htmlBytes, err := os.ReadFile(renderedPath)
	if err != nil {
		return "", fmt.Errorf("failed to read rendered HTML: %w", err)
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
		score -= 10
	} else if len(title) < 30 || len(title) > 60 {
		titleCheck.Status = "warning"
		titleCheck.Description = fmt.Sprintf("Title length (%d) is not optimal (30-60 chars).", len(title))
		score -= 5
	}
	if keyword != "" && !strings.Contains(strings.ToLower(title), keyword) {
		titleCheck.Status = "warning"
		titleCheck.Description += fmt.Sprintf(" Keyword '%s' not found in title.", keyword)
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
		score -= 10
	} else if len(desc) < 120 || len(desc) > 160 {
		descCheck.Status = "warning"
		descCheck.Description = fmt.Sprintf("Description length (%d) is not optimal (120-160 chars).", len(desc))
		score -= 5
	}
	if keyword != "" && !strings.Contains(strings.ToLower(desc), keyword) {
		descCheck.Status = "warning"
		descCheck.Description += fmt.Sprintf(" Keyword '%s' not found in description.", keyword)
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
		score -= 10
	} else if h1s.Length() > 1 {
		h1Check.Status = "warning"
		h1Check.Description = fmt.Sprintf("Found %d H1 tags. There should be exactly one.", h1s.Length())
		score -= 5
		h1Text = strings.TrimSpace(h1s.First().Text())
	} else {
		h1Text = strings.TrimSpace(h1s.First().Text())
	}
	if keyword != "" && h1Text != "" && !strings.Contains(strings.ToLower(h1Text), keyword) {
		h1Check.Status = "warning"
		h1Check.Description += fmt.Sprintf(" Keyword '%s' not found in H1.", keyword)
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
		score -= 5
	}
	checks = append(checks, imgCheck)

	// 5. Links
	links := doc.Find("a")
	linkCheck := SEOCheck{Name: "Links", Status: "pass", Description: fmt.Sprintf("Found %d links.", links.Length())}
	if links.Length() == 0 {
		linkCheck.Status = "warning"
		linkCheck.Description = "No links found on the page."
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
		score -= 5
	}
	checks = append(checks, canonCheck)

	if score < 0 {
		score = 0
	}

	return &SEOResult{
		Score:       score,
		Title:       title,
		Description: desc,
		H1:          h1Text,
		WordCount:   wordCount,
		Checks:      checks,
	}
}
