# Makefile for speedgrapher

VERSION := v0.5.8
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
