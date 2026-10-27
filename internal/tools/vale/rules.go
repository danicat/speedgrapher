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

package vale

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode"

	"gopkg.in/yaml.v3"
)

var validVocabNameRe = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// ValeRuleActionParams defines the input parameters for ManageRules.
type ValeRuleActionParams struct {
	Action          string `json:"action" jsonschema:"The action to perform: 'list', 'set_rule', 'add_vocab', or 'remove_vocab'."`
	Path            string `json:"path,omitempty" jsonschema:"Optional file or directory path to resolve the active .vale.ini."`
	RuleID          string `json:"rule_id,omitempty" jsonschema:"The rule ID (e.g., 'Google.We' or 'Vale.Spelling') when action is 'set_rule'."`
	Enabled         *bool  `json:"enabled,omitempty" jsonschema:"Optional boolean to enable (true) or disable (false) the rule when action is 'set_rule'."`
	Level           string `json:"level,omitempty" jsonschema:"Optional severity level ('suggestion', 'warning', 'error', or 'NO') when action is 'set_rule'."`
	Term            string `json:"term,omitempty" jsonschema:"The vocabulary term to add or remove when action is 'add_vocab' or 'remove_vocab'."`
	CaseInsensitive bool   `json:"case_insensitive,omitempty" jsonschema:"When true for 'add_vocab', formats terms starting with an ASCII letter as [Tt]erm."`
}

// ValeRuleInfo describes a single Vale rule and its effective state in .vale.ini.
type ValeRuleInfo struct {
	ID             string `json:"id"`
	Style          string `json:"style"`
	Name           string `json:"name"`
	Description    string `json:"description"`
	DefaultLevel   string `json:"default_level"`
	EffectiveLevel string `json:"effective_level"`
	Enabled        bool   `json:"enabled"`
	Link           string `json:"link,omitempty"`
}

// ValeConfigState represents the active Vale configuration, rules catalog, and custom vocabulary.
type ValeConfigState struct {
	ConfigPath string         `json:"config_path"`
	StylesPath string         `json:"styles_path"`
	VocabName  string         `json:"vocab_name"`
	VocabPath  string         `json:"vocab_path"`
	VocabTerms []string       `json:"vocab_terms"`
	Rules      []ValeRuleInfo `json:"rules"`
}

type valeRuleYAML struct {
	Extends string `yaml:"extends"`
	Message string `yaml:"message"`
	Level   string `yaml:"level"`
	Link    string `yaml:"link"`
}

var builtinValeRules = []ValeRuleInfo{
	{
		ID:           "Vale.Spelling",
		Style:        "Vale",
		Name:         "Spelling",
		Description:  "Checks spelling against the built-in dictionary and active custom vocabulary.",
		DefaultLevel: "error",
	},
	{
		ID:           "Vale.Terms",
		Style:        "Vale",
		Name:         "Terms",
		Description:  "Enforces exact case and spelling for accepted vocabulary terms.",
		DefaultLevel: "error",
	},
	{
		ID:           "Vale.Avoid",
		Style:        "Vale",
		Name:         "Avoid",
		Description:  "Flags forbidden terms listed in the vocabulary reject.txt file.",
		DefaultLevel: "error",
	},
	{
		ID:           "Vale.Repetition",
		Style:        "Vale",
		Name:         "Repetition",
		Description:  "Flags repeated consecutive words (for example, 'the the').",
		DefaultLevel: "error",
	},
}

