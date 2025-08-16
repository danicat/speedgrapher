# Makefile for speedgrapher

VERSION ?= $(shell git describe --tags --always --dirty)
LDFLAGS = -ldflags "-X main.version=${VERSION}"

.PHONY: build
build:
	go build ${LDFLAGS} -o bin/speedgrapher ./cmd/speedgrapher

.PHONY: install
install:
	go install ${LDFLAGS} ./cmd/speedgrapher/...

.PHONY: clean
clean:
	rm -rf bin

.PHONY: test
test:
	go test ./...

.PHONY: tag
tag:
	@echo "Usage: git tag v<version>"
	@echo "Example: git tag v0.1.0"
