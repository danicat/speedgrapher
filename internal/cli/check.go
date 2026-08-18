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

package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/danicat/speedgrapher/internal/safeshell"
	"github.com/spf13/cobra"
)

// Status represents the health status of an external dependency.
type Status string

const (
	// StatusOk indicates the tool is installed and meets or exceeds recommended version.
	StatusOk Status = "OK"
	// StatusOutdated indicates the installed version is older than recommended.
	StatusOutdated Status = "OUTDATED"
	// StatusMissing indicates the tool was not found in $PATH.
	StatusMissing Status = "MISSING"
	// StatusUnknown indicates the tool is present but its version could not be parsed.
	StatusUnknown Status = "UNKNOWN"
)

// Version models a parsed semantic version string.
type Version struct {
	Raw        string
	Major      int
	Minor      int
	Patch      int
	Prerelease string
	IsDevel    bool
}

// ParseVersion converts raw version strings into a structured Version.
func ParseVersion(vStr string) Version {
	vStr = strings.TrimSpace(vStr)
	v := Version{Raw: vStr}

	if vStr == "" {
		return v
	}

	lower := strings.ToLower(vStr)
	if lower == "devel" || lower == "(devel)" || strings.HasPrefix(lower, "devel") {
		v.IsDevel = true
		return v
	}

	clean := strings.TrimPrefix(vStr, "v")
	clean = strings.TrimPrefix(clean, "V")
	clean = strings.TrimPrefix(clean, "go")

	mainPart := clean
	if idx := strings.IndexAny(clean, "-+"); idx != -1 {
		mainPart = clean[:idx]
		v.Prerelease = clean[idx+1:]
	}

	parts := strings.Split(mainPart, ".")
	if len(parts) >= 1 {
		v.Major, _ = strconv.Atoi(parts[0])
	}
	if len(parts) >= 2 {
		v.Minor, _ = strconv.Atoi(parts[1])
	}
	if len(parts) >= 3 {
		v.Patch, _ = strconv.Atoi(parts[2])
	}

	return v
}

// Compare compares version v to target (-1 if v < target, 0 if v == target, +1 if v > target).
func (v Version) Compare(target Version) int {
	if v.Major != target.Major {
		if v.Major < target.Major {
			return -1
		}
		return 1
	}
	if v.Minor != target.Minor {
		if v.Minor < target.Minor {
			return -1
		}
		return 1
	}
	if v.Patch != target.Patch {
		if v.Patch < target.Patch {
			return -1
		}
		return 1
	}
	if v.Prerelease != "" && target.Prerelease == "" {
		return -1
	}
	if v.Prerelease == "" && target.Prerelease != "" {
		return 1
	}
	if v.Prerelease != "" && target.Prerelease != "" {
		return strings.Compare(v.Prerelease, target.Prerelease)
	}
	return 0
}

// Satisfies determines if installed version satisfies the constraint.
func Satisfies(installed Version, constraint string) bool {
	constraint = strings.TrimSpace(constraint)
	if constraint == "" || strings.EqualFold(constraint, "latest") {
		return true
	}
	if installed.IsDevel {
		return true
	}

	if strings.HasPrefix(constraint, ">=") {
		targetStr := strings.TrimSpace(strings.TrimPrefix(constraint, ">="))
		target := ParseVersion(targetStr)
		return installed.Compare(target) >= 0
	}
	if strings.HasPrefix(constraint, ">") {
		targetStr := strings.TrimSpace(strings.TrimPrefix(constraint, ">"))
		target := ParseVersion(targetStr)
		return installed.Compare(target) > 0
	}
	if strings.HasPrefix(constraint, "<=") {
		targetStr := strings.TrimSpace(strings.TrimPrefix(constraint, "<="))
		target := ParseVersion(targetStr)
		return installed.Compare(target) <= 0
	}
	if strings.HasPrefix(constraint, "=") {
		targetStr := strings.TrimSpace(strings.TrimPrefix(constraint, "="))
		target := ParseVersion(targetStr)
		return installed.Compare(target) == 0
	}

	target := ParseVersion(constraint)
	return installed.Compare(target) >= 0
}