// ManageRules executes a Vale rule or vocabulary management action ("list", "set_rule", "add_vocab", "remove_vocab").
func ManageRules(input ValeRuleActionParams, cfg ...Config) (*ValeConfigState, error) {
	var c Config
	if len(cfg) > 0 {
		c = cfg[0]
	}

	var searchDir string
	if input.Path != "" {
		target := input.Path
		if !filepath.IsAbs(target) && c.WorkspaceDir != "" {
			target = filepath.Join(c.WorkspaceDir, target)
		}
		absTarget, err := filepath.Abs(filepath.Clean(target))
		if err != nil {
			return nil, fmt.Errorf("failed to resolve path %q: %w", input.Path, err)
		}
		if info, statErr := os.Stat(absTarget); statErr == nil && info.IsDir() {
			searchDir = absTarget
		} else {
			searchDir = filepath.Dir(absTarget)
		}
	}

	iniPath, err := setupValeConfig(searchDir, c.WorkspaceDir)
	if err != nil {
		return nil, fmt.Errorf("vale config error: %w", err)
	}

	action := strings.ToLower(strings.TrimSpace(input.Action))
	if action == "" {
		action = "list"
	}

	switch action {
	case "list":
		return loadValeConfigState(iniPath)

	case "set_rule":
		ruleID := strings.TrimSpace(input.RuleID)
		if ruleID == "" {
			return nil, fmt.Errorf("rule_id is required for set_rule action")
		}
		state, err := loadValeConfigState(iniPath)
		if err != nil {
			return nil, err
		}
		var targetRule *ValeRuleInfo
		for i := range state.Rules {
			if state.Rules[i].ID == ruleID {
				targetRule = &state.Rules[i]
				break
			}
		}
		if targetRule == nil {
			return nil, fmt.Errorf("unknown Vale rule_id %q", ruleID)
		}

		level := strings.TrimSpace(input.Level)
		if level != "" {
			upper := strings.ToUpper(level)
			lower := strings.ToLower(level)
			if upper != "NO" && upper != "YES" && lower != "suggestion" && lower != "warning" && lower != "error" {
				return nil, fmt.Errorf("invalid level %q for rule %q (expected suggestion, warning, error, or NO)", input.Level, ruleID)
			}
		}
		if input.Enabled == nil && level == "" {
			return nil, fmt.Errorf("either enabled or level must be provided for set_rule action")
		}

		disable := (input.Enabled != nil && !*input.Enabled) || strings.EqualFold(level, "NO")
		var desiredOverride string
		if disable {
			desiredOverride = "NO"
		} else if level != "" && !strings.EqualFold(level, "YES") && !strings.EqualFold(level, "NO") {
			desiredOverride = strings.ToLower(level)
		} else {
			// Removing "<RuleID> = NO" restores the rule's default severity
			desiredOverride = ""
		}

		if err := updateValeIniRule(iniPath, ruleID, desiredOverride); err != nil {
			return nil, err
		}
		return loadValeConfigState(iniPath)

	case "add_vocab":
		rawTerm := strings.TrimSpace(input.Term)
		if rawTerm == "" {
			return nil, fmt.Errorf("term is required for add_vocab action")
		}
		state, err := loadValeConfigState(iniPath)
		if err != nil {
			return nil, err
		}
		if err := ensureValeIniVocab(iniPath, state.VocabName); err != nil {
			return nil, err
		}
		formattedTerm := formatVocabTerm(rawTerm, input.CaseInsensitive)
		if err := addTermToVocabFile(state.VocabPath, rawTerm, formattedTerm); err != nil {
			return nil, err
		}
		return loadValeConfigState(iniPath)

	case "remove_vocab":
		rawTerm := strings.TrimSpace(input.Term)
		if rawTerm == "" {
			return nil, fmt.Errorf("term is required for remove_vocab action")
		}
		state, err := loadValeConfigState(iniPath)
		if err != nil {
			return nil, err
		}
		if err := removeTermFromVocabFile(state.VocabPath, rawTerm); err != nil {
			return nil, err
		}
		return loadValeConfigState(iniPath)

	default:
		return nil, fmt.Errorf("unknown vale_rules action %q (expected list, set_rule, add_vocab, or remove_vocab)", input.Action)
	}
}

