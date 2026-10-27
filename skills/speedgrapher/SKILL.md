---
name: speedgrapher
description: >
  Opens the Speedgrapher side-panel Markdown editor in the Antigravity
  auxiliary pane by surfacing a sidecar://speedgrapher/panel/ pill in chat.
license: Apache-2.0
metadata:
  category: writing
  tags: "writing, markdown, editor, blog, article, documentation, prose"
  author: Daniela Petruzalek (daniela@danicat.dev)
  version: "0.12.1"
---

# Speedgrapher: Side-Panel Launcher

Surfaces a `sidecar://speedgrapher/panel/` pill in chat to open the Speedgrapher side-panel Markdown editor in the auxiliary pane.

## Displaying the Side-Panel Pill

1. **Resolve the target `.md` file (if any)**:
   - If the user passed a filename or path, or if a specific `.md` file is in scope, resolve its absolute path on disk.
2. **Output the `sidecar://` pill in chat** (using the file's basename as the link label when a file is known):
   - **With a target `.md` file**:
     ```markdown
     [file.md](sidecar://speedgrapher/panel/?file=/absolute/path/to/file.md)
     ```
   - **Without a specific file**:
     ```markdown
     [Speedgrapher](sidecar://speedgrapher/panel/)
     ```
