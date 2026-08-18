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
	"fmt"
	"io"
	"strings"

	"github.com/danicat/speedgrapher/internal/config"
	"github.com/danicat/speedgrapher/internal/server"
	"github.com/spf13/cobra"
)

func newMCPCmd(version string, opts *GlobalOptions, stdout, stderr io.Writer) *cobra.Command {
	_ = stdout
	_ = stderr
	var listenAddr string
	var httpAddr string
	var transport string
	var configPath string

	cmd := &cobra.Command{
		Use:   "mcp",
		Short: "Run in Model Context Protocol (MCP) server mode",
		RunE: func(cmd *cobra.Command, _ []string) error {
			if configPath == "" && opts != nil {
				configPath = opts.ConfigPath
			}

			cfg, _ := config.Load(configPath)
			var srvOpts []server.Option
			if cfg != nil {
				srvOpts = append(srvOpts, server.WithServerConfig(cfg.Server))
			}

			srv := server.New(version, srvOpts...)

			if listenAddr == "" && httpAddr != "" {
				listenAddr = httpAddr
			}

			transport = strings.ToLower(strings.TrimSpace(transport))
			if transport == "http" || listenAddr != "" {
				if listenAddr == "" && cfg != nil && cfg.Server.ListenAddr != "" {
					listenAddr = cfg.Server.ListenAddr
				}
				if listenAddr == "" {
					listenAddr = ":8080"
				}
				return srv.ServeHTTP(cmd.Context(), listenAddr)
			}

			if transport != "" && transport != "stdio" {
				return fmt.Errorf("unsupported transport %q (must be 'stdio' or 'http')", transport)
			}

			return srv.Run(cmd.Context())
		},
	}

	cmd.Flags().StringVarP(&listenAddr, "listen", "l", "", "HTTP listen address (e.g. :8080)")
	cmd.Flags().StringVar(&httpAddr, "http", "", "Alias for --listen")
	cmd.Flags().StringVarP(&transport, "transport", "t", "stdio", "MCP transport protocol (stdio | http)")
	cmd.Flags().StringVarP(&configPath, "config", "c", "", "Explicit path to configuration file")

	return cmd
}

// runMCP provides backward compatibility for legacy callers.
func runMCP(ctx context.Context, version string, args []string) error {
	cmd := newMCPCmd(version, nil, nil, nil)
	cmd.SetArgs(args)
	return cmd.ExecuteContext(ctx)
}
