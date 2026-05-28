# Makefile for speedgrapher

VERSION ?= $(shell grep '"version":' gemini-extension.json | cut -d'"' -f4)

LDFLAGS = -ldflags "-X main.version=${VERSION}"

.PHONY: build
build:
	go build ${LDFLAGS} -o speedgrapher ./cmd/speedgrapher

.PHONY: install
install:
	go install ${LDFLAGS} ./cmd/speedgrapher/...

.PHONY: clean
clean:
	rm -f speedgrapher

.PHONY: test
test:
	go test ./...

.PHONY: snapshot
snapshot:
	goreleaser release --snapshot --clean

.PHONY: release
release:
	goreleaser release --clean


.PHONY: extension
extension: build
	gemini extensions install .

.PHONY: tag
tag:
	@echo "Usage: git tag v<version>"
	@echo "Example: git tag v0.1.0"

.PHONY: verify-version
verify-version:
	@MANIFEST_VERSION=$$(grep '"version":' gemini-extension.json | cut -d'"' -f4); \
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