var (
	genericSemverRe = regexp.MustCompile(`v?([0-9]+\.[0-9]+(?:\.[0-9]+)?(?:-[0-9a-zA-Z.+_-]+)?)`)
	valeVersionRe   = regexp.MustCompile(`(?i)vale(?:\.exe)?\s+(?:version\s+)?v?([0-9]+\.[0-9]+(?:\.[0-9]+)?)`)
	gitVersionRe    = regexp.MustCompile(`(?i)git\s+version\s+([0-9]+\.[0-9]+(?:\.[0-9]+)?)`)
	hugoVersionRe   = regexp.MustCompile(`(?i)hugo(?:\.exe)?\s+(?:version\s+)?v?([0-9]+\.[0-9]+(?:\.[0-9]+)?)`)
	goVersionRe     = regexp.MustCompile(`(?i)go\s+version\s+(?:go)?([0-9]+\.[0-9]+(?:\.[0-9]+)?)`)
)

// ExtractVersion searches text using regex and returns the first capture group.
func ExtractVersion(text string, re *regexp.Regexp) string {
	if re == nil || text == "" {
		return ""
	}
	matches := re.FindStringSubmatch(text)
	if len(matches) > 1 && matches[1] != "" {
		return strings.TrimSpace(matches[1])
	}
	return ""
}

// ToolSpec defines inspection metadata and upgrade guidance for an external utility.
type ToolSpec struct {
	ID                 string         `json:"id"`
	DisplayName        string         `json:"display_name"`
	Binaries           []string       `json:"binaries"`
	VersionArgs        [][]string     `json:"version_args"`
	OutputRegex        *regexp.Regexp `json:"-"`
	DefaultRecommended string         `json:"default_recommended"`
	Category           string         `json:"category"`
	Required           bool           `json:"required"`
	InstallGuide       string         `json:"install_guide"`
	UpgradeCommand     string         `json:"upgrade_command"`
	Timeout            time.Duration  `json:"timeout,omitempty"`
}

// ToolStatus represents the evaluation result of an external utility.
type ToolStatus struct {
	ID                 string `json:"id"`
	DisplayName        string `json:"display_name"`
	Status             Status `json:"status"` // OK, OUTDATED, MISSING, UNKNOWN
	BinaryPath         string `json:"binary_path,omitempty"`
	InstalledVersion   string `json:"installed_version,omitempty"`
	RecommendedVersion string `json:"recommended_version"`
	Satisfies          bool   `json:"satisfies"`
	UpgradeCommand     string `json:"upgrade_command,omitempty"`
	Category           string `json:"category,omitempty"`
	Required           bool   `json:"required"`
}

// CheckRunner abstracts command execution and path lookups for testability.
type CheckRunner interface {
	LookPath(file string) (string, error)
	RunCommand(ctx context.Context, name string, args ...string) ([]byte, error)
}

type stdCheckRunner struct{}

func (r *stdCheckRunner) LookPath(file string) (string, error) {
	return safeshell.LookPath(file)
}

func (r *stdCheckRunner) RunCommand(ctx context.Context, name string, args ...string) ([]byte, error) {
	res, err := safeshell.Execute(ctx, name, args...)
	if err != nil && (res == nil || len(res.Stdout) == 0) {
		return nil, err
	}
	if res != nil {
		if len(res.Stdout) > 0 {
			return res.Stdout, nil
		}
		return res.Combined, nil
	}
	return nil, err
}

// DefaultCheckRegistry returns the catalog of external dependencies checked by Speedgrapher.
func DefaultCheckRegistry() []ToolSpec {
	return []ToolSpec{
		{
			ID:                 "vale",
			DisplayName:        "Vale Linter",
			Binaries:           []string{"vale"},
			VersionArgs:        [][]string{{"-v"}, {"--version"}},
			OutputRegex:        valeVersionRe,
			DefaultRecommended: "latest",
			Category:           "linter",
			Required:           false,
			InstallGuide:       "brew install vale (or https://vale.sh/docs/vale-cli/installation/)",
			UpgradeCommand:     "brew upgrade vale",
			Timeout:            2 * time.Second,
		},
		{
			ID:                 "git",
			DisplayName:        "Git VCS",
			Binaries:           []string{"git"},
			VersionArgs:        [][]string{{"version"}, {"--version"}},
			OutputRegex:        gitVersionRe,
			DefaultRecommended: ">=2.30.0",
			Category:           "vcs",
			Required:           false,
			InstallGuide:       "brew install git (or https://git-scm.com/)",
			UpgradeCommand:     "brew upgrade git",
			Timeout:            2 * time.Second,
		},
		{
			ID:                 "hugo",
			DisplayName:        "Hugo SSG",
			Binaries:           []string{"hugo"},
			VersionArgs:        [][]string{{"version"}},
			OutputRegex:        hugoVersionRe,
			DefaultRecommended: "latest",
			Category:           "ssg",
			Required:           false,
			InstallGuide:       "brew install hugo (or https://gohugo.io/installation/)",
			UpgradeCommand:     "brew upgrade hugo",
			Timeout:            2 * time.Second,
		},
		{
			ID:                 "go",
			DisplayName:        "Go Toolchain",
			Binaries:           []string{"go"},
			VersionArgs:        [][]string{{"version"}},
			OutputRegex:        goVersionRe,
			DefaultRecommended: ">=1.24.0",
			Category:           "compiler",
			Required:           false,
			InstallGuide:       "brew upgrade go (or https://go.dev/dl/)",
			UpgradeCommand:     "brew upgrade go",
			Timeout:            2 * time.Second,
		},
	}
}

