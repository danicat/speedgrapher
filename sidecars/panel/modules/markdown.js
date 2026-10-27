// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { escapeHtml, MAX_HISTORY_ENTRIES, runtime, state } from './state.js';

export function parseReviewCommentLine(trimmedLine) {
  const rawLine = typeof trimmedLine === 'string' ? trimmedLine : '';
  const trimmed = rawLine.trim();
  const match = trimmed.match(/^<!--\s*review(?:\(((?:[^")]|"(?:\\.|[^"\\])*")*)\))?:\s*([\s\S]*?)\s*-->$/i);
  if (!match) return null;
  const attrStr = match[1] || '';
  const text = (match[2] || '').trim();
  if (!text || text === '...' || text === '…') return null;
  const attrs = {};
  const attrRe = /([a-zA-Z0-9_-]+)\s*=\s*"((?:\\.|[^"\\])*)"/g;
  let m;
  while ((m = attrRe.exec(attrStr)) !== null) {
    attrs[m[1].toLowerCase()] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  const hasExplicitId = Boolean(attrs.id);
  const quote = attrs.quote || '';
  const ts = attrs.ts || '';
  return {
    id: attrs.id || `rev-${Math.random().toString(36).slice(2, 8)}`,
    hasExplicitId,
    quote,
    ts,
    text,
    _rawLine: rawLine,
    _origText: text,
    _origQuote: quote,
    _origTs: ts,
  };
}

export function formatReviewCommentHtml(reviewObj) {
  if (
    reviewObj &&
    typeof reviewObj === 'object' &&
    typeof reviewObj._rawLine === 'string' &&
    reviewObj.text === reviewObj._origText &&
    (reviewObj.quote || '') === (reviewObj._origQuote || '') &&
    (reviewObj.ts || '') === (reviewObj._origTs || '')
  ) {
    return reviewObj._rawLine;
  }
  const rawText = (typeof reviewObj === 'string' ? reviewObj : reviewObj?.text || '')
    .replace(/-->/g, '--&gt;')
    .trim();
  if (!rawText) return '';
  if (typeof reviewObj === 'string') {
    return `<!-- review: ${rawText} -->`;
  }
  const includeId = Boolean(
    reviewObj.id && (reviewObj.hasExplicitId !== false || reviewObj.quote || reviewObj.ts)
  );
  if (!includeId && !reviewObj.quote && !reviewObj.ts) {
    return `<!-- review: ${rawText} -->`;
  }
  const attrParts = [];
  if (includeId) {
    const safeId = String(reviewObj.id).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    attrParts.push(`id="${safeId}"`);
  }
  if (reviewObj.quote) {
    const safeQuote = String(reviewObj.quote)
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
    if (safeQuote) attrParts.push(`quote="${safeQuote}"`);
  }
  if (reviewObj.ts) {
    const safeTs = String(reviewObj.ts).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    attrParts.push(`ts="${safeTs}"`);
  }
  if (attrParts.length === 0) {
    return `<!-- review: ${rawText} -->`;
  }
  return `<!-- review(${attrParts.join(', ')}): ${rawText} -->`;
}

export function isIndentedContinuationMarker(trimmed) {
  return (
    /^[-*+]\s+/.test(trimmed) ||
    /^\d+\.\s+/.test(trimmed) ||
    /^```/.test(trimmed) ||
    /^#{1,6}\s+/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed) ||
    /^\|/.test(trimmed)
  );
}

export function parseMarkdownTableStructure(rawText) {
  const lines = String(rawText || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;

  const hasPipe0 = lines[0].includes('|');
  const sepRaw = lines[1].trim();
  if (!hasPipe0 || !sepRaw.includes('|') || !sepRaw.includes('-')) return null;

  const stripOuterPipes = (line) => {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    return s;
  };

  const splitTableCells = (line) => {
    const inner = stripOuterPipes(line);
    const cells = [];
    let current = '';
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '\\' && i + 1 < inner.length && inner[i + 1] === '|') {
        current += '|';
        i++;
      } else if (inner[i] === '|') {
        cells.push(current.trim());
        current = '';
      } else {
        current += inner[i];
      }
    }
    cells.push(current.trim());
    return cells;
  };

  const sepCells = splitTableCells(lines[1]);
  if (sepCells.length === 0 || !sepCells.every((c) => /^:?-{1,}:?$/.test(c))) {
    return null;
  }

  const alignments = sepCells.map((c) => {
    if (c.startsWith(':') && c.endsWith(':')) return 'center';
    if (c.endsWith(':')) return 'right';
    return 'left';
  });

  const headers = splitTableCells(lines[0]);
  const rows = lines.slice(2).map((line) => splitTableCells(line));
  return { headers, alignments, rows };
}

export function parseDocumentIntoBlocks(rawText) {
  const normalized = (rawText || '').replace(/\r\n/g, '\n');
  if (!normalized.trim()) {
    return [];
  }

  const lines = normalized.split('\n');
  const blocks = [];
  let i = 0;
  let seq = 0;

  const nextId = () => `b-${++seq}`;
  const consumeBlankLines = () => {
    let count = 0;
    while (i < lines.length && lines[i].trim() === '') {
      count++;
      i++;
    }
    return count;
  };

  const makeBlock = (fields) => {
    const reviews = Array.isArray(fields.reviews) ? fields.reviews : [];
    return {
      ...fields,
      reviews,
      comments: reviews,
    };
  };

  const consumeReviewComments = (block) => {
    while (true) {
      let lookahead = i;
      while (lookahead < lines.length && lines[lookahead].trim() === '') {
        lookahead++;
      }
      if (lookahead >= lines.length) break;
      const parsedRev = parseReviewCommentLine(lines[lookahead].trim());
      if (!parsedRev) break;
      if (parsedRev.text) {
        block.reviews.push(parsedRev);
      }
      i = lookahead + 1;
      block.endLine = i;
    }
    block.trailingBlankLines = consumeBlankLines();
  };

  const initialBlankLines = consumeBlankLines();

  // 1. YAML / TOML Frontmatter block at start of file
  if (i === 0 && (lines[0].trim() === '---' || lines[0].trim() === '+++')) {
    const delim = lines[0].trim();
    let endIdx = -1;
    for (let j = 1; j < lines.length; j++) {
      if (lines[j].trim() === delim) {
        endIdx = j;
        break;
      }
    }
    if (endIdx !== -1) {
      const raw = lines.slice(0, endIdx + 1).join('\n');
      i = endIdx + 1;
      const blk = makeBlock({
        id: nextId(),
        type: 'frontmatter',
        level: 0,
        raw,
        startLine: 1,
        endLine: endIdx + 1,
        reviews: [],
        trailingBlankLines: 0,
      });
      consumeReviewComments(blk);
      blocks.push(blk);
    }
  }

  while (i < lines.length) {
    if (lines[i].trim() === '') {
      consumeBlankLines();
      continue;
    }

    const startLine = i + 1;
    const line = lines[i];
    const trimmed = line.trim();

    const orphanRev = parseReviewCommentLine(trimmed);
    if (orphanRev) {
      i++;
      if (blocks.length > 0) {
        if (orphanRev.text) {
          blocks[blocks.length - 1].reviews.push(orphanRev);
        }
        blocks[blocks.length - 1].endLine = i;
        blocks[blocks.length - 1].trailingBlankLines = consumeBlankLines();
      }
      continue;
    }

    // Fenced code block (``` or ~~~)
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const blockLines = [line];
      i++;
      while (i < lines.length) {
        blockLines.push(lines[i]);
        if (lines[i].trim().startsWith(fence)) {
          i++;
          break;
        }
        i++;
      }
      const endLine = i;
      const blk = makeBlock({
        id: nextId(),
        type: 'code',
        level: 0,
        raw: blockLines.join('\n'),
        startLine,
        endLine,
        reviews: [],
        trailingBlankLines: 0,
      });
      consumeReviewComments(blk);
      blocks.push(blk);
      continue;
    }

    // Display Math block ($$ ... $$)
    if (trimmed.startsWith('$$')) {
      const blockLines = [line];
      i++;
      const isSingleLineMath = trimmed.length > 4 && trimmed.endsWith('$$');
      if (!isSingleLineMath) {
        while (i < lines.length) {
          blockLines.push(lines[i]);
          if (lines[i].trim().endsWith('$$')) {
            i++;
            break;
          }
          i++;
        }
      }
      const endLine = i;
      const blk = makeBlock({
        id: nextId(),
        type: 'math',
        level: 0,
        raw: blockLines.join('\n'),
        startLine,
        endLine,
        reviews: [],
        trailingBlankLines: 0,
      });
      consumeReviewComments(blk);
      blocks.push(blk);
      continue;
    }

    // ATX Heading (# .. ######)
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      i++;
      const blk = makeBlock({
        id: nextId(),
        type: 'heading',
        level: headingMatch[1].length,
        raw: line,
        startLine,
        endLine: startLine,
        reviews: [],
        trailingBlankLines: 0,
      });
      consumeReviewComments(blk);
      blocks.push(blk);
      continue;
    }

    // Horizontal Rule (---, ***, ___)
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      i++;
      const blk = makeBlock({
        id: nextId(),
        type: 'hr',
        level: 0,
        raw: line,
        startLine,
        endLine: startLine,
        reviews: [],
        trailingBlankLines: 0,
      });
      consumeReviewComments(blk);
      blocks.push(blk);
      continue;
    }

    // Standalone Image block (![alt](src) or <img ...>)
    if (/^!\[[^\]]*\]\([^)\n]+\)\s*$/.test(trimmed) || /^<img\b[^>]*>\s*$/i.test(trimmed)) {
      i++;
      const blk = makeBlock({
        id: nextId(),
        type: 'image',
        level: 0,
        raw: line,
        startLine,
        endLine: startLine,
        reviews: [],
        trailingBlankLines: 0,
      });
      consumeReviewComments(blk);
      blocks.push(blk);
      continue;
    }

    // Blockquote (> ...)
    if (/^>\s?/.test(trimmed)) {
      const blockLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        blockLines.push(lines[i]);
        i++;
      }
      const endLine = i;
      const blk = makeBlock({
        id: nextId(),
        type: 'blockquote',
        level: 0,
        raw: blockLines.join('\n'),
        startLine,
        endLine,
        reviews: [],
        trailingBlankLines: 0,
      });
      consumeReviewComments(blk);
      blocks.push(blk);
      continue;
    }

    // Unordered or Ordered List (including multi-paragraph/nested indented continuations)
    if (/^([-*+]|\d+\.)\s+/.test(trimmed)) {
      const blockLines = [];
      while (i < lines.length) {
        const curLine = lines[i];
        const curTrim = curLine.trim();
        if (curTrim === '') {
          let look = i + 1;
          while (look < lines.length && lines[look].trim() === '') {
            look++;
          }
          if (look < lines.length) {
            const nextLine = lines[look];
            const nextTrim = nextLine.trim();
            const isNextListItem = /^([-*+]|\d+\.)\s+/.test(nextTrim);
            const isIndentedContinuation =
              /^( {2,}|\t+)/.test(nextLine) && !isIndentedContinuationMarker(nextTrim);
            if (isNextListItem || isIndentedContinuation) {
              while (i < look) {
                blockLines.push(lines[i]);
                i++;
              }
              continue;
            }
          }
          break;
        }
        if (
          /^([-*+]|\d+\.)\s+/.test(curTrim) ||
          (/^( {2,}|\t+)/.test(curLine) && !isIndentedContinuationMarker(curTrim))
        ) {
          blockLines.push(curLine);
          i++;
          continue;
        }
        break;
      }
      const endLine = i;
      const blk = makeBlock({
        id: nextId(),
        type: 'list',
        level: 0,
        raw: blockLines.join('\n'),
        startLine,
        endLine,
        reviews: [],
        trailingBlankLines: 0,
      });
      consumeReviewComments(blk);
      blocks.push(blk);
      continue;
    }

    // GFM Pipe Table
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      lines[i + 1].includes('|') &&
      lines[i + 1].includes('-') &&
      parseMarkdownTableStructure(`${line}\n${lines[i + 1]}`)
    ) {
      const blockLines = [lines[i], lines[i + 1]];
      i += 2;
      while (i < lines.length) {
        const cur = lines[i];
        const curTrim = cur.trim();
        if (
          curTrim === '' ||
          !cur.includes('|') ||
          parseReviewCommentLine(curTrim) !== null ||
          /^(`{3,}|~{3,})/.test(curTrim) ||
          /^#{1,6}\s+/.test(cur)
        ) {
          break;
        }
        blockLines.push(cur);
        i++;
      }
      const endLine = i;
      const blk = makeBlock({
        id: nextId(),
        type: 'table',
        level: 0,
        raw: blockLines.join('\n'),
        startLine,
        endLine,
        reviews: [],
        trailingBlankLines: 0,
      });
      consumeReviewComments(blk);
      blocks.push(blk);
      continue;
    }

    // Standard Paragraph
    const blockLines = [];
    while (i < lines.length) {
      const cur = lines[i];
      const curTrim = cur.trim();
      if (
        curTrim === '' ||
        parseReviewCommentLine(curTrim) !== null ||
        /^(`{3,}|~{3,})/.test(curTrim) ||
        curTrim.startsWith('$$') ||
        /^#{1,6}\s+/.test(cur) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(curTrim) ||
        /^!\[[^\]]*\]\([^)\n]+\)\s*$/.test(curTrim) ||
        /^<img\b[^>]*>\s*$/i.test(curTrim) ||
        /^>\s?/.test(curTrim) ||
        /^([-*+]|\d+\.)\s+/.test(curTrim) ||
        (cur.includes('|') &&
          i + 1 < lines.length &&
          lines[i + 1].includes('|') &&
          lines[i + 1].includes('-') &&
          parseMarkdownTableStructure(`${cur}\n${lines[i + 1]}`))
      ) {
        break;
      }
      blockLines.push(cur);
      i++;
    }
    const endLine = i;
    const blk = makeBlock({
      id: nextId(),
      type: 'paragraph',
      level: 0,
      raw: blockLines.join('\n'),
      startLine,
      endLine,
      reviews: [],
      trailingBlankLines: 0,
    });
    consumeReviewComments(blk);
    blocks.push(blk);
  }

  if (blocks.length > 0 && initialBlankLines > 0) {
    blocks[0].leadingBlankLines = initialBlankLines;
  }

  return blocks;
}

