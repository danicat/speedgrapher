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
	"fmt"
	"io"
	"strings"

	"github.com/spf13/cobra"
)

func newListCmd(stdout io.Writer) *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List all available editorial intelligence tools",
		RunE: func(_ *cobra.Command, _ []string) error {
			return runList(stdout)
		},
	}
}

func runList(stdout io.Writer) error {
	var sb strings.Builder
	sb.WriteString("Available speedgrapher tools:\n\n")

	for _, tool := range GetTools() {
		aliasStr := ""
		if len(tool.Aliases) > 0 {
			aliasStr = fmt.Sprintf(" (aliases: %s)", strings.Join(tool.Aliases, ", "))
		}
		sb.WriteString(fmt.Sprintf("  • %s%s\n", tool.Name, aliasStr))
		sb.WriteString(fmt.Sprintf("    %s\n", tool.Description))
		sb.WriteString(fmt.Sprintf("    Usage: %s\n\n", tool.Usage))
	}

	_, err := fmt.Fprint(stdout, sb.String())
	return err
}
