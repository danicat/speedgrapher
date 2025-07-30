# Speedgrapher

Speedgrapher is an MCP server to support bloggers and writers in general.

## What is it?

Speedgrapher is an MCP server designed to assist professional writers, with a particular focus on those in the tech industry. It provides a suite of tools and resources to streamline the writing process, from research and drafting to editing and publishing. The server is designed to be used as a local companion, running on the writer's own machine.

## How it works

Speedgrapher is written in Go and implements the Model Context Protocol (MCP). It uses the [official Go SDK for MCP](https://github.com/modelcontextprotocol/go-sdk) and communicates over the `stdio` transport layer. This design choice makes it a lightweight and secure local server, with no need for network deployment.

A key reference for this project is the [godoctor](httpss://github.com/danicat/godoctor) implementation, which also serves as an MCP server written in Go.

## Getting Started

To get started with Speedgrapher, you'll need to have Go installed on your system.

### Building the server

You can build the server by running the following command:

```bash
make build
```

This will create an executable file at `bin/speedgrapher`.

### Testing the server

To test that the server is running correctly, you can send it a `ping` request. The server will respond with an empty JSON object if it is successful.

```bash
(
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}';
  echo '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}';
  echo '{"jsonrpc":"2.0","id":2,"method":"ping","params":{}}';
) | ./bin/speedgrapher
```

## Resources

*   **Model Context Protocol Specification:** [https://modelcontextprotocol.io/specification/2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18)
*   **Go SDK for MCP:** [https://github.com/modelcontextprotocol/go-sdk](https://github.com/modelcontextprotocol/go-sdk)
*   **Reference MCP Server (godoctor):** [https://github.com/danicat/godoctor](https://github.com/danicat/godoctor)
*   **How to build an MCP server with Gemini CLI and Go:** [https://danicat.dev/posts/20250729-how-to-build-an-mcp-server-with-gemini-cli-and-go/](https://danicat.dev/posts/20250729-how-to-build-an-mcp-server-with-gemini-cli-and-go/)