func parseValeIni(iniPath string) (stylesRel string, vocabName string, mdOverrides map[string]string, err error) {
	data, err := os.ReadFile(iniPath)
	if err != nil {
		return "", "", nil, fmt.Errorf("failed to read %s: %w", iniPath, err)
	}
	stylesRel = "styles"
	vocabName = "Speedgrapher"
	mdOverrides = make(map[string]string)

	currentSection := ""
	for rawLine := range strings.SplitSeq(string(data), "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			currentSection = strings.TrimSpace(line[1 : len(line)-1])
			continue
		}
		before, after, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key := strings.TrimSpace(before)
		val := strings.TrimSpace(after)
		switch currentSection {
		case "":
			switch strings.ToLower(key) {
			case "stylespath":
				if val != "" {
					stylesRel = val
				}
			case "vocab":
				if val != "" {
					vocabName = strings.TrimSpace(strings.Split(val, ",")[0])
				}
			}
		case "*.md", "*":
			if strings.Contains(key, ".") && !strings.EqualFold(key, "BasedOnStyles") {
				mdOverrides[key] = val
			}
		}
	}
	if !validVocabNameRe.MatchString(vocabName) {
		return "", "", nil, fmt.Errorf("invalid Vocab name %q in %s: must match ^[a-zA-Z0-9_-]+$", vocabName, iniPath)
	}
	return stylesRel, vocabName, mdOverrides, nil
}

func loadValeConfigState(iniPath string) (*ValeConfigState, error) {
	stylesRel, vocabName, mdOverrides, err := parseValeIni(iniPath)
	if err != nil {
		return nil, err
	}

	iniDir := filepath.Dir(iniPath)
	stylesPath := stylesRel
	if !filepath.IsAbs(stylesPath) {
		stylesPath = filepath.Join(iniDir, stylesPath)
	}
	stylesPath = filepath.Clean(stylesPath)

	vocabPath := filepath.Join(stylesPath, "config", "vocabularies", vocabName, "accept.txt")
	vocabTerms := []string{}
	if vocabData, readErr := os.ReadFile(vocabPath); readErr == nil {
		for line := range strings.SplitSeq(string(vocabData), "\n") {
			trimmed := strings.TrimSpace(line)
			if trimmed != "" && !strings.HasPrefix(trimmed, "#") {
				vocabTerms = append(vocabTerms, trimmed)
			}
		}
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return nil, fmt.Errorf("failed to read vocabulary file %s: %w", vocabPath, readErr)
	}

	rules := make([]ValeRuleInfo, 0, 64)
	for _, b := range builtinValeRules {
		r := b
		r.EffectiveLevel = r.DefaultLevel
		r.Enabled = true
		applyRuleOverride(&r, mdOverrides)
		rules = append(rules, r)
	}

	styleNames := []string{"Google", "proselint", "write-good"}
	for _, style := range styleNames {
		styleDir := filepath.Join(stylesPath, style)
		entries, readErr := os.ReadDir(styleDir)
		if readErr != nil {
			if errors.Is(readErr, os.ErrNotExist) {
				continue
			}
			return nil, fmt.Errorf("failed to read style directory %s: %w", styleDir, readErr)
		}
		var ymlFiles []string
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(e.Name(), ".yml") {
				ymlFiles = append(ymlFiles, e.Name())
			}
		}
		sort.Strings(ymlFiles)

		for _, fname := range ymlFiles {
			ruleName := strings.TrimSuffix(fname, ".yml")
			ruleID := style + "." + ruleName
			ymlBytes, err := os.ReadFile(filepath.Join(styleDir, fname))
			if err != nil {
				return nil, fmt.Errorf("failed to read Vale rule %s: %w", ruleID, err)
			}
			var parsed valeRuleYAML
			if err := yaml.Unmarshal(ymlBytes, &parsed); err != nil {
				return nil, fmt.Errorf("failed to parse Vale rule YAML %s: %w", ruleID, err)
			}
			defLevel := strings.ToLower(strings.TrimSpace(parsed.Level))
			if defLevel == "" {
				defLevel = "warning"
			}
			desc := ExplainValeRule(ruleID, strings.TrimSpace(parsed.Message), parsed.Extends)

			info := ValeRuleInfo{
				ID:             ruleID,
				Style:          style,
				Name:           ruleName,
				Description:    desc,
				DefaultLevel:   defLevel,
				EffectiveLevel: defLevel,
				Enabled:        true,
				Link:           strings.TrimSpace(parsed.Link),
			}
			applyRuleOverride(&info, mdOverrides)
			rules = append(rules, info)
		}
	}

	return &ValeConfigState{
		ConfigPath: iniPath,
		StylesPath: stylesPath,
		VocabName:  vocabName,
		VocabPath:  vocabPath,
		VocabTerms: vocabTerms,
		Rules:      rules,
	}, nil
}