// Checker coordinates inspecting external dependencies.
type Checker struct {
	runner CheckRunner
}

// NewChecker creates a Checker instance with the given runner (or stdCheckRunner if nil).
func NewChecker(runner CheckRunner) *Checker {
	if runner == nil {
		runner = &stdCheckRunner{}
	}
	return &Checker{runner: runner}
}

// CheckTool inspects a single tool spec.
func (c *Checker) CheckTool(ctx context.Context, spec ToolSpec) (ToolStatus, error) {
	var foundPath string
	for _, bin := range spec.Binaries {
		if p, err := c.runner.LookPath(bin); err == nil && p != "" {
			foundPath = p
			break
		}
	}

	if foundPath == "" {
		return ToolStatus{
			ID:                 spec.ID,
			DisplayName:        spec.DisplayName,
			RecommendedVersion: spec.DefaultRecommended,
			Category:           spec.Category,
			Required:           spec.Required,
			Status:             StatusMissing,
			Satisfies:          false,
			UpgradeCommand:     spec.InstallGuide,
		}, nil
	}

	var rawVer string
	timeout := spec.Timeout
	if timeout <= 0 {
		timeout = 2 * time.Second
	}

	for _, args := range spec.VersionArgs {
		cmdCtx, cancel := context.WithTimeout(ctx, timeout)
		out, err := c.runner.RunCommand(cmdCtx, foundPath, args...)
		cancel()

		if err == nil || len(out) > 0 {
			outStr := string(out)
			if spec.OutputRegex != nil {
				if extracted := ExtractVersion(outStr, spec.OutputRegex); extracted != "" {
					rawVer = extracted
					break
				}
			}
			if extracted := ExtractVersion(outStr, genericSemverRe); extracted != "" {
				rawVer = extracted
				break
			}
		}
	}

	status := ToolStatus{
		ID:                 spec.ID,
		DisplayName:        spec.DisplayName,
		RecommendedVersion: spec.DefaultRecommended,
		Category:           spec.Category,
		Required:           spec.Required,
		BinaryPath:         foundPath,
		InstalledVersion:   rawVer,
	}

	if rawVer == "" {
		status.Status = StatusUnknown
		status.Satisfies = true
		return status, nil
	}

	parsed := ParseVersion(rawVer)
	status.Satisfies = Satisfies(parsed, spec.DefaultRecommended)
	if status.Satisfies {
		status.Status = StatusOk
	} else {
		status.Status = StatusOutdated
		status.UpgradeCommand = spec.UpgradeCommand
	}

	return status, nil
}

// CheckAll evaluates all specs.
func (c *Checker) CheckAll(ctx context.Context, specs ...ToolSpec) ([]ToolStatus, error) {
	if len(specs) == 0 {
		specs = DefaultCheckRegistry()
	}

	results := make([]ToolStatus, 0, len(specs))
	for _, spec := range specs {
		st, err := c.CheckTool(ctx, spec)
		if err != nil {
			return nil, err
		}
		results = append(results, st)
	}
	return results, nil
}

func formatStatusBadge(st ToolStatus) (badge string, isHealthy, isOutdated, isMissing bool, rec string) {
	badge = string(st.Status)
	switch st.Status {
	case StatusOk:
		badge = "✓ OK"
		isHealthy = true
	case StatusOutdated:
		badge = "⚠️ OUTDATED"
		isOutdated = true
		if st.UpgradeCommand != "" {
			rec = fmt.Sprintf("• Upgrade %s:\n    $ %s", st.DisplayName, st.UpgradeCommand)
		}
	case StatusMissing:
		badge = "✗ MISSING"
		isMissing = true
		if st.UpgradeCommand != "" {
			rec = fmt.Sprintf("• Install %s:\n    $ %s", st.DisplayName, st.UpgradeCommand)
		}
	case StatusUnknown:
		badge = "? UNKNOWN"
		isHealthy = true
	}
	return badge, isHealthy, isOutdated, isMissing, rec
}

