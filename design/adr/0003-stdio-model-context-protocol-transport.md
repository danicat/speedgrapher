# ADR-0003: Stdio Model Context Protocol Transport

- **Status:** Approved
- **Date:** 2026-05-28
- **Author(s):** Antigravity
- **Deciders:** USER, Antigravity

## 1. Context
Speedgrapher is an assistant server designed to integrate directly with LLM clients (like the Gemini CLI/desktop app or other Model Context Protocol clients). We need a fast, reliable, and secure communication layer to pass tools, prompts, and resources.

## 2. Decision
We build Speedgrapher as a standard Model Context Protocol (MCP) server using the official Go SDK (`github.com/modelcontextprotocol/go-sdk`), communicating over the standard input/output (`stdio`) transport layer.
- Alternatives considered:
  - *SSE (Server-Sent Events) over HTTP*: Discarded because it requires open local ports, firewalls permission, and complex connection lifecycle management. Stdio is simpler, secure, and scoped strictly to the parent process lifetime.

## 3. Consequences
- **Positive:**
  - Standard compliance with any MCP-capable host client.
  - No network socket management or port conflicts on local machines.
  - Process lifecycle is bound to the parent client, preventing orphaned processes.
- **Negative:**
  - Standard standard input/output (`os.Stdout` / `os.Stdin`) must be guarded. Developers cannot write raw logs or debug statements to stdout as it will corrupt the JSON-RPC packet stream.

## 4. Compliance & Verification
- Verified by checking that `cmd/speedgrapher/main.go` runs the server using `&mcp.StdioTransport{}`.
