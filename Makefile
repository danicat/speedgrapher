# Makefile for speedgrapher

.PHONY: build
build:
	go build -o bin/speedgrapher ./cmd/speedgrapher

.PHONY: install
install:
	go install ./cmd/speedgrapher/...

.PHONY: clean
clean:
	rm -rf bin

.PHONY: test
test:
	go test ./...