export function serializeBlocksToMarkdown(blocks) {
  if (!blocks || blocks.length === 0) return '';
  let out = '';
  for (let idx = 0; idx < blocks.length; idx++) {
    const b = blocks[idx];
    if (b.diff && b.diff.isInsertion && b.diff.fromDisk === false) {
      continue;
    }
    if (idx === 0 && typeof b.leadingBlankLines === 'number' && b.leadingBlankLines > 0) {
      out += '\n'.repeat(b.leadingBlankLines);
    }
    let blockOut = b.raw;
    const reviewItems =
      Array.isArray(b.reviews) && b.reviews.length > 0
        ? b.reviews
        : Array.isArray(b.comments)
          ? b.comments
          : [];
    if (reviewItems.length > 0) {
      const commentLines = reviewItems.map((r) => formatReviewCommentHtml(r)).filter(Boolean);
      if (commentLines.length > 0) {
        blockOut += '\n' + commentLines.join('\n');
      }
    }
    out += blockOut;
    const blanks =
      typeof b.trailingBlankLines === 'number' && b.trailingBlankLines >= 0
        ? b.trailingBlankLines
        : idx < blocks.length - 1
          ? 1
          : 0;
    if (idx < blocks.length - 1) {
      out += '\n'.repeat(blanks + 1);
    } else if (blanks > 0) {
      out += '\n'.repeat(blanks);
    }
  }
  return out;
}