func applyRuleOverride(info *ValeRuleInfo, overrides map[string]string) {
	val, exists := overrides[info.ID]
	if !exists {
		return
	}
	trimmed := strings.TrimSpace(val)
	if strings.EqualFold(trimmed, "NO") || strings.EqualFold(trimmed, "off") {
		info.Enabled = false
		info.EffectiveLevel = "NO"
		return
	}
	if strings.EqualFold(trimmed, "YES") {
		info.Enabled = true
		info.EffectiveLevel = info.DefaultLevel
		return
	}
	lower := strings.ToLower(trimmed)
	if lower == "suggestion" || lower == "warning" || lower == "error" {
		info.Enabled = true
		info.EffectiveLevel = lower
	}
}

func updateValeIniRule(iniPath, ruleID, desiredOverride string) error {
	data, err := os.ReadFile(iniPath)
	if err != nil {
		return fmt.Errorf("failed to read %s: %w", iniPath, err)
	}
	lines := strings.Split(string(data), "\n")
	var out []string
	inMdSection := false
	foundMdSection := false
	updated := false

	for _, rawLine := range lines {
		trimmed := strings.TrimSpace(rawLine)
		if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
			if inMdSection && !updated && desiredOverride != "" {
				out = append(out, fmt.Sprintf("%s = %s", ruleID, desiredOverride))
				updated = true
			}
			sectionName := strings.TrimSpace(trimmed[1 : len(trimmed)-1])
			inMdSection = (sectionName == "*.md")
			if inMdSection {
				foundMdSection = true
			}
			out = append(out, rawLine)
			continue
		}

		if inMdSection {
			if before, _, ok := strings.Cut(trimmed, "="); ok {
				key := strings.TrimSpace(before)
				if key == ruleID {
					if !updated && desiredOverride != "" {
						out = append(out, fmt.Sprintf("%s = %s", ruleID, desiredOverride))
						updated = true
					} else {
						updated = true
					}
					continue
				}
			}
		}
		out = append(out, rawLine)
	}

	if !foundMdSection && desiredOverride != "" {
		if len(out) > 0 && strings.TrimSpace(out[len(out)-1]) != "" {
			out = append(out, "")
		}
		out = append(out, "[*.md]", "BasedOnStyles = Vale, Google, proselint, write-good", fmt.Sprintf("%s = %s", ruleID, desiredOverride))
	} else if inMdSection && !updated && desiredOverride != "" {
		// Insert before trailing empty lines at EOF
		insertIdx := len(out)
		for insertIdx > 0 && strings.TrimSpace(out[insertIdx-1]) == "" {
			insertIdx--
		}
		newOut := make([]string, 0, len(out)+1)
		newOut = append(newOut, out[:insertIdx]...)
		newOut = append(newOut, fmt.Sprintf("%s = %s", ruleID, desiredOverride))
		newOut = append(newOut, out[insertIdx:]...)
		out = newOut
	}

	content := strings.TrimRight(strings.Join(out, "\n"), "\n") + "\n"
	if err := os.WriteFile(iniPath, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write %s: %w", iniPath, err)
	}
	return nil
}

func ensureValeIniVocab(iniPath, vocabName string) error {
	data, err := os.ReadFile(iniPath)
	if err != nil {
		return fmt.Errorf("failed to read %s: %w", iniPath, err)
	}
	lines := strings.Split(string(data), "\n")
	inRoot := true
	stylesIdx := -1
	firstSectionIdx := -1

	for i, rawLine := range lines {
		trimmed := strings.TrimSpace(rawLine)
		if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
			if inRoot {
				firstSectionIdx = i
				inRoot = false
			}
			continue
		}
		if inRoot {
			if before, after, ok := strings.Cut(trimmed, "="); ok {
				key := strings.ToLower(strings.TrimSpace(before))
				val := strings.TrimSpace(after)
				if key == "vocab" && val != "" {
					return nil
				}
				if key == "stylespath" {
					stylesIdx = i
				}
			}
		}
	}

	vocabLine := fmt.Sprintf("Vocab = %s", vocabName)
	var out []string
	if stylesIdx >= 0 {
		out = append(out, lines[:stylesIdx+1]...)
		out = append(out, vocabLine)
		out = append(out, lines[stylesIdx+1:]...)
	} else if firstSectionIdx >= 0 {
		out = append(out, lines[:firstSectionIdx]...)
		out = append(out, vocabLine, "")
		out = append(out, lines[firstSectionIdx:]...)
	} else {
		out = append([]string{vocabLine}, lines...)
	}

	content := strings.TrimRight(strings.Join(out, "\n"), "\n") + "\n"
	if err := os.WriteFile(iniPath, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write %s: %w", iniPath, err)
	}
	return nil
}

