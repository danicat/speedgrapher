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

package fog

import (
	"regexp"
	"strings"
)

var (
	htmlCommentRe = regexp.MustCompile(`(?s)<!--.*?-->`)
	mdTableSepRe  = regexp.MustCompile(`^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$`)
	hrRe          = regexp.MustCompile(`^(?:\*\s*){3,}$|^(?:-\s*){3,}$|^(?:_\s*){3,}$`)
	headingRe     = regexp.MustCompile(`^(#{1,6})\s+(.*)$`)
	listItemRe    = regexp.MustCompile(`^\s*(?:[-*+]|\d+[.)])\s+`)
	mdHugoLinkRe  = regexp.MustCompile(`(?s)\[([^\]]+)\]\(\s*\{\{.*?\}\}\s*\)`)
	mdHugoImageRe = regexp.MustCompile(`(?s)!\[([^\]]*)\]\(\s*\{\{.*?\}\}\s*\)`)
	mdLinkRe      = regexp.MustCompile(`\[([^\]]+)\]\([^)]+\)`)
	mdImageRe     = regexp.MustCompile(`!\[([^\]]*)\]\([^)]+\)`)
	inlineCodeRe  = regexp.MustCompile("`([^`]*)`")
	shortcodeRe   = regexp.MustCompile(`(?s)\{\{.*?\}\}`)
	htmlTagRe     = regexp.MustCompile(`(?s)<[^>]*>`)
)

// ProseBlock represents a segmented 1-indexed Markdown prose block.
type ProseBlock struct {
	BlockIndex int
	BlockType  string // "paragraph" | "blockquote" | "list" | "heading"
	StartLine  int
	EndLine    int
	RawText    string
	CleanText  string
	CleanLines []string
}

// maskSpaces preserves newlines while replacing all other characters with spaces.
func maskSpaces(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			b.WriteByte('\n')
		} else {
			b.WriteByte(' ')
		}
	}
	return b.String()
}

// maskHTMLComments replaces <!-- ... --> comments with spaces while preserving line numbers.
func maskHTMLComments(raw string) string {
	return htmlCommentRe.ReplaceAllStringFunc(raw, maskSpaces)
}

// maskNonProseLines replaces YAML/TOML frontmatter, fenced code blocks, and HTML comments
// with whitespace while preserving exact 1-indexed line numbers.
func maskNonProseLines(raw string) []string {
	masked := maskHTMLComments(raw)
	lines := strings.Split(masked, "\n")

	inFrontmatter := false
	frontmatterDelim := ""
	inFence := false
	fenceMarker := ""
	seenContent := false

	for idx, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !seenContent && trimmed == "" {
			continue
		}

		if !seenContent && idx == 0 && (trimmed == "---" || trimmed == "+++") {
			inFrontmatter = true
			frontmatterDelim = trimmed
			seenContent = true
			lines[idx] = ""
			continue
		}
		seenContent = true

		if inFrontmatter {
			lines[idx] = ""
			if trimmed == frontmatterDelim || (frontmatterDelim == "---" && trimmed == "...") {
				inFrontmatter = false
			}
			continue
		}

		if !inFence {
			if strings.HasPrefix(trimmed, "```") {
				inFence = true
				fenceMarker = "```"
				lines[idx] = ""
				continue
			}
			if strings.HasPrefix(trimmed, "~~~") {
				inFence = true
				fenceMarker = "~~~"
				lines[idx] = ""
				continue
			}
		} else {
			lines[idx] = ""
			if strings.HasPrefix(trimmed, fenceMarker) {
				inFence = false
				fenceMarker = ""
			}
			continue
		}

		if mdTableSepRe.MatchString(trimmed) || hrRe.MatchString(trimmed) {
			lines[idx] = ""
		}
	}

	return lines
}

// cleanProseLine strips Markdown formatting tokens from a single prose line for word/sentence counting.
func cleanProseLine(line string) string {
	s := mdHugoImageRe.ReplaceAllString(line, "$1")
	s = mdHugoLinkRe.ReplaceAllString(s, "$1")
	s = mdImageRe.ReplaceAllString(s, "$1")
	s = mdLinkRe.ReplaceAllString(s, "$1")
	s = inlineCodeRe.ReplaceAllString(s, "$1")
	s = shortcodeRe.ReplaceAllString(s, " ")
	s = htmlTagRe.ReplaceAllString(s, " ")
	if m := headingRe.FindStringSubmatch(strings.TrimSpace(s)); m != nil {
		s = m[2]
	}
	s = strings.TrimLeft(s, "> \t")
	s = listItemRe.ReplaceAllString(s, "")
	return strings.TrimSpace(s)
}

// stripMarkdownForMetrics removes frontmatter, fenced code blocks, HTML comments,
// table separators, and formatting syntax before computing overall readability metrics.
func stripMarkdownForMetrics(raw string) string {
	lines := maskNonProseLines(raw)
	cleaned := make([]string, 0, len(lines))
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		c := cleanProseLine(line)
		if c != "" {
			cleaned = append(cleaned, c)
		}
	}
	return strings.Join(cleaned, "\n")
}

// SegmentBlocks segments Markdown text into 1-indexed prose blocks
// (paragraph, blockquote, list, heading), skipping frontmatter, code blocks, HTML comments, and horizontal rules.
func SegmentBlocks(raw string) []ProseBlock {
	origLines := strings.Split(maskHTMLComments(raw), "\n")
	maskedLines := maskNonProseLines(raw)

	var blocks []ProseBlock
	var currType string
	currStart := 0
	currEnd := 0
	var currRaw []string
	var currClean []string

	flush := func() {
		if currType == "" || len(currClean) == 0 {
			currType = ""
			currRaw = nil
			currClean = nil
			return
		}
		cleanJoined := strings.TrimSpace(strings.Join(currClean, " "))
		if cleanJoined != "" {
			cleanCopy := make([]string, len(currClean))
			copy(cleanCopy, currClean)
			blocks = append(blocks, ProseBlock{
				BlockIndex: len(blocks),
				BlockType:  currType,
				StartLine:  currStart,
				EndLine:    currEnd,
				RawText:    strings.Join(currRaw, "\n"),
				CleanText:  cleanJoined,
				CleanLines: cleanCopy,
			})
		}
		currType = ""
		currRaw = nil
		currClean = nil
	}

	for idx, line := range maskedLines {
		lineNum := idx + 1
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			flush()
			continue
		}

		cleaned := cleanProseLine(line)
		if cleaned == "" {
			flush()
			continue
		}

		// Heading is always a single-line block
		if headingRe.MatchString(trimmed) {
			flush()
			blocks = append(blocks, ProseBlock{
				BlockIndex: len(blocks),
				BlockType:  "heading",
				StartLine:  lineNum,
				EndLine:    lineNum,
				RawText:    origLines[idx],
				CleanText:  cleaned,
				CleanLines: []string{cleaned},
			})
			continue
		}

		var lineType string
		switch {
		case strings.HasPrefix(trimmed, ">"):
			lineType = "blockquote"
		case listItemRe.MatchString(line):
			lineType = "list"
		case currType == "list" && (strings.HasPrefix(line, "  ") || strings.HasPrefix(line, "\t")):
			lineType = "list"
		default:
			lineType = "paragraph"
		}

		if currType != "" && currType != lineType {
			flush()
		}
		if currType == "" {
			currType = lineType
			currStart = lineNum
		}
		currEnd = lineNum
		currRaw = append(currRaw, origLines[idx])
		currClean = append(currClean, cleaned)
	}
	flush()

	return blocks
}