// FormatStatusTable renders a formatted table suitable for terminal display.
func FormatStatusTable(statuses []ToolStatus) string {
	var sb strings.Builder

	sb.WriteString("========================================================================================\n")
	sb.WriteString("               🩺 Speedgrapher Environment & Tool Diagnostic Check                     \n")
	sb.WriteString("========================================================================================\n\n")

	fmt.Fprintf(&sb, "  %-18s %-12s %-12s %-14s %s\n",
		"TOOL", "STATUS", "INSTALLED", "RECOMMENDED", "UPGRADE / INSTALL GUIDE")
	sb.WriteString("  ──────────────────────────────────────────────────────────────────────────────────────\n")

	var healthyCount, outdatedCount, missingCount int
	var recommendations []string

	for _, st := range statuses {
		statusBadge, isHealthy, isOutdated, isMissing, rec := formatStatusBadge(st)
		if isHealthy {
			healthyCount++
		}
		if isOutdated {
			outdatedCount++
		}
		if isMissing {
			missingCount++
		}
		if rec != "" {
			recommendations = append(recommendations, rec)
		}

		installed := st.InstalledVersion
		if installed == "" {
			installed = "none"
		}

		upgradeCmd := st.UpgradeCommand
		if upgradeCmd == "" {
			upgradeCmd = "(up to date)"
		}

		fmt.Fprintf(&sb, "  %-18s %-12s %-12s %-14s %s\n",
			st.DisplayName, statusBadge, installed, st.RecommendedVersion, upgradeCmd)
	}

	sb.WriteString("  ──────────────────────────────────────────────────────────────────────────────────────\n")
	fmt.Fprintf(&sb, "Summary: %d/%d tools healthy", healthyCount, len(statuses))
	if outdatedCount > 0 {
		fmt.Fprintf(&sb, ", %d outdated", outdatedCount)
	}
	if missingCount > 0 {
		fmt.Fprintf(&sb, ", %d missing", missingCount)
	}
	sb.WriteString(".\n")

	if len(recommendations) > 0 {
		sb.WriteString("\n💡 Recommended Actions:\n")
		for _, rec := range recommendations {
			sb.WriteString("  " + rec + "\n")
		}
	}
	sb.WriteString("========================================================================================\n")
	return sb.String()
}

func outputCheckResults(stdout io.Writer, statuses []ToolStatus, jsonOutput bool) error {
	if jsonOutput {
		data, err := json.MarshalIndent(statuses, "", "  ")
		if err != nil {
			return fmt.Errorf("failed to format JSON: %w", err)
		}
		_, _ = fmt.Fprintln(stdout, string(data))
		return nil
	}
	table := FormatStatusTable(statuses)
	_, _ = fmt.Fprint(stdout, table)
	return nil
}

func newCheckCmd(stdout, stderr io.Writer) *cobra.Command {
	_ = stderr
	var jsonOutput bool
	var strict bool
	var dir string

	cmd := &cobra.Command{
		Use:   "check",
		Short: "Inspect installed external tools, versions, and health status",
		RunE: func(cmd *cobra.Command, _ []string) error {
			checker := NewChecker(nil)
			statuses, err := checker.CheckAll(cmd.Context())
			if err != nil {
				return fmt.Errorf("tool check failed: %w", err)
			}

			if err := outputCheckResults(stdout, statuses, jsonOutput); err != nil {
				return err
			}

			if strict {
				var unhealthy []string
				for _, st := range statuses {
					if st.Status == StatusMissing || st.Status == StatusOutdated {
						unhealthy = append(unhealthy, fmt.Sprintf("%s (%s)", st.DisplayName, st.Status))
					}
				}
				if len(unhealthy) > 0 {
					return fmt.Errorf("strict check failed: %d unhealthy tools: %s", len(unhealthy), strings.Join(unhealthy, ", "))
				}
			}

			return nil
		},
	}

	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Output check results in JSON format")
	cmd.Flags().BoolVar(&strict, "strict", false, "Fail with non-zero exit code if any tool is missing or outdated")
	cmd.Flags().StringVarP(&dir, "dir", "d", "", "Workspace directory to check (default: current directory)")

	return cmd
}