export function recomputeBlockLineNumbers(blocks = state.blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return;
  let currentLine = 1;
  for (let idx = 0; idx < blocks.length; idx++) {
    const b = blocks[idx];
    if (idx === 0 && typeof b.leadingBlankLines === 'number' && b.leadingBlankLines > 0) {
      currentLine += b.leadingBlankLines;
    }
    const lineCount = b.raw.split('\n').length;
    const reviewItems =
      Array.isArray(b.reviews) && b.reviews.length > 0
        ? b.reviews
        : Array.isArray(b.comments)
          ? b.comments
          : [];
    const reviewCount = reviewItems.filter((r) =>
      typeof r === 'string' ? r.trim() : r?.text?.trim()
    ).length;
    b.startLine = currentLine;
    b.endLine = currentLine + lineCount + reviewCount - 1;
    const blanks =
      typeof b.trailingBlankLines === 'number' && b.trailingBlankLines >= 0
        ? b.trailingBlankLines
        : idx < blocks.length - 1
          ? 1
          : 0;
    currentLine = b.endLine + 1 + (idx < blocks.length - 1 ? blanks : 0);
  }
}

export function getTotalReviewComments() {
  let total = 0;
  for (const b of state.blocks) {
    if (Array.isArray(b.reviews)) {
      total += b.reviews.filter((r) => (typeof r === 'string' ? r.trim() : r?.text?.trim())).length;
    }
  }
  return total;
}

