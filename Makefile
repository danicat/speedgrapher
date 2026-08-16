# Makefile for speedgrapher

# Sane default for VERSION derived dynamically from Git tags
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null | sed 's/^v//')
ifeq ($(VERSION),)
  VERSION := dev
endif
LDFLAGS = -ldflags "-s -w -X main.version=$(VERSION)"

BINARY_DIR = bin
BINARY_NAME = speedgrapher
BINARY = $(BINARY_DIR)/$(BINARY_NAME)

build:
	@mkdir -p $(BINARY_DIR)
	go build $(LDFLAGS) -o $(BINARY) ./cmd/speedgrapher

install:
	@./install.sh

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

# Usage: make bump-version VERSION=0.8.0
bump-version:
	@if [ "$(origin VERSION)" != "command line" ]; then \
		echo "Error: VERSION must be explicitly specified on the command line. Usage: make bump-version VERSION=0.8.0"; \
		exit 1; \
	fi
	git tag -a v$(VERSION) -m "Release v$(VERSION)"
	@echo "Created git tag v$(VERSION). Push with: git push origin v$(VERSION)"

.PHONY: build install clean test test-cov bump-version snapshot release
