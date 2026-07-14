# Makefile for speedgrapher

# Version derived dynamically from Git tags
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null | sed 's/^v//')
ifeq ($(VERSION),)
  VERSION := dev
endif
LDFLAGS=-ldflags "-X main.version=$(VERSION)"

BINARY_DIR=bin
BINARY_NAME=speedgrapher
BINARY=$(BINARY_DIR)/$(BINARY_NAME)


build:
	@mkdir -p $(BINARY_DIR)
	go build $(LDFLAGS) -o $(BINARY) ./cmd/speedgrapher

install:
	go install $(LDFLAGS) ./cmd/speedgrapher/...

clean:
	@rm -rf $(BINARY_DIR)

test:
	go test -v ./...

test-cov:
	go test -v -coverprofile=coverage.out ./...
	@echo "to view the coverage report, run: go tool cover -html=coverage.out"

snapshot:
	goreleaser release --snapshot --clean

release:
	goreleaser release --clean

# Usage: make bump-version VERSION=0.7.0
bump-version:
	@if [ "$(origin VERSION)" != "command line" ]; then \
		echo "Error: VERSION must be explicitly specified on the command line. Usage: make bump-version VERSION=0.7.0"; \
		exit 1; \
	fi
	@python3 -c "import re; f = 'plugin.json'; content = open(f).read(); new_content = re.sub(r'\"version\":\s*\"[^\"]+\"', '\"version\": \"$(VERSION)\"', content); open(f, 'w').write(new_content);"
	@echo "Successfully bumped version to $(VERSION) in plugin.json"

verify-version:
	@MANIFEST_VERSION=$$(grep '"version":' plugin.json | cut -d'"' -f4); \
	GIT_TAG=$$(git describe --tags --exact-match 2>/dev/null | sed 's/^v//' || echo ""); \
	if [ -z "$$GIT_TAG" ]; then \
		echo "Warning: No exact git tag match found for current commit. Verification skipped."; \
	else \
		echo "Verifying version alignment: Manifest ($$MANIFEST_VERSION) vs Git Tag ($$GIT_TAG)..."; \
		if [ "$$MANIFEST_VERSION" != "$$GIT_TAG" ]; then \
			echo "Error: Version mismatch! Manifest version ($$MANIFEST_VERSION) does not match Git tag ($$GIT_TAG)."; \
			exit 1; \
		fi; \
		echo "Success: Versions are aligned."; \
	fi

.PHONY: build install clean test test-cov snapshot release bump-version verify-version