export function findBlockForLine(line) {
  for (const b of state.blocks) {
    if (line >= b.startLine && line <= b.endLine) {
      return b;
    }
  }
  return state.blocks[0] || null;
}

export function slugifyHeadingAnchor(text) {
  return String(text || '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

export function splitIntoSentences(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  const lines = trimmed
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > 1 && lines.every((l) => /^([-*+]|\d+\.|>)\s+/.test(l))) {
    return lines;
  }
  const matches = trimmed.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  return matches ? matches.map((s) => s.trim()).filter(Boolean) : [trimmed];
}

export function computeWordDiffHtml(oldText, newText) {
  const tokenize = (s) => (s || '').match(/\S+|\s+/g) || [];
  const a = tokenize(oldText);
  const b = tokenize(newText);

  const m = a.length;
  const n = b.length;
  if (m * n > 90000) {
    return `<del>${escapeHtml(oldText)}</del> <ins>${escapeHtml(newText)}</ins>`;
  }

  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = 1 + dp[i + 1][j + 1];
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  const ops = [];
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ type: 'eq', val: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', val: a[i] });
      i++;
    } else {
      ops.push({ type: 'ins', val: b[j] });
      j++;
    }
  }
  while (i < m) ops.push({ type: 'del', val: a[i++] });
  while (j < n) ops.push({ type: 'ins', val: b[j++] });

  let html = '';
  let k = 0;
  while (k < ops.length) {
    const type = ops[k].type;
    let chunk = '';
    while (k < ops.length && ops[k].type === type) {
      chunk += ops[k].val;
      k++;
    }
    if (type === 'eq') html += escapeHtml(chunk);
    else if (type === 'del') html += `<del>${escapeHtml(chunk)}</del>`;
    else html += `<ins>${escapeHtml(chunk)}</ins>`;
  }
  return html;
}

