# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Sane default for VERSION derived dynamically from Git tags
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null | sed 's/^v//')
ifeq ($(VERSION),)
  VERSION := dev
endif
LDFLAGS = -ldflags "-s -w -X main.version=$(VERSION)"

BINARY_DIR = bin
BINARY_NAME = speedgrapher
BINARY = $(BINARY_DIR)/$(BINARY_NAME)
PLUGIN_DIR ?= $(HOME)/.gemini/config/plugins/speedgrapher

build:
	@mkdir -p $(BINARY_DIR)
	go build $(LDFLAGS) -o $(BINARY) ./cmd/speedgrapher
	go install $(LDFLAGS) ./cmd/speedgrapher

install-plugin: build
	@mkdir -p $(PLUGIN_DIR)
	@TMP_VOCAB=""; \
	if [ -f "$(PLUGIN_DIR)/styles/config/vocabularies/Speedgrapher/accept.txt" ]; then \
		TMP_VOCAB=$$(mktemp); \
		cp "$(PLUGIN_DIR)/styles/config/vocabularies/Speedgrapher/accept.txt" "$$TMP_VOCAB"; \
	fi; \
	TMP_VALE=""; \
	if [ -f "$(PLUGIN_DIR)/.vale.ini" ]; then \
		TMP_VALE=$$(mktemp); \
		cp "$(PLUGIN_DIR)/.vale.ini" "$$TMP_VALE"; \
	fi; \
	rsync -a --delete \
		--exclude='.git/' \
		--exclude='dist/' \
		--exclude='.gemini/' \
		--exclude='.godoctor/' \
		--exclude='coverage.out' \
		./ $(PLUGIN_DIR)/; \
	if [ -n "$$TMP_VOCAB" ] && [ -f "$$TMP_VOCAB" ]; then \
		awk 'NF && !seen[$$0]++' "$(PLUGIN_DIR)/styles/config/vocabularies/Speedgrapher/accept.txt" "$$TMP_VOCAB" > "$$TMP_VOCAB.merged" && \
		mv "$$TMP_VOCAB.merged" "$(PLUGIN_DIR)/styles/config/vocabularies/Speedgrapher/accept.txt"; \
		rm -f "$$TMP_VOCAB"; \
	fi; \
	if [ -n "$$TMP_VALE" ] && [ -f "$$TMP_VALE" ]; then \
		cp "$$TMP_VALE" "$(PLUGIN_DIR)/.vale.ini"; \
		rm -f "$$TMP_VALE"; \
	fi
	@SIDECAR_PID=$$(lsof -a -d cwd -c "Antigravity" 2>/dev/null | grep "speedgrapher/sidecars/panel" | awk '{print $$2}'); \
	if [ -n "$$SIDECAR_PID" ]; then \
		kill $$SIDECAR_PID 2>/dev/null && echo "Restarted Speedgrapher sidecar process (PID $$SIDECAR_PID)."; \
	fi
	@if [ -n "$$ANTIGRAVITY_LS_ADDRESS" ] && [ -n "$$ANTIGRAVITY_CSRF_TOKEN" ]; then \
		curl -sS -X POST "http://$$ANTIGRAVITY_LS_ADDRESS/exa.language_server_pb.LanguageServerService/JetboxWriteState" \
			-H "Content-Type: application/json" \
			-H "x-codeium-csrf-token: $$ANTIGRAVITY_CSRF_TOKEN" \
			-d '{"userConfig":{"plugins":{"speedgrapher":{"enabled":false}}}}' >/dev/null && \
		sleep 0.5 && \
		curl -sS -X POST "http://$$ANTIGRAVITY_LS_ADDRESS/exa.language_server_pb.LanguageServerService/JetboxWriteState" \
			-H "Content-Type: application/json" \
			-H "x-codeium-csrf-token: $$ANTIGRAVITY_CSRF_TOKEN" \
			-d '{"userConfig":{"plugins":{"speedgrapher":{"enabled":true}}}}' >/dev/null && \
		echo "Restarted Speedgrapher sidecar via Antigravity Language Server."; \
	fi
	@echo "Installed speedgrapher binary and synced plugin to $(PLUGIN_DIR)"

install: install-plugin

clean:
	@rm -rf $(BINARY_DIR) coverage.out dist/

test:
	go test -v ./...

test-cov:
	go test -v -coverprofile=coverage.out ./...
	@echo "To view coverage report: go tool cover -html=coverage.out"

snapshot:
	goreleaser release --snapshot --clean

release:
	goreleaser release --clean

# Usage: make bump-version VERSION=1.0.0
bump-version:
	@if [ "$(origin VERSION)" != "command line" ]; then \
		echo "Error: VERSION must be explicitly specified on the command line. Usage: make bump-version VERSION=1.0.0"; \
		exit 1; \
	fi
	git tag -a v$(VERSION) -m "Release v$(VERSION)"
	@echo "Created git tag v$(VERSION). Push with: git push origin v$(VERSION)"

.PHONY: build install-plugin install clean test test-cov bump-version snapshot release