func formatVocabTerm(term string, caseInsensitive bool) string {
	trimmed := strings.TrimSpace(term)
	if !caseInsensitive || trimmed == "" || strings.HasPrefix(trimmed, "[") {
		return trimmed
	}
	if len(trimmed) > 1 {
		rest := trimmed[1:]
		if rest == strings.ToUpper(rest) && rest != strings.ToLower(rest) {
			return trimmed
		}
	}
	r := rune(trimmed[0])
	if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
		return fmt.Sprintf("[%c%c]%s", unicode.ToUpper(r), unicode.ToLower(r), trimmed[1:])
	}
	return trimmed
}

func addTermToVocabFile(vocabPath, rawTerm, formattedTerm string) error {
	if strings.ContainsAny(rawTerm, "\r\n") || strings.ContainsAny(formattedTerm, "\r\n") {
		return fmt.Errorf("invalid vocabulary term %q: must not contain newlines", rawTerm)
	}
	if _, err := regexp.Compile(formattedTerm); err != nil {
		return fmt.Errorf("invalid vocabulary regex term %q: %w", formattedTerm, err)
	}
	if err := os.MkdirAll(filepath.Dir(vocabPath), 0755); err != nil {
		return fmt.Errorf("failed to create vocabulary directory for %s: %w", vocabPath, err)
	}
	var existingLines []string
	if data, err := os.ReadFile(vocabPath); err == nil {
		for l := range strings.SplitSeq(string(data), "\n") {
			t := strings.TrimSpace(l)
			if t != "" {
				existingLines = append(existingLines, t)
			}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("failed to read vocabulary file %s: %w", vocabPath, err)
	}

	altForm := formatVocabTerm(rawTerm, true)
	for _, existing := range existingLines {
		if existing == formattedTerm || existing == rawTerm || existing == altForm {
			return nil
		}
	}

	existingLines = append(existingLines, formattedTerm)
	content := strings.Join(existingLines, "\n") + "\n"
	if err := os.WriteFile(vocabPath, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write vocabulary file %s: %w", vocabPath, err)
	}
	return nil
}

func removeTermFromVocabFile(vocabPath, rawTerm string) error {
	data, err := os.ReadFile(vocabPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("failed to read vocabulary file %s: %w", vocabPath, err)
	}

	ciForm := formatVocabTerm(rawTerm, true)
	var kept []string
	for l := range strings.SplitSeq(string(data), "\n") {
		t := strings.TrimSpace(l)
		if t == "" {
			continue
		}
		if t == rawTerm || t == ciForm || strings.EqualFold(t, rawTerm) {
			continue
		}
		kept = append(kept, t)
	}

	content := ""
	if len(kept) > 0 {
		content = strings.Join(kept, "\n") + "\n"
	}
	if err := os.WriteFile(vocabPath, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write vocabulary file %s: %w", vocabPath, err)
	}
	return nil
}

var valeRuleExplanations = map[string]string{
	"write-good.E-Prime":     "E-Prime ('English-Prime') flags forms of 'to be' (is, are, was, were, be, been) to encourage active verbs (e.g., 'none exist' instead of 'none are present'). Mute this rule if you prefer natural 'to be' verbs.",
	"write-good.Passive":     "Flags passive voice constructions where the actor is hidden or delayed. Active voice names the component or user performing the action first.",
	"write-good.Weasel":      "Flags vague 'weasel' qualifiers (such as 'various', 'very', 'clearly', 'extremely') that weaken technical claims; replace with concrete numbers or direct statements.",
	"write-good.TooWordy":    "Flags wordy phrases and inflated verbs that have a simpler, direct plain-English equivalent.",
	"write-good.So":          "Flags starting a sentence with 'So'. In technical prose, use 'Therefore', 'As a result', or connect the cause directly.",
	"write-good.ThereIs":     "Flags starting a clause with 'There is' or 'There are'. Lead with the real subject and an active verb instead.",
	"write-good.Cliches":     "Flags worn-out idioms and clichés that obscure literal technical behavior and translate poorly.",
	"write-good.Illusions":   "Flags repeated consecutive words ('the the', 'is is') that the eye skips over during proofreading.",
	"Google.Semicolons":      "Google Developer Style Guide discourages semicolons because joining complex clauses increases cognitive load; split into two sentences or use a conjunction.",
	"Google.We":              "Google Developer Style Guide avoids first-person plural ('we', 'our') in documentation because 'we' is ambiguous; address the reader as 'you' or name the software as the subject.",
	"Google.FirstPerson":     "Google Developer Style Guide avoids first-person singular ('I', 'my') in reference docs; mute this rule for personal blog posts.",
	"Google.Will":            "Google Developer Style Guide prefers present tense ('returns', 'opens') over future tense ('will return', 'will open') to describe deterministic behavior.",
	"Google.Passive":         "Google Developer Style Guide prefers active voice so it is always clear whether the user, the API, or the runtime performs the action.",
	"Google.Parens":          "Google Developer Style Guide discourages frequent parentheses that interrupt sentence flow; integrate essential details into the sentence or cut tangential ones.",
	"Google.Headings":        "Google Developer Style Guide uses sentence-case headings (capitalize only the first word and proper nouns/acronyms) for faster scanning.",
	"Google.Exclamation":     "Google Developer Style Guide avoids exclamation marks in technical documentation so facts and metrics carry the emphasis.",
	"Google.Contractions":    "Google Developer Style Guide encourages standard contractions ('don't', 'isn't', 'can't') for an approachable developer tone.",
	"Google.WordList":        "Enforces Google Developer Style Guide preferred terminology and plain-English replacements.",
	"Google.Latin":           "Google Developer Style Guide prefers plain English ('for example', 'that is', 'and so on') over Latin abbreviations ('e.g.', 'i.e.', 'etc.').",
	"Google.OptionalPlurals": "Google Developer Style Guide avoids '(s)' optional plurals; use either the plural form or 'one or more'.",
	"Google.Acronyms":        "Requires spelling out unfamiliar acronyms on first mention so readers do not have to guess domain abbreviations.",
	"Google.Quotes":          "Google Developer Style Guide places commas and periods inside quotation marks (or uses code font for literal strings).",
	"Google.OxfordComma":     "Google Developer Style Guide requires the serial (Oxford) comma before 'and'/'or' in lists of three or more items to prevent ambiguity.",
	"Google.EmDash":          "Google Developer Style Guide formats em-dashes without surrounding spaces (`word—word`).",
	"Google.Ellipses":        "Google Developer Style Guide avoids ellipses (`...`) in running prose because they leave the reader guessing what was omitted.",
	"Google.Ranges":          "Google Developer Style Guide uses 'to' or 'through' (or an en-dash) for numeric ranges rather than a hyphen.",
	"Google.Spacing":         "Enforces a single space after sentence-ending punctuation.",
}

// ExplainValeRule returns a clear human-friendly explanation of why a Vale rule exists.
func ExplainValeRule(ruleID, rawMessage, extends string) string {
	if exp, ok := valeRuleExplanations[ruleID]; ok {
		return exp
	}
	cleaned := strings.ReplaceAll(rawMessage, "'%s'", "flagged term")
	cleaned = strings.ReplaceAll(cleaned, "\"%s\"", "flagged term")
	cleaned = strings.ReplaceAll(cleaned, "%s", "flagged term")
	if cleaned != "" {
		return cleaned
	}
	return fmt.Sprintf("%s (%s)", ruleID, extends)
}