export function isSpanSliceValidForBlock(blockOrRaw, spanOrStart, maybeEnd, maybeExpectedMatch) {
  let raw = blockOrRaw;
  let start = spanOrStart;
  let end = maybeEnd;
  let expectedMatch = maybeExpectedMatch;

  if (blockOrRaw && typeof blockOrRaw === 'object') {
    raw = blockOrRaw.raw;
  }
  if (spanOrStart && typeof spanOrStart === 'object') {
    start = typeof spanOrStart.startOffset === 'number' ? spanOrStart.startOffset : spanOrStart.start;
    end = typeof spanOrStart.endOffset === 'number' ? spanOrStart.endOffset : spanOrStart.end;
    expectedMatch = spanOrStart.matchedText || spanOrStart.match || '';
  }

  if (typeof raw !== 'string') return false;
  if (typeof start !== 'number' || typeof end !== 'number' || start < 0 || end <= start || end > raw.length) {
    return false;
  }
  const actualSlice = raw.slice(start, end);
  if (expectedMatch && typeof expectedMatch === 'string') {
    if (actualSlice.toLowerCase() !== expectedMatch.toLowerCase()) {
      return false;
    }
    const isWordStart = /[a-zA-Z0-9]/.test(expectedMatch[0]);
    const isWordEnd = /[a-zA-Z0-9]/.test(expectedMatch[expectedMatch.length - 1]);
    if (isWordStart && start > 0 && /[a-zA-Z0-9]/.test(raw[start - 1])) {
      return false;
    }
    if (isWordEnd && end < raw.length && /[a-zA-Z0-9]/.test(raw[end])) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Undo / Redo History Stack
// ---------------------------------------------------------------------------

export function captureSnapshot(label = 'Edit') {
  const markdown = serializeBlocksToMarkdown(state.blocks);
  const blockProposals = {};
  for (const b of state.blocks) {
    if (b.diff || b.tournament) {
      blockProposals[b.id] = {
        diff: b.diff ? JSON.parse(JSON.stringify(b.diff)) : null,
        tournament: b.tournament ? JSON.parse(JSON.stringify(b.tournament)) : null,
      };
    }
  }
  return {
    markdown,
    blockProposals,
    label,
    timestamp: Date.now(),
  };
}

export function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('btn-undo');
  const redoBtn = document.getElementById('btn-redo');

  if (undoBtn) {
    const canUndo = runtime.undoStack.length > 1;
    undoBtn.disabled = !canUndo;
    undoBtn.setAttribute('data-tooltip', 'Undo');
  }

  if (redoBtn) {
    const canRedo = runtime.redoStack.length > 0;
    redoBtn.disabled = !canRedo;
    redoBtn.setAttribute('data-tooltip', 'Redo');
  }
}

export function resetHistoryForDocument(rawMarkdown, label = 'Initial document') {
  if (runtime.typingHistoryTimer) {
    clearTimeout(runtime.typingHistoryTimer);
    runtime.typingHistoryTimer = null;
  }
  const markdown = (rawMarkdown || '').replace(/\r\n/g, '\n');
  runtime.undoStack = [{ markdown, blockProposals: {}, label, timestamp: Date.now() }];
  runtime.redoStack = [];
  updateUndoRedoButtons();
}

export function recordHistorySnapshot(label = 'Edited prose') {
  if (runtime.typingHistoryTimer) {
    clearTimeout(runtime.typingHistoryTimer);
    runtime.typingHistoryTimer = null;
  }
  if (state.blocks.length === 0 && !state.filePath) {
    updateUndoRedoButtons();
    return;
  }
  const snap = captureSnapshot(label);
  const top = runtime.undoStack[runtime.undoStack.length - 1];
  if (
    top &&
    top.markdown === snap.markdown &&
    JSON.stringify(top.blockProposals || {}) === JSON.stringify(snap.blockProposals || {})
  ) {
    top.label = label;
    updateUndoRedoButtons();
    return;
  }
  runtime.undoStack.push(snap);
  if (runtime.undoStack.length > MAX_HISTORY_ENTRIES) {
    runtime.undoStack.shift();
  }
  runtime.redoStack = [];
  updateUndoRedoButtons();
}

export function scheduleTypingHistorySnapshot(label = 'Typed in block') {
  if (runtime.typingHistoryTimer) {
    clearTimeout(runtime.typingHistoryTimer);
  }
  runtime.typingHistoryTimer = setTimeout(() => {
    runtime.typingHistoryTimer = null;
    recordHistorySnapshot(label);
  }, 450);
}

export function flushPendingHistorySnapshot(fallbackLabel = 'Typed in block') {
  if (runtime.typingHistoryTimer) {
    clearTimeout(runtime.typingHistoryTimer);
    runtime.typingHistoryTimer = null;
    recordHistorySnapshot(fallbackLabel);
  }
}

export function isUndoShortcut(e) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
  return e.key.toLowerCase() === 'z' && !e.shiftKey;
}

export function isRedoShortcut(e) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
  const key = e.key.toLowerCase();
  return (key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey);
}
