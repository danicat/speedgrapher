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

(function () {
'use strict';

const MAX_HISTORY = 100;

const state = {
  workspacePath: '',
  sessionDir: '',
  files: [],
  filePath: '',
  mtimeMs: 0,
  docType: 'auto',
  keyword: '',

  // 'reader' (default when opening a file) | 'editor'
  studioMode: 'reader',

  // Active lenses in Editor Mode ('heatmap' active by default alongside 'slop' and 'vale')
  activeLenses: new Set(['heatmap', 'slop', 'vale']),

  seoPopoverOpen: false,
  settingsPopoverOpen: false,
  settingsActiveTab: 'general', // 'general' | 'vale' | 'vocab'

  themeMode: 'light', // 'light' | 'dark'
  userToggledTheme: false,

  aiSettings: {
    configured: false,
    authMode: 'vertex',
    project: '',
    location: 'global',
    model: 'gemini-3.8-flash',
    thinkingLevel: 'LOW',
    hasApiKey: false,
    apiKeyMask: '',
    adcAvailable: false,
    adcPath: '',
  },
  pendingTournamentBlockId: null,

  // Vale rules & accept.txt vocabulary state
  valeRulesData: {
    configPath: '',
    rules: [],
    vocabTerms: [],
    filterQuery: '',
    onlyActiveInDoc: false,
  },

  blocks: [],
  activeBlockId: null,

  // Inline paragraph review commenting state (<!-- review: ... -->)
  activeCommentBlockId: null,
  editingCommentId: null,
  pendingCommentQuote: '',
  reviewDispatchConfirmation: null,

  audit: null,
  metrics: { fog: null, slop: null, vale: null, seo: null, geo: null, words: 0, blockHealth: {} },
  spans: [],
  activePopoverSpanId: null,
  popoverPinned: false,

  cmdOpen: false,
  cmdBlockId: null,
  cmdSelectedText: '',

  // Document link drill-down Back / Forward navigation stacks
  docNavBackStack: [],
  docNavForwardStack: [],
};

let undoStack = []; // [{ markdown, activeBlockId, caretOffset, label }]
let redoStack = [];
let typingHistoryTimer = null;
let syncDebounceTimer = null;
let pollIntervalId = null;
let popoverHideTimer = null;
let reviewDispatchConfirmTimer = null;
let isSyncing = false;
let pendingSyncRequest = null;

function setHidden(elOrId, hidden) {
  const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
  if (!el) return;
  el.hidden = Boolean(hidden);
  el.classList.toggle('hidden', Boolean(hidden));
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pathBasename(p) {
  return String(p || '').split(/[\\/]/).pop() || '';
}

function parseColorLuminance(cssColor) {
  if (!cssColor) return null;
  const s = cssColor.trim();
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hexMatch) {
    const h = hexMatch[1];
    const r = h.length === 3 ? parseInt(h[0] + h[0], 16) : parseInt(h.slice(0, 2), 16);
    const g = h.length === 3 ? parseInt(h[1] + h[1], 16) : parseInt(h.slice(2, 4), 16);
    const b = h.length === 3 ? parseInt(h[2] + h[2], 16) : parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  const rgbMatch = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  return null;
}

function detectIdeThemeMode() {
  const inlineBg = document.documentElement.style.getPropertyValue('--background').trim();
  const computedBg = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
  const lum = parseColorLuminance(inlineBg || computedBg);
  if (lum !== null) {
    return lum > 0.55 ? 'light' : 'dark';
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyThemeMode(mode) {
  const next = mode === 'dark' ? 'dark' : 'light';
  state.themeMode = next;
  document.documentElement.setAttribute('data-theme', next);
  setHidden('theme-icon-sun', next !== 'light');
  setHidden('theme-icon-moon', next !== 'dark');
  const btn = document.getElementById('btn-theme-toggle');
  if (btn) {
    btn.setAttribute('data-tooltip', next === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode');
    btn.setAttribute('aria-label', next === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode');
  }
}

function showError(message) {
  const detail = document.getElementById('error-banner-detail');
  if (detail) {
    detail.textContent = String(message || 'Unknown error');
  }
  setHidden('error-banner', false);
}

function clearError() {
  setHidden('error-banner', true);
}

window.addEventListener('error', (e) => {
  showError(`Runtime error: ${e.message || e.error || 'Unknown error'}`);
});

window.addEventListener('unhandledrejection', (e) => {
  showError(`Unhandled promise rejection: ${e.reason?.message || e.reason || 'Unknown error'}`);
});

function setSyncStatus(mode, label) {
  const dot = document.getElementById('sync-dot');
  if (!dot) return;
  dot.dataset.state = mode;
  dot.setAttribute('data-tooltip', label);
}

async function apiPost(endpoint, payload) {
  const fetcher = window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
  const res = await fetcher(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  let body;
  try {
    body = await res.json();
  } catch (err) {
    throw new Error(`HTTP ${res.status} from ${endpoint}: response was not valid JSON (${err.message})`);
  }
  if (!res.ok || body?.error) {
    const msg = body?.error || `HTTP ${res.status} from ${endpoint}`;
    const details = body?.details ? `\n${JSON.stringify(body.details)}` : '';
    throw new Error(`${msg}${details}`);
  }
  return body;
}

function countWordsInText(text) {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// ---------------------------------------------------------------------------
// 4-Mode Segmented Control: Reader | Editor | Reviewer | Raw
// ---------------------------------------------------------------------------

function setStudioMode(mode) {
  const validModes = ['reader', 'editor', 'reviewer', 'raw'];
  const next = validModes.includes(mode) ? mode : 'reader';
  const prev = state.studioMode;

  if (prev === 'raw' && next !== 'raw') {
    const rawEditor = document.getElementById('raw-markdown-editor');
    if (rawEditor && (state.filePath || state.blocks.length > 0)) {
      const currentSerialized = serializeBlocksToMarkdown(state.blocks);
      if (rawEditor.value !== currentSerialized) {
        state.blocks = parseDocumentIntoBlocks(rawEditor.value);
        recomputeBlockLineNumbers();
        recordHistorySnapshot('Edited Raw Markdown');
      }
    }
  }

  if (prev === 'editor' && next !== 'editor' && state.activeBlockId) {
    exitBlockEditMode(state.activeBlockId);
  }

  state.studioMode = next;

  const shell = document.querySelector('.studio-shell');
  if (shell) {
    shell.setAttribute('data-studio-mode', next);
  }

  document.getElementById('mode-btn-reader')?.classList.toggle('active', next === 'reader');
  document.getElementById('mode-btn-editor')?.classList.toggle('active', next === 'editor');
  document.getElementById('mode-btn-reviewer')?.classList.toggle('active', next === 'reviewer');
  document.getElementById('mode-btn-raw')?.classList.toggle('active', next === 'raw');

  const showLenses = next === 'editor' || next === 'reviewer';
  const showUndoRedo = next === 'editor' || next === 'reviewer' || next === 'raw';
  const showAgent = next === 'editor' || next === 'reviewer';

  setHidden('editor-lens-cluster', !showLenses);
  setHidden('btn-seo-geo', !showLenses);
  setHidden('btn-undo', !showUndoRedo);
  setHidden('btn-redo', !showUndoRedo);
  setHidden('btn-ask-agent-top', !showAgent);

  const modeLabels = {
    reader: 'Reader Mode',
    editor: 'Editor Mode',
    reviewer: 'Reviewer Mode',
    raw: 'Raw Mode',
  };
  const footerMode = document.getElementById('footer-mode-badge');
  if (footerMode) {
    footerMode.textContent = modeLabels[next] || 'Reader Mode';
  }

  if (next === 'reader' || next === 'raw') {
    hideLensPopover();
    if (state.seoPopoverOpen || state.cmdOpen) {
      closeAllPopovers();
    }
  }
  if (next !== 'reader' && next !== 'editor' && next !== 'reviewer') {
    closeCommentPopover();
  }

  updateHeaderTelemetry();
  renderCanvas();
}

// ---------------------------------------------------------------------------
// Unified In-Memory Undo / Redo Engine (⌘Z / ⇧⌘Z / ⌘Y)
// ---------------------------------------------------------------------------

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('btn-undo');
  const redoBtn = document.getElementById('btn-redo');
  if (undoBtn) {
    const canUndo = undoStack.length > 1;
    undoBtn.disabled = !canUndo;
    const prevLabel = canUndo ? undoStack[undoStack.length - 1]?.label : '';
    undoBtn.setAttribute('data-tooltip', canUndo && prevLabel ? `Undo: ${prevLabel} (⌘Z)` : 'Undo (⌘Z)');
  }
  if (redoBtn) {
    const canRedo = redoStack.length > 0;
    redoBtn.disabled = !canRedo;
    const nextLabel = canRedo ? redoStack[redoStack.length - 1]?.label : '';
    redoBtn.setAttribute('data-tooltip', canRedo && nextLabel ? `Redo: ${nextLabel} (⌘Y / ⇧⌘Z)` : 'Redo (⌘Y / ⇧⌘Z)');
  }
}

function resetHistoryForDocument(markdown, label = 'Initial load') {
  if (typingHistoryTimer) {
    clearTimeout(typingHistoryTimer);
    typingHistoryTimer = null;
  }
  undoStack = [
    {
      markdown: typeof markdown === 'string' ? markdown : serializeBlocksToMarkdown(state.blocks),
      activeBlockId: null,
      caretOffset: null,
      label,
    },
  ];
  redoStack = [];
  updateUndoRedoButtons();
}

function recordHistorySnapshot(label = 'Edit') {
  if (state.blocks.length === 0 && !state.filePath) return;
  const markdown = serializeBlocksToMarkdown(state.blocks);
  const top = undoStack[undoStack.length - 1];
  let caretOffset = null;
  if (state.activeBlockId) {
    const ta = document.querySelector(`.block-editor-textarea[data-block-id="${state.activeBlockId}"]`);
    if (ta) {
      caretOffset = ta.selectionStart;
    }
  }
  if (top && top.markdown === markdown) {
    top.activeBlockId = state.activeBlockId;
    top.caretOffset = caretOffset;
    return;
  }
  undoStack.push({
    markdown,
    activeBlockId: state.activeBlockId,
    caretOffset,
    label,
  });
  if (undoStack.length > MAX_HISTORY) {
    undoStack.shift();
  }
  redoStack = [];
  updateUndoRedoButtons();
}

function scheduleTypingHistorySnapshot(label = 'Typing') {
  if (typingHistoryTimer) clearTimeout(typingHistoryTimer);
  typingHistoryTimer = setTimeout(() => {
    typingHistoryTimer = null;
    recordHistorySnapshot(label);
  }, 500);
}

function flushPendingHistorySnapshot(label = 'Typing') {
  if (typingHistoryTimer) {
    clearTimeout(typingHistoryTimer);
    typingHistoryTimer = null;
  }
  recordHistorySnapshot(label);
}

function restoreHistorySnapshot(snap, actionLabel) {
  if (!snap) return;
  state.blocks = parseDocumentIntoBlocks(snap.markdown);
  state.activeBlockId = snap.activeBlockId || null;
  recomputeBlockLineNumbers();
  if (state.audit) {
    state.spans = buildAmbientSpansFromAudit(state.audit);
  }
  state.metrics.words = countWordsInText(snap.markdown);
  updateHeaderTelemetry();
  renderCanvas();

  if (state.studioMode === 'raw') {
    const rawEditor = document.getElementById('raw-markdown-editor');
    if (rawEditor) {
      rawEditor.value = snap.markdown;
    }
  } else if (state.activeBlockId && state.studioMode === 'editor') {
    const ta = document.querySelector(`.block-editor-textarea[data-block-id="${state.activeBlockId}"]`);
    if (ta) {
      ta.focus();
      const pos = typeof snap.caretOffset === 'number' ? snap.caretOffset : ta.value.length;
      ta.setSelectionRange(pos, pos);
    }
  }
  updateUndoRedoButtons();
  scheduleDebouncedSync('user', actionLabel);
}

function performUndo() {
  if (state.studioMode === 'reader') return;
  flushPendingHistorySnapshot('Typing');
  if (undoStack.length <= 1) return;
  const current = undoStack.pop();
  redoStack.push(current);
  const prev = undoStack[undoStack.length - 1];
  restoreHistorySnapshot(prev, 'Undo');
}

function performRedo() {
  if (state.studioMode === 'reader') return;
  flushPendingHistorySnapshot('Typing');
  if (redoStack.length === 0) return;
  const next = redoStack.pop();
  undoStack.push(next);
  restoreHistorySnapshot(next, 'Redo');
}

// ---------------------------------------------------------------------------
// Inline Review Comment Tag Parser & Serializer (<!-- review(...): ... -->)
// ---------------------------------------------------------------------------

const REVIEW_LINE_RE = /^\s*<!--\s*review(?:\(([^)]*)\))?:\s*([\s\S]*?)\s*-->\s*$/i;

function parseReviewAttributes(attrString, fallbackSeq = 1) {
  const attrs = {
    id: `rev-${Date.now().toString(36)}-${fallbackSeq}`,
    quote: '',
    ts: '',
  };
  if (!attrString) return attrs;
  const pairRe = /([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = pairRe.exec(attrString)) !== null) {
    const key = m[1].toLowerCase();
    const val = m[2].replace(/\\"/g, '"');
    if (key === 'id' && val) attrs.id = val;
    if (key === 'quote') attrs.quote = val;
    if (key === 'ts') attrs.ts = val;
  }
  return attrs;
}

function parseSingleReviewLine(line, seq = 1) {
  const m = REVIEW_LINE_RE.exec(line);
  if (!m) return null;
  const body = (m[2] || '').trim();
  if (!body || body === '...' || body === '…') return null;
  const attrs = parseReviewAttributes(m[1], seq);
  return {
    id: attrs.id,
    quote: attrs.quote,
    ts: attrs.ts,
    text: body,
  };
}

function escapeReviewAttr(val) {
  return String(val ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');
}

function serializeReviewTag(review) {
  const parts = [];
  if (review.id) parts.push(`id="${escapeReviewAttr(review.id)}"`);
  if (review.quote) parts.push(`quote="${escapeReviewAttr(review.quote)}"`);
  if (review.ts) parts.push(`ts="${escapeReviewAttr(review.ts)}"`);
  const attrPart = parts.length > 0 ? `(${parts.join(', ')})` : '';
  const safeBody = String(review.text || '').replace(/-->/g, '-- >').trim();
  return `<!-- review${attrPart}: ${safeBody} -->`;
}

// ---------------------------------------------------------------------------
// Lossless Markdown Block Parser & Serializer (with YAML/TOML, Math, Images, Reviews)
// ---------------------------------------------------------------------------

function parseTournamentBlockContent(rawLines) {
  const body = rawLines.slice(1, -1).join('\n');
  const sections = body.split(/^###\s+/m).map((s) => s.trim()).filter(Boolean);
  if (sections.length === 0) return null;
  const angles = sections.slice(0, 3).map((sec, idx) => {
    const nl = sec.indexOf('\n');
    const title = nl >= 0 ? sec.slice(0, nl).trim() : `Angle ${String.fromCharCode(65 + idx)}`;
    const text = nl >= 0 ? sec.slice(nl + 1).trim() : sec;
    return {
      id: `angle-${idx}`,
      label: title,
      raw: text,
      sentences: splitIntoSentences(text),
    };
  });
  return {
    angles,
    selectedSentences: angles[0]?.sentences ? [...angles[0].sentences] : [],
    compositeRaw: angles[0]?.raw || '',
  };
}

function parseDocumentIntoBlocks(markdown) {
  const normalized = typeof markdown === 'string' ? markdown.replace(/\r\n/g, '\n') : '';
  if (!normalized.trim()) {
    return [
      {
        id: 'b-0',
        type: 'paragraph',
        level: 0,
        raw: '',
        startLine: 1,
        endLine: 1,
        trailingBlankLines: 1,
        reviews: [],
        diff: null,
        tournament: null,
        busy: false,
      },
    ];
  }

  const lines = normalized.split('\n');
  const blocks = [];
  let i = 0;
  let reviewSeq = 1;
  const orphanLeadingReviews = [];

  const consumeBlankLines = (startIdx) => {
    let count = 0;
    while (startIdx + count < lines.length && lines[startIdx + count].trim() === '') {
      count++;
    }
    return count;
  };

  while (i < lines.length) {
    if (lines[i].trim() === '') {
      i++;
      continue;
    }

    // If a standalone <!-- review: ... --> line appears outside code blocks, attach it to the previous block
    const standaloneRev = parseSingleReviewLine(lines[i], reviewSeq);
    if (standaloneRev) {
      reviewSeq++;
      if (blocks.length > 0) {
        blocks[blocks.length - 1].reviews.push(standaloneRev);
      } else {
        orphanLeadingReviews.push(standaloneRev);
      }
      i++;
      continue;
    }

    const startLine = i + 1;
    let type = 'paragraph';
    let level = 0;
    let endIdx = i;
    let parsedTournament = null;
    const trimmedLine = lines[i].trim();

    if (i === 0 && (trimmedLine === '---' || trimmedLine === '+++')) {
      type = 'frontmatter';
      const fence = trimmedLine;
      endIdx = i + 1;
      while (endIdx < lines.length && lines[endIdx].trim() !== fence) {
        endIdx++;
      }
      if (endIdx >= lines.length) endIdx = lines.length - 1;
    } else if (/^:::tournament\b/i.test(trimmedLine)) {
      type = 'paragraph';
      endIdx = i + 1;
      while (endIdx < lines.length && lines[endIdx].trim() !== ':::') {
        endIdx++;
      }
      if (endIdx >= lines.length) endIdx = lines.length - 1;
      parsedTournament = parseTournamentBlockContent(lines.slice(i, endIdx + 1));
    } else if (/^(`{3,}|~{3,})/.test(lines[i])) {
      type = 'code';
      const fence = lines[i].match(/^(`{3,}|~{3,})/)[1];
      endIdx = i + 1;
      while (endIdx < lines.length && !lines[endIdx].startsWith(fence)) {
        endIdx++;
      }
      if (endIdx >= lines.length) endIdx = lines.length - 1;
    } else if (/^\$\$/.test(trimmedLine)) {
      type = 'math';
      if (trimmedLine.length > 4 && trimmedLine.endsWith('$$')) {
        endIdx = i;
      } else {
        endIdx = i + 1;
        while (endIdx < lines.length && !lines[endIdx].trim().endsWith('$$')) {
          endIdx++;
        }
        if (endIdx >= lines.length) endIdx = lines.length - 1;
      }
    } else if (/^(#{1,6})\s+/.test(lines[i])) {
      type = 'heading';
      level = lines[i].match(/^(#{1,6})\s+/)[1].length;
      endIdx = i;
    } else if (/^(---|\*\*\*|___)\s*$/.test(lines[i])) {
      type = 'hr';
      endIdx = i;
    } else if (/^!\[[^\]]*\]\([^)\n]+\)\s*$/.test(trimmedLine) || /^<img\b[^>]*>\s*$/i.test(trimmedLine)) {
      type = 'image';
      endIdx = i;
    } else if (lines[i].includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      type = 'table';
      endIdx = i + 1;
      while (
        endIdx + 1 < lines.length &&
        lines[endIdx + 1].includes('|') &&
        lines[endIdx + 1].trim() !== '' &&
        !parseSingleReviewLine(lines[endIdx + 1], reviewSeq)
      ) {
        endIdx++;
      }
    } else if (/^\s*>\s?/.test(lines[i])) {
      type = 'blockquote';
      while (endIdx + 1 < lines.length && /^\s*>\s?/.test(lines[endIdx + 1])) {
        endIdx++;
      }
    } else if (/^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
      type = 'list';
      while (
        endIdx + 1 < lines.length &&
        lines[endIdx + 1].trim() !== '' &&
        !parseSingleReviewLine(lines[endIdx + 1], reviewSeq) &&
        (/^\s*([-*+]|\d+\.)\s+/.test(lines[endIdx + 1]) || /^\s{2,}\S/.test(lines[endIdx + 1]))
      ) {
        endIdx++;
      }
    } else {
      type = 'paragraph';
      while (
        endIdx + 1 < lines.length &&
        lines[endIdx + 1].trim() !== '' &&
        !parseSingleReviewLine(lines[endIdx + 1], reviewSeq) &&
        !/^(#{1,6}\s+|`{3,}|~{3,}|\$\$|:::tournament\b|\s*>\s?|\s*([-*+]|\d+\.)\s+|---|\*\*\*|___)/.test(lines[endIdx + 1])
      ) {
        endIdx++;
      }
    }

    const rawSlice = lines.slice(i, endIdx + 1).join('\n');
    const blockReviews = orphanLeadingReviews.splice(0, orphanLeadingReviews.length);

    // Consume any immediately following standalone <!-- review: ... --> lines
    let cursor = endIdx + 1;
    while (cursor < lines.length) {
      const rev = parseSingleReviewLine(lines[cursor], reviewSeq);
      if (rev) {
        reviewSeq++;
        blockReviews.push(rev);
        cursor++;
      } else {
        break;
      }
    }

    const blankCount = consumeBlankLines(cursor);

    blocks.push({
      id: `b-${blocks.length}`,
      type,
      level,
      raw: parsedTournament ? (parsedTournament.angles[0]?.raw || rawSlice) : rawSlice,
      startLine,
      endLine: endIdx + 1,
      trailingBlankLines: blankCount > 0 ? blankCount : 1,
      reviews: blockReviews,
      diff: null,
      tournament: parsedTournament,
      busy: false,
    });

    i = cursor + blankCount;
  }

  return blocks;
}

function serializeBlocksToMarkdown(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return '';
  }
  let out = '';
  for (let idx = 0; idx < blocks.length; idx++) {
    const b = blocks[idx];
    out += b.raw;
    if (Array.isArray(b.reviews) && b.reviews.length > 0) {
      for (const r of b.reviews) {
        out += `\n${serializeReviewTag(r)}`;
      }
    }
    if (idx < blocks.length - 1) {
      const blanks = typeof b.trailingBlankLines === 'number' && b.trailingBlankLines >= 0 ? b.trailingBlankLines : 1;
      out += '\n'.repeat(blanks + 1);
    }
  }
  return out.endsWith('\n') ? out : `${out}\n`;
}

function recomputeBlockLineNumbers() {
  let lineCursor = 1;
  for (let i = 0; i < state.blocks.length; i++) {
    const b = state.blocks[i];
    b.id = `b-${i}`;
    const lineCount = b.raw.split('\n').length;
    const reviewLineCount = Array.isArray(b.reviews) ? b.reviews.length : 0;
    b.startLine = lineCursor;
    b.endLine = lineCursor + lineCount - 1;
    const blanks = typeof b.trailingBlankLines === 'number' ? b.trailingBlankLines : 1;
    lineCursor = b.endLine + reviewLineCount + 1 + blanks;
  }
}

function getTotalReviewComments() {
  return state.blocks.reduce((sum, b) => sum + (Array.isArray(b.reviews) ? b.reviews.length : 0), 0);
}

// ---------------------------------------------------------------------------
// Sentence Splitter & Word-Level LCS Inline Diff Engine
// ---------------------------------------------------------------------------

function splitIntoSentences(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  return (matches || [text]).map((s) => s.trim()).filter(Boolean);
}

function computeWordDiffHtml(oldText, newText) {
  const tokenize = (str) => (str || '').split(/(\s+)/).filter((t) => t.length > 0);
  const a = tokenize(oldText);
  const b = tokenize(newText);

  if (a.length * b.length > 90000) {
    return `<del class="diff-del">${escapeHtml(oldText)}</del> <ins class="diff-ins">${escapeHtml(newText)}</ins>`;
  }

  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  let i = 0;
  let j = 0;
  const parts = [];
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      parts.push({ type: 'eq', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      parts.push({ type: 'del', text: a[i++] });
    } else {
      parts.push({ type: 'ins', text: b[j++] });
    }
  }
  while (i < a.length) parts.push({ type: 'del', text: a[i++] });
  while (j < b.length) parts.push({ type: 'ins', text: b[j++] });

  const merged = [];
  for (const p of parts) {
    const last = merged[merged.length - 1];
    if (last && last.type === p.type) {
      last.text += p.text;
    } else {
      merged.push({ ...p });
    }
  }

  return merged
    .map((m) => {
      if (m.type === 'del') return `<del class="diff-del">${escapeHtml(m.text)}</del>`;
      if (m.type === 'ins') return `<ins class="diff-ins">${escapeHtml(m.text)}</ins>`;
      return escapeHtml(m.text);
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Ambient Typography Lens Span Computation & Paragraph Heatmap Engine
// ---------------------------------------------------------------------------

function toSentenceCaseHeading(rawHeading) {
  const m = rawHeading.match(/^(#{1,6}\s+)(.+)$/);
  if (!m) return rawHeading;
  const prefix = m[1];
  const words = m[2].split(/(\s+)/);
  const ACRONYMS = new Set([
    'API', 'SDK', 'CLI', 'MCP', 'SEO', 'GEO', 'HTML', 'CSS', 'JSON', 'YAML', 'TOML', 'URL', 'UI', 'AI', 'LLM',
    'WASM', 'CPU', 'GPU', 'RAM', 'SQL', 'HTTP', 'REST', 'GDD', 'AST', 'IDE', 'OSS', 'GFM', 'Go', 'Google',
    'Antigravity', 'Speedgrapher', 'Hugo', 'Vale', 'Ebitengine', 'Markdown', 'Vertex', 'Gemini',
  ]);
  let firstWordSeen = false;
  const converted = words
    .map((tok) => {
      if (/^\s+$/.test(tok)) return tok;
      if (tok.startsWith('`') && tok.endsWith('`')) return tok;
      const clean = tok.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
      if (ACRONYMS.has(clean)) return tok;
      if (!firstWordSeen) {
        firstWordSeen = true;
        return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
      }
      return tok.toLowerCase();
    })
    .join('');
  return `${prefix}${converted}`;
}

function lookupInstantReplacement(matchText, ruleName = '', suggestion = '', blockRaw = '', action = null) {
  if (ruleName === 'Google.Headings' && blockRaw.startsWith('#')) {
    const fixed = toSentenceCaseHeading(blockRaw);
    if (fixed !== blockRaw) {
      return { target: blockRaw, replacement: fixed, isWholeBlock: true };
    }
  }
  if (ruleName === 'Google.EmDash' && matchText.includes('—')) {
    return { target: matchText, replacement: '—', isWholeBlock: false };
  }

  // Prefer structured Vale action params when available
  const actionName = action?.Name || '';
  const actionParams = action?.Params || null;
  if (actionName === 'replace' && Array.isArray(actionParams) && typeof actionParams[0] === 'string' && actionParams[0].length > 0) {
    const rep = actionParams[0];
    const isCap = matchText && matchText.charAt(0) >= 'A' && matchText.charAt(0) <= 'Z';
    const casedRep = isCap && rep.length > 0 ? rep.charAt(0).toUpperCase() + rep.slice(1) : rep;
    return { target: matchText, replacement: casedRep, isWholeBlock: false };
  }

  // Match double-quoted or single-quoted replacements while preserving internal apostrophes in contractions (e.g. 'isn't', 'don't', 'can't')
  const quoted = (suggestion || '').match(
    /(?:use|try(?:\s+using)?|prefer|replace\s+with)\s+(?:"([^"]+)"|'(.+?)'(?=\s+instead\b|[.,;!?)]|\s|$))/i
  );
  const rawRep = quoted ? (quoted[1] ?? quoted[2] ?? '') : '';
  if (rawRep) {
    const isCap = matchText && matchText.charAt(0) >= 'A' && matchText.charAt(0) <= 'Z';
    const casedRep = isCap && rawRep.length > 0 ? rawRep.charAt(0).toUpperCase() + rawRep.slice(1) : rawRep;
    return { target: matchText, replacement: casedRep, isWholeBlock: false };
  }

  return null;
}

const EDITORIAL_RULE_EXPLANATIONS = {
  'write-good.E-Prime':
    "E-Prime flags 'to be' verbs (is, are, was, were, be, been) because they can mask passive voice or weak linking clauses. If 'is/are' states a direct fact or definition, keep it as-is or click 'Mute write-good.E-Prime' to silence this rule.",
  'write-good.Passive':
    'Passive voice hides who or what performs the action. Prefer naming the concrete actor (you, the client, the server) and using an active verb.',
  'write-good.Weasel':
    'Weasel words ("various", "many", "extremely", "vast") sound emphatic but carry no measurable fact. Replace with a specific metric or delete the modifier.',
  'write-good.TooWordy':
    'Wordy phrases add reading friction without adding meaning. Replace with the shorter plain-English equivalent.',
  'write-good.So':
    'Starting a sentence with "So" as a conversational conjunction weakens technical prose. State the consequence directly or use "Therefore".',
  'write-good.ThereIs':
    'Starting a clause with "There is" or "There are" delays the real subject. Lead with the concrete noun and an active verb instead.',
  'write-good.Cliches':
    'Overused idioms and clichés reduce clarity for international and technical readers. Describe the literal mechanism directly.',
  'write-good.Illusions':
    'Adjacent repeated words ("the the", "is is") are usually accidental typos.',
  'Google.Contractions':
    "The Google Developer Documentation Style Guide recommends everyday contractions ('isn't', 'don't', 'can't', 'won't') so technical guides read naturally and conversationally.",
  'Google.Semicolons':
    'Semicolons join independent clauses into longer compound sentences. Split into two separate sentences or use a conjunction to lower cognitive load.',
  'Google.We':
    "First-person plural ('we', 'our', 'let's') can be ambiguous in documentation (does 'we' mean the author, the product team, or the reader?). Address the reader as 'you' or make the system the subject — or mute Google.We for personal blog posts.",
  'Google.Parens':
    'Parenthetical asides interrupt sentence flow. If the detail is important, work it into the sentence; if it is tangential, cut it.',
  'Google.Passive':
    'Google style favors active voice where the actor performs the verb, making operational responsibility clear.',
  'Google.WordList':
    "Google's developer word list flags jargon, non-inclusive terms, or inconsistent compound spellings in favor of plain, standardized terminology.",
  'Google.Headings':
    'Google style uses sentence case for headings (capitalize only the first word and proper nouns/acronyms) for faster scanning.',
  'Google.Exclamation':
    'Exclamation marks can sound promotional or alarmist in technical writing. Let concrete results and metrics carry the emphasis.',
  'Google.Future':
    'Present tense ("the API returns") is clearer and more direct than future tense ("the API will return") when describing deterministic system behavior.',
  'Google.Will':
    'Avoid "will" when describing how software currently works. Present tense ("returns", "writes", "validates") is shorter and more authoritative.',
  'Google.Latin':
    'Latin abbreviations ("e.g.", "i.e.", "etc.", "via") can confuse non-native English readers and screen readers. Use "for example", "that is", or "through".',
  'Google.Acronyms':
    'Spell out unfamiliar acronyms on first use so readers outside your immediate domain can follow along, or add project acronyms to Vocab.',
  'Google.Spelling':
    'Unrecognized word or technical identifier. Wrap code identifiers in backticks (`code`) or add valid project terms to your Vocabulary.',
  'Vale.Spelling':
    'Unrecognized word or technical identifier. Wrap code identifiers in backticks (`code`) or add valid project terms to your Vocabulary.',
  'Vale.Terms':
    'Preferred terminology casing or spelling mismatch according to the active vocabulary rules.',
  'Vale.Repetition':
    'Adjacent repeated word detected. Remove the duplicate token.',
  'proselint.Very':
    'Intensifiers like "very" and "really" weaken the adjective they modify. Choose a precise word or back the claim with a metric.',
  'proselint.Hyperbole':
    'Hyperbolic claims erode engineering credibility. State verifiable facts and trade-offs.',
  'proselint.Hedging':
    'Hedging phrases ("I think", "it seems", "arguably") weaken technical authority. State the conclusion directly or specify the exact condition.',
  'proselint.CorporateSpeak':
    'Corporate buzzwords obscure who does what. Replace with plain, concrete verbs and nouns.',
  'proselint.Jargon':
    'Status-signaling jargon increases cognitive friction without adding technical precision.',
};

function getEditorialRuleExplanation(pillar, ruleId, category = '') {
  const cleanId = String(ruleId || '').trim();
  if (EDITORIAL_RULE_EXPLANATIONS[cleanId]) {
    return EDITORIAL_RULE_EXPLANATIONS[cleanId];
  }

  // Check if backend valeRulesData has a loaded description
  const loadedRule = Array.isArray(state.valeRulesData?.rules)
    ? state.valeRulesData.rules.find((r) => r.id === cleanId)
    : null;
  if (loadedRule?.description && loadedRule.description !== cleanId) {
    return loadedRule.description;
  }

  if (pillar === 'slop') {
    const cat = String(category || cleanId).toLowerCase();
    if (cat.includes('lexical')) {
      return 'High-frequency LLM vocabulary ("delve", "tapestry", "leverage", "utilize", "robust", "seamless") signals synthetic prose. Replace with a plain, concrete verb or noun.';
    }
    if (cat.includes('structural')) {
      return 'Formulaic rhetorical framing ("It\'s not X — it\'s Y", "Here\'s the kicker", dramatic countdowns) is a strong AI-writing tell. State the technical point directly.';
    }
    if (cat.includes('filler')) {
      return 'Throat-clearing transitions ("It is worth noting that", "In order to") pad word count before the real point begins. Cut the preamble.';
    }
    if (cat.includes('passive')) {
      return 'Passive construction obscures which component or actor performs the operation. Name the subject and use an active verb.';
    }
    return 'Synthetic phrasing pattern detected by the 5-dimension Slop analyzer. Rewrite with direct, concrete engineering prose.';
  }

  if (pillar === 'fog') {
    if (category === 'long_sentence' || cleanId === 'Long Sentence') {
      return 'Sentences over 30 words push the Gunning Fog index above 15, forcing readers to hold multiple clauses in working memory. Split at a conjunction or turn a subordinate clause into its own sentence.';
    }
    return 'Polysyllabic words (3+ syllables) and nominalizations ("implementation", "orchestration", "utilization") increase Gunning Fog score. Prefer shorter active verbs where possible.';
  }

  if (cleanId.startsWith('Google.')) {
    return 'Google Developer Documentation Style Guide rule favoring clear, direct, second-person technical prose. You can mute this rule if it does not fit your article\'s voice.';
  }
  if (cleanId.startsWith('write-good.')) {
    return 'Write-Good readability lint rule targeting passive voice, wordiness, or weak verbs. Mute this rule if the phrasing is intentional.';
  }
  if (cleanId.startsWith('proselint.')) {
    return 'Proselint editorial rule flagging redundancy, hedging, or cliché phrasing.';
  }
  return '';
}

function findBlockForLine(lineNum) {
  if (typeof lineNum !== 'number') return state.blocks[0] || null;
  for (const b of state.blocks) {
    if (lineNum >= b.startLine && lineNum <= b.endLine) {
      return b;
    }
  }
  return null;
}

function isOffsetInsideCodeOrUrl(raw, start, end) {
  const codeRe = /(`+[^`\n]+`+)/g;
  let m;
  while ((m = codeRe.exec(raw)) !== null) {
    const cStart = m.index;
    const cEnd = cStart + m[0].length;
    if (start < cEnd && end > cStart) return true;
  }
  const linkRe = /!?\[[^\]]*\]\(([^)\n]+)\)/g;
  while ((m = linkRe.exec(raw)) !== null) {
    const fullMatch = m[0];
    const parenIdx = fullMatch.indexOf('](');
    if (parenIdx >= 0) {
      const urlStart = m.index + parenIdx + 2;
      const urlEnd = m.index + fullMatch.length;
      if (start < urlEnd && end > urlStart) return true;
    }
  }
  return false;
}

function locateAlertSpanInBlock(block, lineNum, matchStr, spanCols) {
  const raw = block.raw || '';
  const lines = raw.split('\n');
  const lineOffsets = [];
  let acc = 0;
  for (const l of lines) {
    lineOffsets.push(acc);
    acc += l.length + 1;
  }

  const relLine =
    typeof lineNum === 'number' && lineNum >= block.startLine && lineNum <= block.endLine
      ? lineNum - block.startLine
      : -1;

  if (relLine >= 0 && Array.isArray(spanCols) && spanCols.length === 2) {
    const lineText = lines[relLine] || '';
    const lineStart = lineOffsets[relLine];
    const colStart = Math.max(0, Number(spanCols[0]) - 1);
    const colEnd = Math.min(lineText.length, Number(spanCols[1]));
    if (colEnd > colStart) {
      const candidate = lineText.slice(colStart, colEnd);
      const prevChar = colStart > 0 ? lineText[colStart - 1] : '';
      const nextChar = colEnd < lineText.length ? lineText[colEnd] : '';
      const leftOk = !/^[a-zA-Z0-9_]/.test(candidate) || !/[a-zA-Z0-9_]/.test(prevChar);
      const rightOk = !/[a-zA-Z0-9_]$/.test(candidate) || !/[a-zA-Z0-9_]/.test(nextChar);
      if (leftOk && rightOk && (!matchStr || candidate.toLowerCase() === matchStr.toLowerCase())) {
        const absStart = lineStart + colStart;
        const absEnd = lineStart + colEnd;
        if (!isOffsetInsideCodeOrUrl(raw, absStart, absEnd)) {
          return { startOffset: absStart, endOffset: absEnd, exactSub: candidate };
        }
      }
    }
  }

  const cleanMatch = String(matchStr || '').includes('—') ? String(matchStr) : (matchStr || '').trim();
  if (!cleanMatch) return null;

  const escaped = cleanMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const leftBound = /^[a-zA-Z0-9_]/.test(cleanMatch) ? '(?<![a-zA-Z0-9_])' : '';
  const rightBound = /[a-zA-Z0-9_]$/.test(cleanMatch) ? '(?![a-zA-Z0-9_])' : '';
  const re = new RegExp(`${leftBound}${escaped}${rightBound}`, 'gi');

  if (relLine >= 0) {
    const lineText = lines[relLine] || '';
    const lineStart = lineOffsets[relLine];
    let m;
    while ((m = re.exec(lineText)) !== null) {
      const absStart = lineStart + m.index;
      const absEnd = absStart + m[0].length;
      if (!isOffsetInsideCodeOrUrl(raw, absStart, absEnd)) {
        return { startOffset: absStart, endOffset: absEnd, exactSub: m[0] };
      }
    }
  }

  re.lastIndex = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const absStart = m.index;
    const absEnd = absStart + m[0].length;
    if (!isOffsetInsideCodeOrUrl(raw, absStart, absEnd)) {
      return { startOffset: absStart, endOffset: absEnd, exactSub: m[0] };
    }
  }

  return null;
}

function buildAmbientSpansFromAudit(audit) {
  const spans = [];
  if (!audit) return spans;
  let spanSeq = 1;

  const slopFindings = Array.isArray(audit.slop?.findings) ? audit.slop.findings : [];
  for (const f of slopFindings) {
    const block = findBlockForLine(f.line);
    if (!block || block.type === 'frontmatter' || block.type === 'code' || block.type === 'math') continue;
    const matchStr = (f.match || '').trim();
    if (!matchStr) continue;
    const located = locateAlertSpanInBlock(block, f.line, matchStr, f.span);
    if (!located) continue;
    const { startOffset, endOffset, exactSub } = located;
    const ruleName = f.category || 'Slop';
    let replacement = null;
    if (typeof f.suggestion === 'string') {
      const isCap = exactSub.charAt(0) >= 'A' && exactSub.charAt(0) <= 'Z';
      replacement =
        isCap && f.suggestion.length > 0
          ? f.suggestion.charAt(0).toUpperCase() + f.suggestion.slice(1)
          : f.suggestion;
    }
    spans.push({
      id: `sp-${spanSeq++}`,
      blockId: block.id,
      pillar: 'slop',
      severity: 'warn',
      startOffset,
      endOffset,
      match: exactSub,
      matchedText: exactSub,
      rule: ruleName,
      ruleId: ruleName,
      message: f.message || `AI trope detected ("${exactSub}")`,
      explanation: getEditorialRuleExplanation('slop', ruleName, f.category),
      replacement,
      isWholeBlockReplacement: false,
      isSentenceSpan: false,
    });
  }

  let valeAlerts = [];
  if (typeof audit.vale?.output === 'string' && audit.vale.output.trim()) {
    const parsed = JSON.parse(audit.vale.output);
    if (Array.isArray(parsed)) {
      valeAlerts = parsed;
    } else if (parsed && typeof parsed === 'object') {
      for (const arr of Object.values(parsed)) {
        if (Array.isArray(arr)) valeAlerts.push(...arr);
      }
    }
  }

  for (const alert of valeAlerts) {
    const lineNum = alert.Line || 1;
    const block = findBlockForLine(lineNum);
    if (!block || block.type === 'frontmatter' || block.type === 'code' || block.type === 'math') continue;
    const checkName = alert.Check || 'Vale';
    const rawMatchStr = String(alert.Match ?? '');
    const matchStr = checkName === 'Google.EmDash' ? rawMatchStr : rawMatchStr.trim();
    const message = alert.Message || checkName;
    const spanCols = alert.Span || null;
    const alertAction = alert.Action || null;

    let located = locateAlertSpanInBlock(block, lineNum, matchStr, spanCols);
    if (!located && checkName === 'Google.Headings' && block.type === 'heading') {
      located = { startOffset: 0, endOffset: block.raw.length, exactSub: block.raw };
    }
    if (!located) continue;

    const { startOffset, endOffset, exactSub } = located;
    const fix = lookupInstantReplacement(exactSub, checkName, message, block.raw, alertAction);
    spans.push({
      id: `sp-${spanSeq++}`,
      blockId: block.id,
      pillar: 'vale',
      severity: (alert.Severity || '').toLowerCase() === 'error' ? 'error' : 'warn',
      startOffset,
      endOffset,
      match: exactSub,
      matchedText: exactSub,
      rule: checkName,
      ruleId: checkName,
      message,
      explanation: getEditorialRuleExplanation('vale', checkName),
      replacement: fix ? fix.replacement : null,
      isWholeBlockReplacement: Boolean(fix?.isWholeBlock),
      isSentenceSpan: Boolean(fix?.isWholeBlock),
    });
  }

  const fogFindings = Array.isArray(audit.fog?.findings) ? audit.fog.findings : [];
  for (const f of fogFindings) {
    if (f.category !== 'long_sentence' && f.category !== 'complex_word') continue;
    const block = findBlockForLine(f.line);
    if (!block || block.type === 'frontmatter' || block.type === 'code' || block.type === 'math') continue;
    const matchStr = (f.match || '').trim();
    if (!matchStr) continue;
    const located = locateAlertSpanInBlock(block, f.line, matchStr, f.span);
    if (!located) continue;
    const { startOffset, endOffset, exactSub } = located;
    const isSentence = f.category === 'long_sentence';
    const ruleLabel = isSentence ? 'Long Sentence' : 'Complex Word';
    spans.push({
      id: `sp-${spanSeq++}`,
      blockId: block.id,
      pillar: 'fog',
      severity: 'info',
      startOffset,
      endOffset,
      match: exactSub,
      matchedText: exactSub,
      rule: ruleLabel,
      ruleId: 'Readability.Fog',
      message: f.message || `Readability finding: "${exactSub}"`,
      explanation: getEditorialRuleExplanation('fog', ruleLabel, f.category),
      replacement: null,
      isWholeBlockReplacement: false,
      isSentenceSpan: isSentence,
    });
  }

  return spans;
}

function computeBlockDiagnostics(block) {
  if (
    block.type === 'frontmatter' ||
    block.type === 'code' ||
    block.type === 'hr' ||
    block.type === 'image' ||
    block.type === 'math'
  ) {
    return null;
  }

  const blockHealthList = Array.isArray(state.audit?.blocks)
    ? state.audit.blocks
    : (Array.isArray(state.metrics?.blockHealth) ? state.metrics.blockHealth : []);
  const serverHealth = blockHealthList.find(
    (b) => typeof b.start_line === 'number' && b.start_line <= block.endLine && b.end_line >= block.startLine
  );

  const fogParagraphs = Array.isArray(state.audit?.fog?.paragraphs) ? state.audit.fog.paragraphs : [];
  const serverFogPara = fogParagraphs.find(
    (p) => typeof p.start_line === 'number' && p.start_line <= block.endLine && p.end_line >= block.startLine
  );

  const fog =
    typeof serverHealth?.fog_index === 'number'
      ? Number(serverHealth.fog_index.toFixed(1))
      : (typeof serverFogPara?.fog_index === 'number' ? Number(serverFogPara.fog_index.toFixed(1)) : 0);

  const wordCount =
    typeof serverHealth?.word_count === 'number'
      ? serverHealth.word_count
      : (typeof serverFogPara?.total_words === 'number' ? serverFogPara.total_words : countWordsInText(block.raw));

  const sentenceCount =
    typeof serverFogPara?.total_sentences === 'number' && serverFogPara.total_sentences > 0
      ? serverFogPara.total_sentences
      : Math.max(1, splitIntoSentences(block.raw).length);

  const complexWords = typeof serverFogPara?.complex_words === 'number' ? serverFogPara.complex_words : 0;

  const blockSpans = state.spans.filter((s) => s.blockId === block.id);
  const slopCount = blockSpans.filter((s) => s.pillar === 'slop').length;
  const valeSpans = blockSpans.filter((s) => s.pillar === 'vale');
  const valeCount = valeSpans.length;
  const valeErrorCount = valeSpans.filter((s) => s.severity === 'error').length;
  const valeWarnCount = valeSpans.filter((s) => s.severity === 'warn' || s.severity === 'warning').length;
  const valeInfoCount = Math.max(0, valeCount - valeErrorCount - valeWarnCount);
  const fogSpanCount = blockSpans.filter((s) => s.pillar === 'fog' && s.isSentenceSpan).length;
  const complexWordSpans = blockSpans.filter((s) => s.pillar === 'fog' && !s.isSentenceSpan).length;

  const effectiveFog = block.type === 'heading' || wordCount < 8 ? 0 : fog;

  let healthScore = 100;
  healthScore -= slopCount * 10;
  healthScore -= valeErrorCount * 8;
  healthScore -= valeWarnCount * 5;
  healthScore -= valeInfoCount * 3;
  healthScore -= fogSpanCount * 8;
  healthScore -= Math.min(18, complexWordSpans * 2.5);
  if (effectiveFog > 14) {
    healthScore -= (effectiveFog - 14) * 2.2;
  }
  healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));

  let health = 'clean';
  if (blockSpans.length === 0 && (effectiveFog === 0 || effectiveFog <= 14.5)) {
    health = 'pristine';
  } else if (healthScore >= 88) {
    health = 'clean';
  } else if (healthScore >= 76) {
    health = 'mild';
  } else if (healthScore >= 64) {
    health = 'fair';
  } else if (healthScore >= 50) {
    health = 'warn';
  } else if (healthScore >= 36) {
    health = 'high';
  } else {
    health = 'bad';
  }

  return {
    fog,
    wordCount,
    sentenceCount,
    complexWords,
    slopCount,
    valeCount,
    fogSpanCount,
    healthScore,
    health,
    spans: blockSpans,
  };
}

// ---------------------------------------------------------------------------
// 100% GFM Markdown Rendering (Images, Frontmatter, Alerts, Task Lists, Tables, Math)
// ---------------------------------------------------------------------------

function resolveMarkdownImageUrl(rawSrc) {
  const src = String(rawSrc || '').trim();
  if (!src) return '';
  if (/^(https?:\/\/|data:image\/)/i.test(src)) {
    return src;
  }
  return `/api/image?path=${encodeURIComponent(src)}&doc=${encodeURIComponent(state.filePath || '')}&ws=${encodeURIComponent(state.workspacePath || '')}`;
}

function renderPlainWithWordSpans(plainText, plainAbsOffset, wordSpans) {
  if (!plainText) return '';
  const sliceEnd = plainAbsOffset + plainText.length;
  const matching = wordSpans
    .filter((sp) => sp.startOffset >= plainAbsOffset && sp.endOffset <= sliceEnd && sp.startOffset < sp.endOffset)
    .sort((a, b) => a.startOffset - b.startOffset || (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset));

  const chosen = [];
  let cursor = plainAbsOffset;
  for (const sp of matching) {
    if (sp.startOffset < cursor) continue;
    chosen.push(sp);
    cursor = sp.endOffset;
  }

  if (chosen.length === 0) {
    return escapeHtml(plainText);
  }

  let out = '';
  let relIdx = 0;
  for (const sp of chosen) {
    const relStart = sp.startOffset - plainAbsOffset;
    const relEnd = sp.endOffset - plainAbsOffset;
    if (relStart > relIdx) {
      out += escapeHtml(plainText.slice(relIdx, relStart));
    }
    const inner = escapeHtml(plainText.slice(relStart, relEnd));
    out += `<mark class="lens-span" data-span-id="${sp.id}" data-pillar="${sp.pillar}">${inner}</mark>`;
    relIdx = relEnd;
  }
  if (relIdx < plainText.length) {
    out += escapeHtml(plainText.slice(relIdx));
  }
  return out;
}

function renderInlineMarkdownTokens(segmentText, segmentAbsOffset, wordSpans = []) {
  if (!segmentText) return '';
  const tokenRe =
    /(`+[^`\n]+`+|`{2,})|(!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"([^"]*)")?\))|(<img\b[^>]*>)|(\[((?:`+[^`\n]*`+|!\[[^\]\n]*\]\([^)\s]+(?:\s+"[^"]*")?\)|[^\[\]\n])+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"([^"]*)")?\))|(\$\$([^$\n]+)\$\$)|((?<!\$)\$(?!\$)([^$\n]+?)\$(?!\d))|(\*\*\*(?!\s)((?:(?!\*\*\*)[^\n])*?\S)\*\*\*)|(\*\*(?!\s)((?:(?!\*\*)[^\n])*?\S)\*\*)|(__(?!\s)((?:(?!__)[^\n])*?\S)__)|((?<!\*)\*(?![*\s])((?:(?!\*)[^\n])*?[^\s*])\*(?!\*))|((?<![_\w])_(?![_\s])((?:(?!_)[^\n])*?[^\s_])_(?![_\w]))|(~~(?!\s)((?:(?!~~)[^\n])*?\S)~~)/gi;

  let out = '';
  let lastIndex = 0;
  let m;

  while ((m = tokenRe.exec(segmentText)) !== null) {
    if (m.index > lastIndex) {
      const gap = segmentText.slice(lastIndex, m.index);
      out += renderPlainWithWordSpans(gap, segmentAbsOffset + lastIndex, wordSpans);
    }

    const tokStart = segmentAbsOffset + m.index;
    const full = m[0];

    if (m[1]) {
      const ticks = full.match(/^`+/)[0].length;
      const codeBody = full.length > ticks * 2 ? full.slice(ticks, full.length - ticks) : '';
      out += `<code class="inline-code">${escapeHtml(codeBody)}</code>`;
    } else if (m[2]) {
      const alt = m[3] || '';
      const rawSrc = m[4] || '';
      const title = m[5] || '';
      const resolvedUrl = resolveMarkdownImageUrl(rawSrc);
      out += `<span class="md-inline-image-wrap"><img class="md-inline-image" src="${escapeHtml(resolvedUrl)}" data-raw-src="${escapeHtml(rawSrc)}" alt="${escapeHtml(alt)}" title="${escapeHtml(title)}" loading="lazy" /><span class="md-image-error hidden" hidden>⚠ Image not found: <code>${escapeHtml(rawSrc)}</code></span></span>`;
    } else if (m[6]) {
      const srcMatch = full.match(/\bsrc=["']([^"']+)["']/i);
      const altMatch = full.match(/\balt=["']([^"']*)["']/i);
      const titleMatch = full.match(/\btitle=["']([^"']*)["']/i);
      const rawSrc = srcMatch ? srcMatch[1] : '';
      const alt = altMatch ? altMatch[1] : '';
      const title = titleMatch ? titleMatch[1] : '';
      const resolvedUrl = resolveMarkdownImageUrl(rawSrc);
      out += `<span class="md-inline-image-wrap"><img class="md-inline-image" src="${escapeHtml(resolvedUrl)}" data-raw-src="${escapeHtml(rawSrc)}" alt="${escapeHtml(alt)}" title="${escapeHtml(title)}" loading="lazy" /><span class="md-image-error hidden" hidden>⚠ Image not found: <code>${escapeHtml(rawSrc)}</code></span></span>`;
    } else if (m[7]) {
      const label = m[8];
      const url = String(m[9] || '').trim();
      const title = m[10] || '';
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      const labelHtml = renderInlineMarkdownTokens(label, tokStart + 1, wordSpans);
      if (/^\s*(javascript|data|vbscript):/i.test(url)) {
        out += labelHtml;
      } else if (/^(https?:\/\/|mailto:)/i.test(url)) {
        out += `<a class="inline-link" href="${escapeHtml(url)}"${titleAttr} target="_blank" rel="noopener noreferrer">${labelHtml}</a>`;
      } else {
        out += `<a class="inline-link local-doc-link" href="#" data-local-href="${escapeHtml(url)}"${titleAttr}>${labelHtml}</a>`;
      }
    } else if (m[11]) {
      out += `<span class="md-inline-math">${escapeHtml(m[12])}</span>`;
    } else if (m[13]) {
      out += `<span class="md-inline-math">${escapeHtml(m[14])}</span>`;
    } else if (m[15]) {
      const inner = m[16];
      out += `<strong><em>${renderInlineMarkdownTokens(inner, tokStart + 3, wordSpans)}</em></strong>`;
    } else if (m[17]) {
      const inner = m[18];
      out += `<strong>${renderInlineMarkdownTokens(inner, tokStart + 2, wordSpans)}</strong>`;
    } else if (m[19]) {
      const inner = m[20];
      out += `<strong>${renderInlineMarkdownTokens(inner, tokStart + 2, wordSpans)}</strong>`;
    } else if (m[21]) {
      const inner = m[22];
      out += `<em>${renderInlineMarkdownTokens(inner, tokStart + 1, wordSpans)}</em>`;
    } else if (m[23]) {
      const inner = m[24];
      out += `<em>${renderInlineMarkdownTokens(inner, tokStart + 1, wordSpans)}</em>`;
    } else if (m[25]) {
      const inner = m[26];
      out += `<del>${renderInlineMarkdownTokens(inner, tokStart + 2, wordSpans)}</del>`;
    } else {
      out += renderPlainWithWordSpans(full, tokStart, wordSpans);
    }

    lastIndex = m.index + full.length;
  }

  if (lastIndex < segmentText.length) {
    const tail = segmentText.slice(lastIndex);
    out += renderPlainWithWordSpans(tail, segmentAbsOffset + lastIndex, wordSpans);
  }

  return out;
}

function renderRichSliceWithSpans(sliceText, sliceBaseOffset, activeSpans) {
  if (!sliceText) return '';
  const sliceEnd = sliceBaseOffset + sliceText.length;
  const wordSpans = activeSpans.filter((s) => !s.isSentenceSpan);
  const sentenceSpans = activeSpans
    .filter((s) => s.isSentenceSpan && s.endOffset > sliceBaseOffset && s.startOffset < sliceEnd)
    .map((s) => ({
      ...s,
      clampedStart: Math.max(sliceBaseOffset, s.startOffset),
      clampedEnd: Math.min(sliceEnd, s.endOffset),
    }))
    .filter((s) => s.clampedEnd > s.clampedStart)
    .sort((a, b) => a.clampedStart - b.clampedStart);

  if (sentenceSpans.length === 0) {
    return renderInlineMarkdownTokens(sliceText, sliceBaseOffset, wordSpans);
  }

  const chosenSentences = [];
  let cursor = sliceBaseOffset;
  for (const sp of sentenceSpans) {
    if (sp.clampedStart < cursor) continue;
    chosenSentences.push(sp);
    cursor = sp.clampedEnd;
  }

  let out = '';
  let relIdx = 0;
  for (const sp of chosenSentences) {
    const relStart = sp.clampedStart - sliceBaseOffset;
    const relEnd = sp.clampedEnd - sliceBaseOffset;
    if (relStart > relIdx) {
      out += renderInlineMarkdownTokens(sliceText.slice(relIdx, relStart), sliceBaseOffset + relIdx, wordSpans);
    }
    const innerHtml = renderInlineMarkdownTokens(sliceText.slice(relStart, relEnd), sp.clampedStart, wordSpans);
    out += `<mark class="lens-span" data-span-id="${sp.id}" data-pillar="${sp.pillar}">${innerHtml}</mark>`;
    relIdx = relEnd;
  }
  if (relIdx < sliceText.length) {
    out += renderInlineMarkdownTokens(sliceText.slice(relIdx), sliceBaseOffset + relIdx, wordSpans);
  }
  return out;
}

// Full YAML & TOML Frontmatter Parser (supports block scalars > / |, arrays, nested maps)
function parseFrontmatterData(rawFrontmatter) {
  const lines = (rawFrontmatter || '').split('\n');
  if (lines.length < 2) return { format: 'yaml', data: {} };
  const isToml = lines[0].trim() === '+++';
  const bodyLines = lines.slice(1, lines[lines.length - 1].trim() === (isToml ? '+++' : '---') ? -1 : lines.length);
  const data = {};

  if (isToml) {
    for (const line of bodyLines) {
      const m = line.match(/^\s*([a-zA-Z0-9_.-]+)\s*=\s*(.+)$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if (val.startsWith('[') && val.endsWith(']')) {
        data[key] = val
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
      } else {
        data[key] = val.replace(/^["']|["']$/g, '');
      }
    }
    return { format: 'toml', data };
  }

  let i = 0;
  while (i < bodyLines.length) {
    const line = bodyLines[i];
    if (!line.trim() || line.trim().startsWith('#')) {
      i++;
      continue;
    }
    const topMatch = line.match(/^([a-zA-Z0-9_.-]+)\s*:\s*(.*)$/);
    if (!topMatch) {
      i++;
      continue;
    }
    const key = topMatch[1];
    const rest = topMatch[2].trim();

    // Block scalar (> or |)
    if (/^[>|][-+]?$/.test(rest)) {
      const foldNewlines = rest.startsWith('>');
      const scalarLines = [];
      i++;
      while (i < bodyLines.length && (/^\s+\S/.test(bodyLines[i]) || bodyLines[i].trim() === '')) {
        scalarLines.push(bodyLines[i].replace(/^\s{2}/, '').trimEnd());
        i++;
      }
      data[key] = foldNewlines
        ? scalarLines.map((l) => l.trim()).filter(Boolean).join(' ')
        : scalarLines.join('\n').trim();
      continue;
    }

    // Inline array [a, b, c]
    if (rest.startsWith('[') && rest.endsWith(']')) {
      data[key] = rest
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
      i++;
      continue;
    }

    // Multi-line list or nested map
    if (rest === '') {
      const listItems = [];
      const mapEntries = {};
      i++;
      while (i < bodyLines.length && (/^\s+\S/.test(bodyLines[i]) || bodyLines[i].trim() === '')) {
        const sub = bodyLines[i];
        const listMatch = sub.match(/^\s*-\s+(.+)$/);
        const mapMatch = sub.match(/^\s+([a-zA-Z0-9_.-]+)\s*:\s*(.*)$/);
        if (listMatch) {
          listItems.push(listMatch[1].trim().replace(/^["']|["']$/g, ''));
        } else if (mapMatch) {
          mapEntries[mapMatch[1]] = mapMatch[2].trim().replace(/^["']|["']$/g, '');
        }
        i++;
      }
      if (listItems.length > 0) {
        data[key] = listItems;
      } else if (Object.keys(mapEntries).length > 0) {
        data[key] = mapEntries;
      } else {
        data[key] = '';
      }
      continue;
    }

    data[key] = rest.replace(/^["']|["']$/g, '');
    i++;
  }

  return { format: 'yaml', data };
}

function renderFrontmatterBlockCard(block) {
  const { format, data } = parseFrontmatterData(block.raw);
  const isSkillDoc =
    (state.filePath && state.filePath.endsWith('SKILL.md')) ||
    Boolean(data.name && data.description && (data.license || data.metadata));

  if (isSkillDoc) {
    const metaObj = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
    const version = data.version || metaObj.version || '';
    const license = data.license || metaObj.license || '';
    const rawTags = metaObj.tags || data.tags || '';
    const tagList = Array.isArray(rawTags)
      ? rawTags
      : String(rawTags)
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);

    return `
      <div class="md-frontmatter-card">
        <div class="md-fm-header-row">
          <span class="md-fm-head">Agent Skill Frontmatter (SKILL.md)</span>
          <div class="md-fm-badges">
            ${version ? `<span class="md-fm-badge">v${escapeHtml(version)}</span>` : ''}
            ${license ? `<span class="md-fm-badge status-good">${escapeHtml(license)}</span>` : ''}
          </div>
        </div>
        <div class="md-fm-grid">
          <div class="md-fm-key">name</div>
          <div class="md-fm-val"><code>${escapeHtml(data.name || '')}</code></div>
          <div class="md-fm-key">description</div>
          <div class="md-fm-val">${escapeHtml(data.description || '')}</div>
          ${metaObj.author ? `<div class="md-fm-key">author</div><div class="md-fm-val">${escapeHtml(metaObj.author)}</div>` : ''}
          ${metaObj.category ? `<div class="md-fm-key">category</div><div class="md-fm-val">${escapeHtml(metaObj.category)}</div>` : ''}
          ${
            tagList.length > 0
              ? `<div class="md-fm-key">tags</div><div class="md-fm-val"><div class="md-fm-tags">${tagList
                  .map((t) => `<span class="md-fm-tag-pill">${escapeHtml(t)}</span>`)
                  .join('')}</div></div>`
              : ''
          }
        </div>
      </div>
    `;
  }

  // Hugo / Technical Article Frontmatter Card
  const titleStr = String(data.title || '');
  const summaryStr = String(data.summary || '');
  const descStr = String(data.description || '');
  const isDraft = String(data.draft || '').toLowerCase() === 'true';
  const tags = Array.isArray(data.tags)
    ? data.tags
    : typeof data.tags === 'string' && data.tags
    ? data.tags.split(',').map((t) => t.trim())
    : [];

  const sumOk = summaryStr.length >= 80 && summaryStr.length <= 180;
  const descOk = descStr.length >= 120 && descStr.length <= 160;

  const extraRows = [];
  for (const [k, v] of Object.entries(data)) {
    if (['title', 'summary', 'description', 'draft', 'tags'].includes(k)) continue;
    const valStr = Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    extraRows.push(`<div class="md-fm-key">${escapeHtml(k)}</div><div class="md-fm-val">${escapeHtml(valStr)}</div>`);
  }

  return `
    <div class="md-frontmatter-card">
      <div class="md-fm-header-row">
        <span class="md-fm-head">${format === 'toml' ? 'TOML (+++)' : 'YAML (---)'} Frontmatter</span>
        <div class="md-fm-badges">
          ${data.draft !== undefined ? `<span class="md-fm-badge ${isDraft ? 'status-warn' : 'status-good'}">${isDraft ? 'DRAFT' : 'PUBLISHED'}</span>` : ''}
          ${titleStr ? `<span class="md-fm-badge">${titleStr.length}c title</span>` : ''}
        </div>
      </div>
      <div class="md-fm-grid">
        ${titleStr ? `<div class="md-fm-key">title</div><div class="md-fm-val"><strong>${escapeHtml(titleStr)}</strong></div>` : ''}
        ${
          summaryStr
            ? `<div class="md-fm-key">summary <span class="md-fm-badge ${sumOk ? 'status-good' : 'status-warn'}">${summaryStr.length}c</span></div><div class="md-fm-val">${escapeHtml(summaryStr)}</div>`
            : ''
        }
        ${
          descStr
            ? `<div class="md-fm-key">description <span class="md-fm-badge ${descOk ? 'status-good' : 'status-warn'}">${descStr.length}c</span></div><div class="md-fm-val">${escapeHtml(descStr)}</div>`
            : ''
        }
        ${extraRows.join('')}
        ${
          tags.length > 0
            ? `<div class="md-fm-key">tags</div><div class="md-fm-val"><div class="md-fm-tags">${tags
                .map((t) => `<span class="md-fm-tag-pill">${escapeHtml(t)}</span>`)
                .join('')}</div></div>`
            : ''
        }
      </div>
    </div>
  `;
}

function renderBlockWithAmbientSpans(block) {
  if (block.type === 'hr') {
    return '<hr />';
  }

  if (block.type === 'frontmatter') {
    return renderFrontmatterBlockCard(block);
  }

  if (block.type === 'code') {
    const lines = block.raw.split('\n');
    const firstLine = lines[0] || '';
    const langMatch = firstLine.match(/^(?:`{3,}|~{3,})\s*(\S*)/);
    const lang = langMatch && langMatch[1] ? langMatch[1] : 'code';
    const hasClosingFence = lines.length > 1 && /^(?:`{3,}|~{3,})\s*$/.test(lines[lines.length - 1]);
    const codeBody = lines.slice(1, hasClosingFence ? -1 : lines.length).join('\n');
    return `
      <div class="md-code-block">
        <div class="md-code-header">
          <span>${escapeHtml(lang)}</span>
          ${state.studioMode === 'editor' ? '<span style="opacity: 0.75;">Click to edit Markdown</span>' : ''}
        </div>
        <pre class="md-code-pre"><code>${escapeHtml(codeBody)}</code></pre>
      </div>
    `;
  }

  if (block.type === 'math') {
    const mathBody = block.raw.replace(/^\$\$\s*|\s*\$\$$/g, '').trim();
    return `<div class="md-math-block">${escapeHtml(mathBody)}</div>`;
  }

  if (block.type === 'image') {
    const trimmed = block.raw.trim();
    let alt = '';
    let rawSrc = '';
    let title = '';
    const mdImg = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/);
    if (mdImg) {
      alt = mdImg[1] || '';
      rawSrc = mdImg[2] || '';
      title = mdImg[3] || '';
    } else {
      const srcM = trimmed.match(/\bsrc=["']([^"']+)["']/i);
      const altM = trimmed.match(/\balt=["']([^"']*)["']/i);
      const titleM = trimmed.match(/\btitle=["']([^"']*)["']/i);
      rawSrc = srcM ? srcM[1] : '';
      alt = altM ? altM[1] : '';
      title = titleM ? titleM[1] : '';
    }
    const resolvedUrl = resolveMarkdownImageUrl(rawSrc);
    const altBadge = alt
      ? `<span>alt: ${escapeHtml(alt)}</span>`
      : `<span style="color: var(--col-warn);">⚠ Missing image alt text</span>`;
    return `
      <figure class="md-image-figure">
        <img class="md-image" src="${escapeHtml(resolvedUrl)}" data-raw-src="${escapeHtml(rawSrc)}" alt="${escapeHtml(alt)}" title="${escapeHtml(title)}" loading="lazy" />
        <div class="md-image-error hidden" hidden>⚠ Image not found: <code>${escapeHtml(rawSrc)}</code></div>
        <figcaption class="md-image-caption">
          ${altBadge}
          <code style="font-size: 10px;">${escapeHtml(rawSrc)}</code>
        </figcaption>
      </figure>
    `;
  }

  // In Reader Mode, zero diagnostic clutter; in Editor & Reviewer Modes, show active lens spans
  const showSpans = state.studioMode === 'editor' || state.studioMode === 'reviewer';
  const activeSpans = showSpans
    ? state.spans.filter((s) => s.blockId === block.id && state.activeLenses.has(s.pillar))
    : [];

  if (block.type === 'table') {
    const rawLines = block.raw.split('\n');
    const nonEmpty = rawLines.map((line, idx) => ({ line, idx })).filter((item) => item.line.trim() !== '');
    if (nonEmpty.length < 2) return `<pre class="md-code-pre">${escapeHtml(block.raw)}</pre>`;

    const lineStartOffsets = [];
    let acc = 0;
    for (const l of rawLines) {
      lineStartOffsets.push(acc);
      acc += l.length + 1;
    }

    const parseCellsWithOffsets = (lineStr, lineAbsStart) => {
      const findNextCellPipe = (str, fromIdx) => {
        let i = fromIdx;
        while (i < str.length) {
          const ch = str[i];
          if (ch === '\\') {
            i += 2;
            continue;
          }
          if (ch === '`') {
            let tickLen = 1;
            while (i + tickLen < str.length && str[i + tickLen] === '`') tickLen++;
            const closeFence = '`'.repeat(tickLen);
            const closeIdx = str.indexOf(closeFence, i + tickLen);
            if (closeIdx >= 0) {
              i = closeIdx + tickLen;
              continue;
            }
          }
          if (ch === '|') {
            return i;
          }
          i++;
        }
        return -1;
      };

      const cells = [];
      let start = 0;
      if (lineStr.trimStart().startsWith('|')) {
        start = lineStr.indexOf('|') + 1;
      }
      let cur = start;
      while (cur <= lineStr.length) {
        const nextPipe = findNextCellPipe(lineStr, cur);
        if (nextPipe < 0) {
          const tail = lineStr.slice(cur);
          if (tail.trim()) {
            const lead = (tail.match(/^\s*/) || [''])[0].length;
            cells.push({
              text: tail.trim().replace(/\\\|/g, '|'),
              absOffset: lineAbsStart + cur + lead,
            });
          }
          break;
        }
        const rawCell = lineStr.slice(cur, nextPipe);
        const lead = (rawCell.match(/^\s*/) || [''])[0].length;
        cells.push({
          text: rawCell.trim().replace(/\\\|/g, '|'),
          absOffset: lineAbsStart + cur + lead,
        });
        cur = nextPipe + 1;
      }
      return cells;
    };

    const alignCells = parseCellsWithOffsets(nonEmpty[1].line, lineStartOffsets[nonEmpty[1].idx]);
    const alignments = alignCells.map((c) => {
      const t = c.text;
      if (t.startsWith(':') && t.endsWith(':')) return 'center';
      if (t.endsWith(':')) return 'right';
      return 'left';
    });

    const headerCells = parseCellsWithOffsets(nonEmpty[0].line, lineStartOffsets[nonEmpty[0].idx]);
    const thead = `<thead><tr>${headerCells
      .map((c, colIdx) => {
        const align = alignments[colIdx] || 'left';
        return `<th style="text-align:${align};">${renderRichSliceWithSpans(c.text, c.absOffset, activeSpans)}</th>`;
      })
      .join('')}</tr></thead>`;

    const bodyRowsHtml = nonEmpty.slice(2).map((rowItem) => {
      const rowCells = parseCellsWithOffsets(rowItem.line, lineStartOffsets[rowItem.idx]);
      return `<tr>${rowCells
        .map((c, colIdx) => {
          const align = alignments[colIdx] || 'left';
          return `<td style="text-align:${align};">${renderRichSliceWithSpans(c.text, c.absOffset, activeSpans)}</td>`;
        })
        .join('')}</tr>`;
    });

    return `<div class="md-table-wrap"><table class="md-table">${thead}<tbody>${bodyRowsHtml.join('')}</tbody></table></div>`;
  }

  if (block.type === 'heading') {
    const prefixMatch = block.raw.match(/^(#{1,6}\s+)/);
    const prefixLen = prefixMatch ? prefixMatch[1].length : 0;
    return renderRichSliceWithSpans(block.raw.slice(prefixLen), prefixLen, activeSpans);
  }

  if (block.type === 'list') {
    const lines = block.raw.split('\n');
    const isOrdered = /^\s*\d+\.\s+/.test(lines[0] || '');
    const tag = isOrdered ? 'ol' : 'ul';
    const itemsHtml = [];
    let lineOffset = 0;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const taskMatch = line.match(/^(\s*(?:[-*+]|\d+\.)\s+\[([ xX])\]\s+)(.*)$/);
      const stdMatch = !taskMatch ? line.match(/^(\s*(?:[-*+]|\d+\.)\s+)(.*)$/) : null;

      if (taskMatch) {
        const markerLen = taskMatch[1].length;
        const checked = taskMatch[2].toLowerCase() === 'x';
        const body = taskMatch[3];
        const indentPx = Math.floor(((line.match(/^\s*/) || [''])[0].length) / 2) * 16;
        itemsHtml.push(
          `<li class="md-list-item md-task-item" style="${indentPx ? `margin-left:${indentPx - 18}px;` : ''}"><input type="checkbox" class="md-task-checkbox" data-line-idx="${lineIdx}" ${
            checked ? 'checked' : ''
          } /><span>${renderRichSliceWithSpans(body, lineOffset + markerLen, activeSpans)}</span></li>`
        );
      } else if (stdMatch) {
        const markerLen = stdMatch[1].length;
        const body = stdMatch[2];
        const indentPx = Math.floor(((line.match(/^\s*/) || [''])[0].length) / 2) * 16;
        itemsHtml.push(
          `<li class="md-list-item" style="${indentPx ? `margin-left:${indentPx}px;` : ''}">${renderRichSliceWithSpans(
            body,
            lineOffset + markerLen,
            activeSpans
          )}</li>`
        );
      } else if (line.trim()) {
        const leadSpaces = (line.match(/^\s*/) || [''])[0].length;
        const body = line.slice(leadSpaces);
        if (itemsHtml.length > 0) {
          itemsHtml[itemsHtml.length - 1] = itemsHtml[itemsHtml.length - 1].replace(
            /<\/li>$/,
            ` ${renderRichSliceWithSpans(body, lineOffset + leadSpaces, activeSpans)}</li>`
          );
        } else {
          itemsHtml.push(`<li class="md-list-item">${renderRichSliceWithSpans(body, lineOffset + leadSpaces, activeSpans)}</li>`);
        }
      }
      lineOffset += line.length + 1;
    }

    return `<${tag} class="md-list">${itemsHtml.join('')}</${tag}>`;
  }

  if (block.type === 'blockquote') {
    const lines = block.raw.split('\n');
    const firstStrip = (lines[0] || '').replace(/^\s*>\s?/, '');
    const alertHeaderMatch = firstStrip.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i);

    if (alertHeaderMatch) {
      const kind = alertHeaderMatch[1].toUpperCase();
      const firstRest = alertHeaderMatch[2];
      const bodyParts = [];
      let lineOffset = 0;

      for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];
        const m = line.match(/^(\s*>\s?)(.*)$/);
        const prefixLen = m ? m[1].length : 0;
        const body = m ? m[2] : line;
        if (idx === 0) {
          if (firstRest.trim()) {
            const restOffset = lineOffset + prefixLen + (body.length - firstRest.length);
            bodyParts.push(renderRichSliceWithSpans(firstRest, restOffset, activeSpans));
          }
        } else if (body.trim()) {
          bodyParts.push(renderRichSliceWithSpans(body, lineOffset + prefixLen, activeSpans));
        }
        lineOffset += line.length + 1;
      }

      return `
        <div class="md-alert md-alert-${kind.toLowerCase()}">
          <div class="md-alert-head">${escapeHtml(kind)}</div>
          <div>${bodyParts.join('<br />')}</div>
        </div>
      `;
    }

    const renderedLines = [];
    let lineOffset = 0;
    for (const line of lines) {
      const m = line.match(/^(\s*>\s?)(.*)$/);
      const prefixLen = m ? m[1].length : 0;
      const body = m ? m[2] : line;
      renderedLines.push(renderRichSliceWithSpans(body, lineOffset + prefixLen, activeSpans));
      lineOffset += line.length + 1;
    }
    return renderedLines.join('<br />');
  }

  const lines = block.raw.split('\n');
  if (lines.length === 1) {
    return renderRichSliceWithSpans(block.raw, 0, activeSpans);
  }
  const parts = [];
  let lineOffset = 0;
  for (const line of lines) {
    parts.push(renderRichSliceWithSpans(line, lineOffset, activeSpans));
    lineOffset += line.length + 1;
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Block Editor Textarea Auto-Resize Helper
// ---------------------------------------------------------------------------

function autoResizeBlockTextarea(textareaEl) {
  if (!textareaEl) return;
  textareaEl.style.height = 'auto';
  textareaEl.style.height = `${Math.max(44, textareaEl.scrollHeight)}px`;
}

// ---------------------------------------------------------------------------
// Comment Popup Window (#comment-popover) & Reviewer Inline Threads (<!-- review: ... -->)
// ---------------------------------------------------------------------------

function positionCommentPopoverNear(anchorEl) {
  const pop = document.getElementById('comment-popover');
  if (!pop) return;
  if (!anchorEl || typeof anchorEl.getBoundingClientRect !== 'function') {
    pop.style.top = '72px';
    pop.style.left = `${Math.max(12, Math.round((window.innerWidth - pop.offsetWidth) / 2))}px`;
    return;
  }
  const rect = anchorEl.getBoundingClientRect();
  let top = rect.bottom + 8;
  if (top + pop.offsetHeight > window.innerHeight - 12) {
    top = Math.max(12, rect.top - pop.offsetHeight - 8);
  }
  const left = Math.min(window.innerWidth - pop.offsetWidth - 12, Math.max(12, rect.right - pop.offsetWidth));
  pop.style.top = `${Math.max(12, top)}px`;
  pop.style.left = `${left}px`;
}

function closeCommentPopover() {
  state.activeCommentBlockId = null;
  state.editingCommentId = null;
  state.pendingCommentQuote = '';
  setHidden('comment-popover', true);
}

function openCommentPopoverForBlock(blockId, anchorEl = null, quoteText = '', editReviewId = null) {
  const block = state.blocks.find((b) => b.id === blockId);
  if (!block) return;

  state.activeCommentBlockId = blockId;
  state.editingCommentId = editReviewId;
  state.pendingCommentQuote = quoteText || '';

  renderCommentPopover(block, anchorEl);
}

function renderCommentPopover(block, anchorEl = null) {
  const pop = document.getElementById('comment-popover');
  const titleEl = document.getElementById('comment-popover-title');
  const bodyEl = document.getElementById('comment-popover-body');
  if (!pop || !titleEl || !bodyEl || !block) return;

  if (!Array.isArray(block.reviews)) block.reviews = [];
  const reviews = block.reviews;

  titleEl.textContent =
    reviews.length > 0
      ? `Paragraph Comments · L${block.startLine} (${reviews.length})`
      : `Add Paragraph Comment · L${block.startLine}`;

  bodyEl.innerHTML = '';

  // 1. If existing comments exist on this paragraph, load them so the user can edit or resolve them
  for (const rev of reviews) {
    const item = document.createElement('div');
    item.className = 'comment-popover-item';
    item.innerHTML = `
      <div class="comment-popover-item-head">
        <span>💬 Comment${rev.ts ? ` · ${escapeHtml(rev.ts)}` : ''}</span>
        <div style="display:flex;gap:4px;">
          <button class="btn-primary" type="button" data-action="save-existing" style="padding:2px 7px;font-size:10px;">Save</button>
          <button class="btn-success" type="button" data-action="resolve-existing" style="padding:2px 7px;font-size:10px;">✓ Resolve</button>
        </div>
      </div>
      ${
        rev.quote
          ? `<div class="review-quote-pill" style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
              <span>“${escapeHtml(rev.quote)}”</span>
              <button class="block-mini-icon" type="button" data-action="clear-existing-quote" title="Remove quote" style="width:18px;height:18px;">×</button>
            </div>`
          : ''
      }
      <textarea class="review-comment-input" rows="2" data-rev-id="${escapeHtml(rev.id)}"></textarea>
    `;

    const ta = item.querySelector('textarea');
    ta.value = rev.text || '';

    const saveExisting = () => {
      const nextText = ta.value.trim();
      if (!nextText) return;
      recordHistorySnapshot(`Before updating comment on L${block.startLine}`);
      rev.text = nextText;
      rev.ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
      recomputeBlockLineNumbers();
      recordHistorySnapshot(`Updated comment on L${block.startLine}`);
      updateHeaderTelemetry();
      renderCommentPopover(block);
      renderCanvas();
      syncDocumentToDisk('user', `Updated review comment on L${block.startLine}`);
    };

    ta.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        saveExisting();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeCommentPopover();
      }
    });

    item.querySelector('[data-action="clear-existing-quote"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      rev.quote = '';
      renderCommentPopover(block);
      renderCanvas();
      syncDocumentToDisk('user', `Cleared quote on L${block.startLine}`);
    });

    item.querySelector('[data-action="save-existing"]').addEventListener('click', (e) => {
      e.stopPropagation();
      saveExisting();
    });

    item.querySelector('[data-action="resolve-existing"]').addEventListener('click', (e) => {
      e.stopPropagation();
      recordHistorySnapshot(`Before resolving comment on L${block.startLine}`);
      block.reviews = block.reviews.filter((r) => r.id !== rev.id);
      recomputeBlockLineNumbers();
      recordHistorySnapshot(`Resolved comment on L${block.startLine}`);
      updateHeaderTelemetry();
      if (block.reviews.length === 0) {
        closeCommentPopover();
      } else {
        renderCommentPopover(block);
      }
      renderCanvas();
      syncDocumentToDisk('user', `Resolved review comment on L${block.startLine}`);
    });

    bodyEl.appendChild(item);
  }

  // 2. Composer to add a new comment (always shown when no comments exist, or below existing comments)
  const composer = document.createElement('div');
  composer.className = 'comment-popover-composer';
  composer.innerHTML = `
    ${
      reviews.length > 0
        ? `<div style="font-size:10.5px;font-weight:600;color:var(--text-muted);padding-top:2px;">Add Another Comment</div>`
        : ''
    }
    ${
      state.pendingCommentQuote
        ? `<div class="review-quote-pill" style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
            <span>Quoting: “${escapeHtml(state.pendingCommentQuote)}”</span>
            <button class="block-mini-icon" type="button" data-action="clear-new-quote" title="Clear quote" style="width:18px;height:18px;">×</button>
          </div>`
        : ''
    }
    <textarea id="comment-popover-new-input" class="review-comment-input" rows="2" placeholder="Add review comment (saved as <!-- review: ... --> on disk)…"></textarea>
    <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;">
      <button class="btn-secondary" type="button" data-action="close-pop">Close</button>
      <button class="btn-primary" type="button" data-action="add-new-comment">Add Comment</button>
    </div>
  `;

  const newTa = composer.querySelector('#comment-popover-new-input');

  composer.querySelector('[data-action="clear-new-quote"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    state.pendingCommentQuote = '';
    renderCommentPopover(block);
  });

  const addNewComment = () => {
    const text = newTa.value.trim();
    if (!text) return;
    recordHistorySnapshot(`Before adding comment on L${block.startLine}`);
    const nowIso = new Date().toISOString().slice(0, 16).replace('T', ' ');
    block.reviews.push({
      id: `rev-${Date.now().toString(36)}`,
      quote: state.pendingCommentQuote || '',
      ts: nowIso,
      text,
    });
    state.pendingCommentQuote = '';
    recomputeBlockLineNumbers();
    recordHistorySnapshot(`Added review comment on L${block.startLine}`);
    updateHeaderTelemetry();
    closeCommentPopover();
    renderCanvas();
    syncDocumentToDisk('user', `Added review comment on L${block.startLine}`);
  };

  newTa.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      addNewComment();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeCommentPopover();
    }
  });

  composer.querySelector('[data-action="add-new-comment"]').addEventListener('click', (e) => {
    e.stopPropagation();
    addNewComment();
  });

  composer.querySelector('[data-action="close-pop"]').addEventListener('click', (e) => {
    e.stopPropagation();
    closeCommentPopover();
  });

  bodyEl.appendChild(composer);

  setHidden(pop, false);
  if (anchorEl) {
    positionCommentPopoverNear(anchorEl);
  }

  setTimeout(() => {
    if (state.editingCommentId) {
      const targetTa = bodyEl.querySelector(`textarea[data-rev-id="${CSS.escape(state.editingCommentId)}"]`);
      if (targetTa) {
        targetTa.focus();
        targetTa.setSelectionRange(targetTa.value.length, targetTa.value.length);
        return;
      }
    }
    if (reviews.length === 0) {
      newTa.focus();
    } else {
      const firstTa = bodyEl.querySelector('textarea[data-rev-id]');
      if (firstTa) {
        firstTa.focus();
        firstTa.setSelectionRange(firstTa.value.length, firstTa.value.length);
      }
    }
  }, 15);
}

// Inline Review Thread Card (rendered in the document body ONLY in Reviewer Mode)
function createReviewThreadCard(block) {
  const wrap = document.createElement('div');
  wrap.className = 'block-review-thread';

  const reviews = Array.isArray(block.reviews) ? block.reviews : [];
  for (const rev of reviews) {
    const item = document.createElement('div');
    item.className = 'review-comment-card';
    item.innerHTML = `
      <div class="review-comment-head">
        <span>💬 Review Comment · L${block.startLine}${rev.ts ? ` · ${escapeHtml(rev.ts)}` : ''}</span>
        <div style="display: flex; gap: 4px;">
          <button class="btn-secondary" type="button" data-action="edit-rev" style="padding: 2px 6px; font-size: 10px;">Edit</button>
          <button class="btn-success" type="button" data-action="resolve-rev" style="padding: 2px 6px; font-size: 10px;">✓ Resolve</button>
        </div>
      </div>
      ${rev.quote ? `<div class="review-quote-pill">“${escapeHtml(rev.quote)}”</div>` : ''}
      <div class="review-comment-body">${escapeHtml(rev.text)}</div>
    `;

    item.querySelector('[data-action="edit-rev"]').addEventListener('click', (e) => {
      e.stopPropagation();
      openCommentPopoverForBlock(block.id, e.currentTarget, rev.quote || '', rev.id);
    });

    item.querySelector('[data-action="resolve-rev"]').addEventListener('click', (e) => {
      e.stopPropagation();
      recordHistorySnapshot(`Before resolving comment on L${block.startLine}`);
      block.reviews = block.reviews.filter((r) => r.id !== rev.id);
      recomputeBlockLineNumbers();
      recordHistorySnapshot(`Resolved comment on L${block.startLine}`);
      updateHeaderTelemetry();
      renderCanvas();
      syncDocumentToDisk('user', `Resolved review comment on L${block.startLine}`);
    });

    wrap.appendChild(item);
  }

  return wrap;
}

async function dispatchReviewCommentsToAgent() {
  if (state.reviewDispatchConfirmation) return;
  const total = getTotalReviewComments();
  if (total === 0) return;

  if (!state.aiSettings?.configured) {
    toggleSettingsPopover(true, 'general');
    showError(
      'Configure Vertex AI Project ID or Gemini API Key in Settings (⚙️) to resolve review comments with AI.'
    );
    return;
  }

  closeCommentPopover();
  clearError();
  recordHistorySnapshot('Before resolving review comments with AI');

  const fullDocumentWithComments = serializeBlocksToMarkdown(state.blocks);
  const previousReviewsByBlockId = new Map();
  const targetBlocksInfo = [];
  const modelLabel = state.aiSettings?.model || 'gemini-3.8-flash';

  for (const b of state.blocks) {
    if (!Array.isArray(b.reviews) || b.reviews.length === 0) continue;
    const blockReviews = b.reviews.map((r) => ({ ...r }));
    previousReviewsByBlockId.set(b.id, blockReviews);
    targetBlocksInfo.push({ block: b, reviews: blockReviews });
    b.reviews = [];
    b.busy = true;
    b.busyLabel = `AI (${modelLabel}) resolving ${blockReviews.length} review comment${blockReviews.length === 1 ? '' : 's'}…`;
  }

  recomputeBlockLineNumbers();

  if (reviewDispatchConfirmTimer) {
    clearTimeout(reviewDispatchConfirmTimer);
  }
  state.reviewDispatchConfirmation = {
    count: total,
  };
  reviewDispatchConfirmTimer = setTimeout(() => {
    reviewDispatchConfirmTimer = null;
    state.reviewDispatchConfirmation = null;
    updateHeaderTelemetry();
  }, 3500);

  setSyncStatus('agent', `${modelLabel} resolving ${total} review comment${total === 1 ? '' : 's'}…`);
  updateHeaderTelemetry();
  renderCanvas();

  const telemetrySections = targetBlocksInfo.map(({ block }) => buildParagraphContextTelemetryMarkdown(block));

  try {
    const res = await apiPost('/api/ai/rewrite', {
      fullDocument: fullDocumentWithComments,
      skill: 'readability',
      instruction: `Address and resolve all ${total} reviewer comment(s) on the target paragraph(s) while preserving surrounding context, technical accuracy, and the author's voice.`,
      telemetryContext: telemetrySections.join('\n\n'),
      targetBlocks: targetBlocksInfo.map(({ block, reviews }) => ({
        id: block.id,
        startLine: block.startLine,
        endLine: block.endLine,
        type: block.type,
        raw: block.raw,
        reviews,
      })),
    });

    const proposals = Array.isArray(res.proposals) ? res.proposals : [];
    const proposalById = new Map(proposals.map((p) => [p.id, p]));

    for (const { block, reviews } of targetBlocksInfo) {
      block.busy = false;
      block.busyLabel = '';
      const prop = proposalById.get(block.id);
      if (prop && typeof prop.newRaw === 'string') {
        block.diff = {
          oldRaw: block.raw,
          newRaw: prop.newRaw,
          newReviews: [],
          oldReviews: reviews,
          fromDisk: false,
          source: `✨ AI Proposal (${res.model || modelLabel})${prop.summary ? ` · ${prop.summary}` : ''}`,
          acceptLabel: '✓ Accept Change',
          rejectLabel: '✕ Reject',
        };
      } else {
        block.reviews = reviews;
      }
    }

    recomputeBlockLineNumbers();
    recordHistorySnapshot('AI staged review comment proposals');
    setSyncStatus('agent', 'Review AI proposals');
    updateHeaderTelemetry();
    renderCanvas();
  } catch (err) {
    if (reviewDispatchConfirmTimer) {
      clearTimeout(reviewDispatchConfirmTimer);
      reviewDispatchConfirmTimer = null;
    }
    state.reviewDispatchConfirmation = null;
    for (const { block } of targetBlocksInfo) {
      block.reviews = previousReviewsByBlockId.get(block.id) || [];
      block.busy = false;
      block.busyLabel = '';
    }
    recomputeBlockLineNumbers();
    setSyncStatus('idle', 'AI Rewrite Error');
    updateHeaderTelemetry();
    renderCanvas();
    showError(`AI review comment resolution failed:\n${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Document Canvas & Empty State Rendering
// ---------------------------------------------------------------------------

function renderEmptyState() {
  const listEl = document.getElementById('empty-workspace-files');
  const subtitleEl = document.getElementById('empty-state-subtitle');
  if (subtitleEl) {
    subtitleEl.innerHTML = state.workspacePath
      ? `Workspace: <code>${escapeHtml(pathBasename(state.workspacePath) || state.workspacePath)}</code> · Select a Markdown file below or start a new draft.`
      : 'Select a Markdown file from your workspace or start a new draft.';
  }
  if (!listEl) return;

  if (!Array.isArray(state.files) || state.files.length === 0) {
    listEl.innerHTML = '';
    setHidden(listEl, true);
    return;
  }

  listEl.innerHTML = '';
  setHidden(listEl, false);
  const shown = state.files.slice(0, 8);
  for (const f of shown) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'empty-file-btn';
    btn.innerHTML = `
      <span class="empty-file-name">${escapeHtml(f.rel || f.name || f.path)}</span>
      <span class="cmd-row-badge">${f.source === 'artifact' ? 'Artifact' : 'Workspace'}</span>
    `;
    btn.addEventListener('click', () => {
      openDocument(f.path);
    });
    listEl.appendChild(btn);
  }
}

function renderCanvas() {
  const canvasEl = document.getElementById('block-canvas');
  const rawWrapEl = document.getElementById('raw-editor-wrap');
  const rawTextareaEl = document.getElementById('raw-markdown-editor');
  if (!canvasEl) return;

  if (!state.filePath && state.blocks.length === 0) {
    setHidden('canvas-empty', false);
    setHidden('block-canvas', true);
    if (rawWrapEl) setHidden(rawWrapEl, true);
    setHidden('sheet-footer', true);
    renderEmptyState();
    return;
  }

  // 4. Raw Mode: Full-document raw Markdown source editor
  if (state.studioMode === 'raw') {
    setHidden('canvas-empty', true);
    setHidden('block-canvas', true);
    if (rawWrapEl) setHidden(rawWrapEl, false);
    setHidden('sheet-footer', false);

    const fullMd = serializeBlocksToMarkdown(state.blocks);
    if (rawTextareaEl && document.activeElement !== rawTextareaEl) {
      rawTextareaEl.value = fullMd;
    }
    const statsEl = document.getElementById('raw-line-count-badge');
    if (statsEl) {
      const lineCount = fullMd ? fullMd.split('\n').length : 0;
      statsEl.textContent = `${lineCount} lines · ${countWordsInText(fullMd)} words`;
    }
    return;
  }

  if (rawWrapEl) setHidden(rawWrapEl, true);

  const isReader = state.studioMode === 'reader';
  const isEditor = state.studioMode === 'editor';
  const isReviewer = state.studioMode === 'reviewer';
  const showDiagnostics = isEditor || isReviewer;

  const heatmapOn = showDiagnostics && state.activeLenses.has('heatmap');
  canvasEl.classList.toggle('heatmap-active', heatmapOn);

  setHidden('canvas-empty', true);
  setHidden('block-canvas', false);
  setHidden('sheet-footer', false);
  canvasEl.innerHTML = '';

  state.blocks.forEach((block, blockIdx) => {
    const isEditing = isEditor && state.activeBlockId === block.id;
    const article = document.createElement('article');
    article.className = 'doc-block';
    article.dataset.blockId = block.id;
    article.dataset.type = block.type;
    if (block.level) article.dataset.level = String(block.level);
    if (isEditing) article.classList.add('is-editing');
    if (block.busy) article.classList.add('is-busy');

    if (block.type === 'blockquote' && /^\s*>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(block.raw)) {
      article.dataset.alert = 'true';
    }

    const diag = showDiagnostics ? computeBlockDiagnostics(block) : null;
    if (diag) {
      article.dataset.heatmap = diag.health;
    }

    // Hover Pill per Mode:
    // - Reader Mode: ONLY 💬 Comment (opens #comment-popover; comments are NOT rendered in the body)
    // - Editor Mode: Heatmap Pill + 💬 Comment + ✎ Edit + ✨ Ask Agent + 3-Angle Variant Tournament
    // - Reviewer Mode: Heatmap Pill + 💬 Comment + ✨ Ask Agent (plus inline review thread cards rendered in the body)
    const hoverPill = document.createElement('div');
    hoverPill.className = 'block-hover-pill';
    const typeLabel = block.type === 'heading' ? `H${block.level}` : block.type.slice(0, 4).toUpperCase();
    const revCount = Array.isArray(block.reviews) ? block.reviews.length : 0;

    if (isReader) {
      hoverPill.innerHTML = `
        <button class="block-comment-trigger" type="button" data-action="comment" title="View or add paragraph comment">
          💬 Comment${revCount > 0 ? ` (${revCount})` : ''}
        </button>
      `;
    } else if (isEditing) {
      hoverPill.innerHTML = `
        <span class="block-tag-label">RAW MD · L${block.startLine}</span>
        <button class="block-done-btn" type="button" data-action="done-edit" title="Finish editing and render Markdown (Esc)">✓ Done</button>
        <button class="block-mini-icon" type="button" data-action="cmd" data-tooltip="Ask Agent (⌘K / ⌘I)" data-tooltip-pos="top">
          <svg viewBox="0 0 24 24"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>
        </button>
      `;
    } else if (isReviewer) {
      const diagPillHtml = diag
        ? `<button class="block-heatmap-pill" type="button" data-action="block-diag" data-health="${diag.health}" title="Click for Paragraph Diagnostic Breakdown">Fog ${diag.fog} · Slop ${diag.slopCount} · Vale ${diag.valeCount}</button>`
        : `<span class="block-tag-label">L${block.startLine}·${escapeHtml(typeLabel)}</span>`;
      hoverPill.innerHTML = `
        ${diagPillHtml}
        <button class="block-comment-trigger" type="button" data-action="comment" title="Add or edit paragraph comment">
          💬 Comment${revCount > 0 ? ` (${revCount})` : ''}
        </button>
        <button class="block-mini-icon" type="button" data-action="cmd" data-tooltip="Ask Agent (⌘K / ⌘I)" data-tooltip-pos="top">
          <svg viewBox="0 0 24 24"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>
        </button>
      `;
    } else {
      const diagPillHtml = diag
        ? `<button class="block-heatmap-pill" type="button" data-action="block-diag" data-health="${diag.health}" title="Click for Paragraph Diagnostic Breakdown">Fog ${diag.fog} · Slop ${diag.slopCount} · Vale ${diag.valeCount}</button>`
        : `<span class="block-tag-label">L${block.startLine}·${escapeHtml(typeLabel)}</span>`;
      hoverPill.innerHTML = `
        ${diagPillHtml}
        <button class="block-mini-icon" type="button" data-action="comment" data-tooltip="Paragraph Comments${revCount ? ` (${revCount})` : ''}" data-tooltip-pos="top">
          <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </button>
        <button class="block-mini-icon" type="button" data-action="cmd" data-tooltip="Ask Agent (⌘K / ⌘I)" data-tooltip-pos="top">
          <svg viewBox="0 0 24 24"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>
        </button>
        <button class="block-mini-icon" type="button" data-action="tourney" data-tooltip="3-Angle Variant Tournament (Gemini AI)" data-tooltip-pos="left">
          <svg viewBox="0 0 24 24"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
        </button>
      `;
    }

    hoverPill.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });

    hoverPill.querySelector('[data-action="comment"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const selText = window.getSelection()?.toString().trim() || '';
      openCommentPopoverForBlock(block.id, e.currentTarget, selText);
    });
    hoverPill.querySelector('[data-action="block-diag"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (diag) {
        showBlockDiagnosticPopover(e.currentTarget, block, diag);
      }
    });
    hoverPill.querySelector('[data-action="done-edit"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      exitBlockEditMode(block.id);
    });
    hoverPill.querySelector('[data-action="cmd"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openCommandPaletteForBlock(block.id);
    });
    hoverPill.querySelector('[data-action="tourney"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      launchVariantTournamentForBlock(block.id);
    });
    article.appendChild(hoverPill);

    const surface = document.createElement('div');
    surface.className = 'block-surface';
    surface.dataset.blockId = block.id;

    if (isEditing) {
      const ta = document.createElement('textarea');
      ta.className = 'block-editor-textarea';
      ta.dataset.blockId = block.id;
      ta.spellcheck = true;
      ta.value = block.raw;

      ta.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      });
      ta.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      ta.addEventListener('input', () => {
        if (state.activeBlockId !== block.id) return;
        block.raw = ta.value.replace(/\r\n/g, '\n');
        autoResizeBlockTextarea(ta);
        if (/^(#{1,6})\s+/.test(block.raw)) {
          block.type = 'heading';
          block.level = block.raw.match(/^(#{1,6})\s+/)[1].length;
          article.dataset.type = 'heading';
          article.dataset.level = String(block.level);
        }
        scheduleTypingHistorySnapshot(`Edited L${block.startLine}`);
        scheduleDebouncedSync('user', `Edited block #${blockIdx + 1}`);
      });

      ta.addEventListener('keydown', (e) => {
        handleBlockKeydown(e, block, blockIdx, ta);
      });

      surface.appendChild(ta);
      setTimeout(() => autoResizeBlockTextarea(ta), 0);
    } else {
      surface.innerHTML = renderBlockWithAmbientSpans(block);
    }

    // Bind image error handlers, link drill-down & interactive task checkboxes inside rendered surface
    if (!isEditing) {
      surface.querySelectorAll('a.inline-link').forEach((linkEl) => {
        linkEl.addEventListener('click', (e) => {
          handleMarkdownLinkClick(e, linkEl);
        });
      });

      surface.querySelectorAll('img').forEach((imgEl) => {
        imgEl.addEventListener('error', () => {
          imgEl.classList.add('hidden');
          imgEl.hidden = true;
          const errSib = imgEl.parentElement?.querySelector('.md-image-error');
          if (errSib) {
            errSib.classList.remove('hidden');
            errSib.hidden = false;
          }
        });
      });

      surface.querySelectorAll('input.md-task-checkbox').forEach((chk) => {
        chk.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isReader) return;
          const lineIdx = Number(chk.dataset.lineIdx);
          const rawLines = block.raw.split('\n');
          if (lineIdx >= 0 && lineIdx < rawLines.length) {
            recordHistorySnapshot(`Before toggling task on L${block.startLine + lineIdx}`);
            rawLines[lineIdx] = rawLines[lineIdx].replace(
              /^(\s*(?:[-*+]|\d+\.)\s+\[)([ xX])(\]\s+)/,
              (_, pre, cur, post) => `${pre}${cur.toLowerCase() === 'x' ? ' ' : 'x'}${post}`
            );
            block.raw = rawLines.join('\n');
            recordHistorySnapshot(`Toggled task on L${block.startLine + lineIdx}`);
            renderCanvas();
            syncDocumentToDisk('user', `Toggled task list item`);
          }
        });
      });

      // In Editor Mode, clicking anywhere on a block enters edit mode reliably
      surface.addEventListener('click', (e) => {
        if (!isEditor) return;
        if (e.target.closest('a.inline-link') || e.target.closest('input.md-task-checkbox')) {
          return;
        }
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
          return;
        }
        e.stopPropagation();
        if (state.activeBlockId !== block.id) {
          enterBlockEditMode(block.id);
        }
      });
    }

    article.appendChild(surface);

    // Inline paragraph review comment thread: ONLY rendered in the body in Reviewer Mode!
    // (In Reader Mode and Editor Mode, comments are NOT rendered in the body; clicking 💬 Comment opens #comment-popover.)
    if (isReviewer && Array.isArray(block.reviews) && block.reviews.length > 0) {
      article.appendChild(createReviewThreadCard(block));
    }

    if (block.busy && block.busyLabel) {
      const busyBanner = document.createElement('div');
      busyBanner.className = 'block-busy-banner';
      busyBanner.innerHTML = `<span class="busy-spinner"></span><span>${escapeHtml(block.busyLabel)}</span>`;
      article.appendChild(busyBanner);
    }

    if (block.diff) {
      article.appendChild(createInlineDiffCard(block, block.diff));
    }

    if (isEditor && !block.busy && block.tournament) {
      article.appendChild(createTournamentCard(block));
    }

    canvasEl.appendChild(article);
  });

  if (showDiagnostics) {
    bindLensSpanHoverEvents();
  }
}

function enterBlockEditMode(blockId, _clientX = undefined, _clientY = undefined, caretOffset = undefined) {
  if (state.studioMode !== 'editor') {
    setStudioMode('editor');
  }
  hideLensPopover();
  closeCommentPopover();
  recordHistorySnapshot('Before block edit');
  state.activeBlockId = blockId;
  renderCanvas();
  const ta = document.querySelector(`.block-editor-textarea[data-block-id="${blockId}"]`);
  if (!ta) return;
  autoResizeBlockTextarea(ta);
  ta.focus();
  const pos = typeof caretOffset === 'number' ? Math.min(ta.value.length, Math.max(0, caretOffset)) : ta.value.length;
  ta.setSelectionRange(pos, pos);
}

function exitBlockEditMode(blockId) {
  if (state.activeBlockId !== blockId) return;
  flushPendingHistorySnapshot('Edited block');
  state.activeBlockId = null;

  const prevTransientByRaw = new Map();
  for (const b of state.blocks) {
    if (b.busy || b.diff || b.tournament) {
      prevTransientByRaw.set(b.raw, {
        busy: b.busy,
        busyLabel: b.busyLabel,
        diff: b.diff,
        tournament: b.tournament,
      });
    }
  }
  state.blocks = parseDocumentIntoBlocks(serializeBlocksToMarkdown(state.blocks));
  for (const b of state.blocks) {
    const t = prevTransientByRaw.get(b.raw);
    if (t) {
      b.busy = t.busy;
      b.busyLabel = t.busyLabel;
      b.diff = t.diff;
      b.tournament = t.tournament;
      prevTransientByRaw.delete(b.raw);
    }
  }
  recomputeBlockLineNumbers();
  if (state.audit) {
    state.spans = buildAmbientSpansFromAudit(state.audit);
  }
  renderCanvas();
  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = null;
    syncDocumentToDisk('user', 'Edited block');
  }
}

function isUndoShortcut(e) {
  return (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z';
}

function isRedoShortcut(e) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
  const k = e.key.toLowerCase();
  return k === 'y' || (e.shiftKey && k === 'z');
}

function handleBlockKeydown(e, block, blockIdx, textareaEl) {
  if (isUndoShortcut(e)) {
    e.preventDefault();
    e.stopPropagation();
    performUndo();
    return;
  }
  if (isRedoShortcut(e)) {
    e.preventDefault();
    e.stopPropagation();
    performRedo();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'i')) {
    e.preventDefault();
    const selText = textareaEl.value.slice(textareaEl.selectionStart, textareaEl.selectionEnd).trim();
    openCommandPaletteForBlock(block.id, selText);
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    flushPendingHistorySnapshot('Saved');
    syncDocumentToDisk('user', 'Saved');
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    exitBlockEditMode(block.id);
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey && (block.type === 'heading' || block.type === 'paragraph')) {
    e.preventDefault();
    flushPendingHistorySnapshot('Before split');
    const offset = textareaEl.selectionStart;
    const before = block.raw.slice(0, offset);
    const after = block.raw.slice(offset);
    block.raw = before;
    const newBlock = {
      id: `b-${blockIdx + 1}`,
      type: 'paragraph',
      level: 0,
      raw: after.replace(/^\n+/, ''),
      startLine: block.endLine + 1,
      endLine: block.endLine + 1,
      trailingBlankLines: 1,
      reviews: [],
      diff: null,
      tournament: null,
      busy: false,
    };
    state.blocks.splice(blockIdx + 1, 0, newBlock);
    recomputeBlockLineNumbers();
    recordHistorySnapshot('Split block');
    enterBlockEditMode(newBlock.id, undefined, undefined, 0);
    scheduleDebouncedSync('user', 'Split block');
    return;
  }
  if (e.key === 'Backspace' && blockIdx > 0) {
    if (textareaEl.selectionStart === 0 && textareaEl.selectionEnd === 0) {
      e.preventDefault();
      flushPendingHistorySnapshot('Before merge');
      const prevBlock = state.blocks[blockIdx - 1];
      const joinOffset = prevBlock.raw.length;
      prevBlock.raw = prevBlock.raw
        ? (block.raw ? `${prevBlock.raw} ${block.raw}` : prevBlock.raw)
        : block.raw;
      state.blocks.splice(blockIdx, 1);
      recomputeBlockLineNumbers();
      recordHistorySnapshot('Merged blocks');
      enterBlockEditMode(prevBlock.id, undefined, undefined, joinOffset);
      scheduleDebouncedSync('user', 'Merged blocks');
      return;
    }
  }
  if (e.key === 'ArrowUp' && blockIdx > 0 && textareaEl.selectionStart === 0) {
    e.preventDefault();
    const prevBlock = state.blocks[blockIdx - 1];
    enterBlockEditMode(prevBlock.id, undefined, undefined, prevBlock.raw.length);
    return;
  }
  if (e.key === 'ArrowDown' && blockIdx < state.blocks.length - 1 && textareaEl.selectionStart >= block.raw.length) {
    e.preventDefault();
    const nextBlock = state.blocks[blockIdx + 1];
    enterBlockEditMode(nextBlock.id, undefined, undefined, 0);
  }
}

// ---------------------------------------------------------------------------
// Inline Block Diff & 3-Angle Variant Tournament Cards
// ---------------------------------------------------------------------------

function createInlineDiffCard(block, diffObj) {
  const card = document.createElement('div');
  card.className = 'block-diff-card';
  const diffHtml = computeWordDiffHtml(diffObj.oldRaw, diffObj.newRaw);
  card.innerHTML = `
    <div class="diff-card-header">
      <span class="diff-source-badge">${escapeHtml(diffObj.source || '✨ AI Proposal')}</span>
      <div class="diff-actions">
        <button class="btn-success" type="button" data-action="accept">${escapeHtml(diffObj.acceptLabel || '✓ Accept Change')}</button>
        <button class="btn-secondary" type="button" data-action="reject">${escapeHtml(diffObj.rejectLabel || '✕ Reject')}</button>
      </div>
    </div>
    <div class="diff-prose-body">${diffHtml}</div>
  `;

  card.querySelector('[data-action="accept"]').addEventListener('click', (e) => {
    e.stopPropagation();
    recordHistorySnapshot(`Before accepting edit on ${block.id}`);

    const prevTransientByRaw = new Map();
    for (const b of state.blocks) {
      if (b.id !== block.id && (b.busy || b.diff || b.tournament)) {
        prevTransientByRaw.set(b.raw, {
          busy: b.busy,
          busyLabel: b.busyLabel,
          diff: b.diff,
          tournament: b.tournament,
        });
      }
    }

    if (diffObj.isDeletion) {
      state.blocks = state.blocks.filter((b) => b.id !== block.id);
    } else if (diffObj.isInsertion) {
      block.diff = null;
    } else {
      block.raw = diffObj.newRaw;
      if (Array.isArray(diffObj.newReviews)) {
        block.reviews = diffObj.newReviews;
      }
      block.diff = null;
    }
    const updatedMd = serializeBlocksToMarkdown(state.blocks);
    state.blocks = parseDocumentIntoBlocks(updatedMd);
    for (const b of state.blocks) {
      const t = prevTransientByRaw.get(b.raw);
      if (t) {
        b.busy = t.busy;
        b.busyLabel = t.busyLabel;
        b.diff = t.diff;
        b.tournament = t.tournament;
        prevTransientByRaw.delete(b.raw);
      }
    }
    recomputeBlockLineNumbers();
    recordHistorySnapshot(`Accepted edit on ${block.id}`);
    updateHeaderTelemetry();
    renderCanvas();
    syncDocumentToDisk('fix', `Accepted edit on ${block.id}`);
  });

  card.querySelector('[data-action="reject"]').addEventListener('click', (e) => {
    e.stopPropagation();
    recordHistorySnapshot(`Before rejecting edit on ${block.id}`);
    if (diffObj.isInsertion) {
      state.blocks = state.blocks.filter((b) => b.id !== block.id);
    } else {
      if (Array.isArray(diffObj.oldReviews)) {
        block.reviews = diffObj.oldReviews;
      }
      block.diff = null;
    }
    recomputeBlockLineNumbers();
    recordHistorySnapshot(`Rejected edit on ${block.id}`);
    updateHeaderTelemetry();
    renderCanvas();
    if (diffObj.fromDisk !== false) {
      syncDocumentToDisk('user', `Rejected edit on ${block.id}`);
    } else {
      setSyncStatus(state.filePath ? 'synced' : 'idle', 'Rejected AI proposal');
    }
  });

  return card;
}

function createTournamentCard(block) {
  const tourney = block.tournament;
  const card = document.createElement('div');
  card.className = 'block-tournament-card';

  const modelBadge = tourney.model ? ` (${tourney.model})` : '';
  const header = document.createElement('div');
  header.className = 'tourney-card-header';
  header.innerHTML = `
    <span class="diff-source-badge">✨ 3-Angle Variant Tournament${escapeHtml(modelBadge)} · Click sentences to cherry-pick</span>
    <div class="diff-actions">
      <button class="btn-secondary" type="button" data-action="regenerate-tourney" title="Generate a fresh set of 3 AI rewrite angles">↻ Regenerate</button>
      <button class="btn-success" type="button" data-action="accept-composite">Accept</button>
      <button class="btn-secondary" type="button" data-action="cancel-tourney">Cancel</button>
    </div>
  `;
  card.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'tourney-angles-grid';

  for (const angle of tourney.angles) {
    const col = document.createElement('div');
    col.className = 'tourney-angle-col';

    const colHead = document.createElement('div');
    colHead.className = 'tourney-angle-head';
    colHead.innerHTML = `
      <span>${escapeHtml(angle.label)}</span>
      <button class="btn-secondary" type="button" style="padding: 2px 6px; font-size: 10px;">Use All</button>
    `;
    colHead.querySelector('button').addEventListener('click', (e) => {
      e.stopPropagation();
      tourney.selectedSentences = [...angle.sentences];
      tourney.compositeRaw = angle.raw;
      renderCanvas();
    });
    col.appendChild(colHead);

    if (angle.rationale) {
      const rat = document.createElement('div');
      rat.className = 'tourney-angle-rationale';
      rat.textContent = angle.rationale;
      col.appendChild(rat);
    }

    const sentBox = document.createElement('div');
    sentBox.className = 'tourney-sentences';
    for (const sentence of angle.sentences) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isSelected = tourney.selectedSentences.includes(sentence);
      btn.className = `tourney-sentence${isSelected ? ' selected' : ''}`;
      btn.textContent = sentence;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = tourney.selectedSentences.indexOf(sentence);
        if (idx >= 0) {
          tourney.selectedSentences.splice(idx, 1);
        } else {
          tourney.selectedSentences.push(sentence);
        }
        tourney.compositeRaw = tourney.selectedSentences.join(' ');
        renderCanvas();
      });
      sentBox.appendChild(btn);
    }
    col.appendChild(sentBox);
    grid.appendChild(col);
  }
  card.appendChild(grid);

  const compositeBox = document.createElement('div');
  compositeBox.className = 'tourney-composite-box';
  compositeBox.innerHTML = `
    <span style="font-size: 10.5px; color: var(--text-muted); font-weight: 600;">Composite Preview:</span>
    <textarea class="tourney-composite-input" rows="2"></textarea>
  `;
  const textarea = compositeBox.querySelector('textarea');
  textarea.value = tourney.compositeRaw || '';
  textarea.addEventListener('input', () => {
    tourney.compositeRaw = textarea.value;
  });
  card.appendChild(compositeBox);

  header.querySelector('[data-action="regenerate-tourney"]').addEventListener('click', (e) => {
    e.stopPropagation();
    launchVariantTournamentForBlock(block.id);
  });

  header.querySelector('[data-action="accept-composite"]').addEventListener('click', (e) => {
    e.stopPropagation();
    recordHistorySnapshot(`Before Variant Tournament on ${block.id}`);
    const chosen = (tourney.compositeRaw || '').trim();
    if (chosen) block.raw = chosen;
    block.tournament = null;
    recomputeBlockLineNumbers();
    recordHistorySnapshot(`Accepted Variant Tournament on ${block.id}`);
    renderCanvas();
    syncDocumentToDisk('fix', `Accepted Variant Tournament on ${block.id}`);
  });

  header.querySelector('[data-action="cancel-tourney"]').addEventListener('click', (e) => {
    e.stopPropagation();
    block.tournament = null;
    renderCanvas();
  });

  return card;
}

async function launchVariantTournamentForBlock(blockId) {
  const block = state.blocks.find((b) => b.id === (blockId || state.activeBlockId));
  if (!block || !block.raw || !block.raw.trim()) {
    showError('Click inside a non-empty paragraph or heading block first to run a 3-Angle Variant Tournament.');
    return;
  }
  if (block.busy) return;

  if (!state.aiSettings?.configured) {
    state.pendingTournamentBlockId = block.id;
    toggleSettingsPopover(true, 'general');
    return;
  }

  if (state.activeBlockId === block.id) {
    exitBlockEditMode(block.id);
  }

  closeAllPopovers();
  clearError();

  const modelLabel = state.aiSettings?.model || 'gemini-3.8-flash';
  const thinkingLabel = (state.aiSettings?.thinkingLevel || 'LOW').toUpperCase();
  block.tournament = null;
  block.busy = true;
  block.busyLabel = `Generating 3 AI rewrite angles with ${modelLabel} (Thinking: ${thinkingLabel})…`;
  setSyncStatus('agent', `${modelLabel} (${thinkingLabel}) generating 3 angles…`);
  renderCanvas();

  const el = document.querySelector(`.doc-block[data-block-id="${block.id}"]`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const idx = state.blocks.findIndex((b) => b.id === block.id);
  const prevRaw = idx > 0 ? state.blocks[idx - 1].raw : '';
  const nextRaw = idx >= 0 && idx < state.blocks.length - 1 ? state.blocks[idx + 1].raw : '';
  const surroundingContext = [prevRaw, nextRaw].filter(Boolean).join('\n\n');

  try {
    const res = await apiPost('/api/tournament', {
      passage: block.raw,
      blockType: block.type,
      keyword: state.keyword || '',
      surroundingContext,
    });

    block.busy = false;
    block.busyLabel = '';
    block.tournament = {
      model: res.model || modelLabel,
      angles: res.angles,
      selectedSentences: [...(res.angles[0]?.sentences || [])],
      compositeRaw: res.angles[0]?.raw || '',
    };
    setSyncStatus('synced', '3 AI angles ready');
    renderCanvas();

    const updatedEl = document.querySelector(`.doc-block[data-block-id="${block.id}"]`);
    updatedEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    block.busy = false;
    block.busyLabel = '';
    setSyncStatus('idle', 'Tournament Error');
    renderCanvas();
    if (String(err.message || '').includes('AI features are not configured')) {
      state.pendingTournamentBlockId = block.id;
      toggleSettingsPopover(true, 'general');
    }
    showError(`Variant Tournament failed:\n${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Hover & Pinned Suggestion Popover (#lens-popover) with Mandatory Diff Preview
// ---------------------------------------------------------------------------

function buildSpanContextDiffHtml(block, span) {
  const raw = block.raw || '';
  if (span.isWholeBlockReplacement && span.replacement !== null && span.replacement !== undefined) {
    return computeWordDiffHtml(raw, span.replacement);
  }

  // Locate surrounding sentence boundaries around [span.startOffset, span.endOffset]
  let sentStart = span.startOffset;
  while (sentStart > 0 && !/[.!?\n]/.test(raw[sentStart - 1])) {
    sentStart--;
  }
  while (sentStart < span.startOffset && /\s/.test(raw[sentStart])) {
    sentStart++;
  }

  let sentEnd = span.endOffset;
  while (sentEnd < raw.length && !/[.!?\n]/.test(raw[sentEnd])) {
    sentEnd++;
  }
  if (sentEnd < raw.length && /[.!?]/.test(raw[sentEnd])) {
    sentEnd++;
  }

  const beforeCtx = escapeHtml(raw.slice(sentStart, span.startOffset));
  const afterCtx = escapeHtml(raw.slice(span.endOffset, sentEnd));
  const matched = escapeHtml(raw.slice(span.startOffset, span.endOffset) || span.match);

  if (span.replacement !== null && span.replacement !== undefined) {
    const insHtml =
      span.replacement === ''
        ? `<ins class="diff-ins">[cut phrase]</ins>`
        : `<ins class="diff-ins">${escapeHtml(span.replacement)}</ins>`;
    return `${beforeCtx}<del class="diff-del">${matched}</del> ${insHtml}${afterCtx}`;
  }

  return `${beforeCtx}<mark class="flagged-context-mark" data-pillar="${escapeHtml(span.pillar || 'slop')}">${matched}</mark>${afterCtx}`;
}

function bindLensSpanHoverEvents() {
  document.querySelectorAll('mark.lens-span').forEach((mark) => {
    mark.addEventListener('mouseenter', () => {
      if (state.popoverPinned) return;
      if (popoverHideTimer) {
        clearTimeout(popoverHideTimer);
        popoverHideTimer = null;
      }
      const span = state.spans.find((s) => s.id === mark.dataset.spanId);
      if (span) showLensPopover(mark, span, false);
    });
    mark.addEventListener('mouseleave', () => {
      if (state.popoverPinned) return;
      scheduleHideLensPopover();
    });
    mark.addEventListener('click', (e) => {
      if (state.studioMode === 'editor') {
        // In Editor Mode, let click bubble to .block-surface so clicking any text enters block edit mode!
        return;
      }
      e.stopPropagation();
      const span = state.spans.find((s) => s.id === mark.dataset.spanId);
      if (!span) return;
      // In Reviewer Mode, clicking pins #lens-popover with diff preview!
      showLensPopover(mark, span, true);
    });
  });
}

function positionLensPopoverNear(anchorEl) {
  const pop = document.getElementById('lens-popover');
  if (!pop || !anchorEl) return;
  const rect = anchorEl.getBoundingClientRect();
  let top = rect.top - pop.offsetHeight - 8;
  if (top < 8) {
    top = Math.min(window.innerHeight - pop.offsetHeight - 8, rect.bottom + 8);
  }
  const left = Math.min(window.innerWidth - pop.offsetWidth - 12, Math.max(8, rect.left));
  pop.style.top = `${Math.max(8, top)}px`;
  pop.style.left = `${left}px`;
}

function isVocabEligibleRule(ruleId) {
  return /^(Vale\.Spelling|Vale\.Terms|Google\.Spelling|Google\.Acronyms)$/i.test(String(ruleId || '').trim());
}

function showLensPopover(anchorEl, span, pinned = false) {
  const pop = document.getElementById('lens-popover');
  const badge = document.getElementById('popover-pillar-badge');
  const msg = document.getElementById('popover-message');
  const explanationEl = document.getElementById('popover-explanation');
  const diffPreview = document.getElementById('popover-diff-preview');
  const diagBox = document.getElementById('popover-block-diag');
  const actionBar = document.getElementById('popover-action-bar');
  const replaceBtn = document.getElementById('btn-popover-replace');
  const addVocabBtn = document.getElementById('btn-popover-add-vocab');
  const disableRuleBtn = document.getElementById('btn-popover-disable-rule');
  const askAgentBtn = document.getElementById('btn-popover-ask-agent');
  if (!pop || !badge || !msg || !diffPreview || !diagBox || !actionBar || !replaceBtn || !askAgentBtn) return;

  state.activePopoverSpanId = span.id;
  state.popoverPinned = Boolean(pinned);

  setHidden(diagBox, true);
  setHidden(actionBar, false);

  badge.textContent = `${span.pillar.toUpperCase()} · ${span.rule}`;
  msg.textContent = span.message;

  const explanationText = span.explanation || getEditorialRuleExplanation(span.pillar, span.ruleId || span.rule, span.rule);
  if (explanationEl) {
    if (explanationText) {
      explanationEl.textContent = explanationText;
      setHidden(explanationEl, false);
    } else {
      setHidden(explanationEl, true);
    }
  }

  const block = state.blocks.find((b) => b.id === span.blockId);
  if (block) {
    const diffHtml = buildSpanContextDiffHtml(block, span);
    diffPreview.innerHTML = `
      <div class="popover-diff-label">${
        span.replacement !== null && span.replacement !== undefined ? 'Before → After Context Diff Preview' : 'Flagged Context'
      }</div>
      <div class="popover-diff-body">${diffHtml}</div>
    `;
    setHidden(diffPreview, false);
  } else {
    setHidden(diffPreview, true);
  }

  if (span.replacement !== null && span.replacement !== undefined) {
    setHidden(replaceBtn, false);
    const displayRep = span.replacement === '' ? 'Cut phrase' : `→ "${span.replacement}"`;
    replaceBtn.textContent = `✓ Apply Fix (${displayRep})`;
    replaceBtn.onclick = () => {
      applySpanInstantReplacement(span);
      hideLensPopover();
    };
  } else {
    setHidden(replaceBtn, true);
  }

  const ruleId = span.ruleId || span.rule || '';
  const cleanTerm = (span.matchedText || span.match || '').trim();
  if (addVocabBtn) {
    if (isVocabEligibleRule(ruleId) && cleanTerm && cleanTerm.split(/\s+/).length <= 4) {
      setHidden(addVocabBtn, false);
      addVocabBtn.textContent = `+ Add "${cleanTerm}" to Vocab`;
      addVocabBtn.onclick = () => {
        addTermToValeVocab(cleanTerm);
        hideLensPopover();
      };
    } else {
      setHidden(addVocabBtn, true);
    }
  }

  if (disableRuleBtn) {
    if (span.pillar === 'vale' && ruleId && ruleId.includes('.')) {
      setHidden(disableRuleBtn, false);
      disableRuleBtn.textContent = `Mute ${ruleId}`;
      disableRuleBtn.onclick = () => {
        setValeRuleEnabled(ruleId, false);
        hideLensPopover();
      };
    } else {
      setHidden(disableRuleBtn, true);
    }
  }

  if (span.pillar === 'fog' && span.isSentenceSpan) {
    askAgentBtn.textContent = '✨ Split Sentence with AI';
  } else if (cleanTerm && cleanTerm.length <= 24) {
    askAgentBtn.textContent = `✨ Fix "${cleanTerm}" with AI`;
  } else {
    askAgentBtn.textContent = `✨ Fix ${span.rule} with AI`;
  }
  askAgentBtn.onclick = () => {
    hideLensPopover();
    dispatchContextualSpanFixToAgent(span);
  };

  setHidden(pop, false);
  positionLensPopoverNear(anchorEl);
}

function showBlockDiagnosticPopover(anchorEl, block, diag) {
  const pop = document.getElementById('lens-popover');
  const badge = document.getElementById('popover-pillar-badge');
  const msg = document.getElementById('popover-message');
  const explanationEl = document.getElementById('popover-explanation');
  const diffPreview = document.getElementById('popover-diff-preview');
  const diagBox = document.getElementById('popover-block-diag');
  const actionBar = document.getElementById('popover-action-bar');
  if (!pop || !badge || !msg || !diffPreview || !diagBox || !actionBar) return;

  state.popoverPinned = true;
  state.activePopoverSpanId = null;

  badge.textContent = `PARAGRAPH HEALTH · L${block.startLine}–${block.endLine}`;
  msg.textContent = `${diag.wordCount} words · ${diag.sentenceCount} sentence(s) · ${diag.complexWords} complex words`;

  if (explanationEl) setHidden(explanationEl, true);
  setHidden(diffPreview, true);
  setHidden(actionBar, true);
  setHidden(diagBox, false);

  diagBox.innerHTML = `
    <div class="diag-metrics-row">
      <div class="diag-metric-pill"><span>Fog Index</span><strong>${diag.fog}</strong></div>
      <div class="diag-metric-pill"><span>AI Slop</span><strong>${diag.slopCount}</strong></div>
      <div class="diag-metric-pill"><span>Vale Style</span><strong>${diag.valeCount}</strong></div>
      <div class="diag-metric-pill"><span>Long Sent.</span><strong>${diag.fogSpanCount}</strong></div>
    </div>
    <div class="diag-issues-list"></div>
    <div style="display:flex;justify-content:space-between;gap:6px;padding-top:4px;border-top:1px solid var(--border-col);">
      <button class="btn-secondary" type="button" data-action="diag-ask-agent">✨ Fix Paragraph with AI (${diag.spans.length})</button>
      <button class="btn-primary" type="button" data-action="diag-tourney">✨ 3-Angle Rewrite</button>
    </div>
  `;

  const listEl = diagBox.querySelector('.diag-issues-list');
  if (diag.spans.length === 0) {
    listEl.innerHTML = `<div style="font-size:11px;color:var(--col-good);padding:4px 2px;">✓ Clean paragraph — no Slop, Vale, or readability alerts.</div>`;
  } else {
    for (const sp of diag.spans) {
      const item = document.createElement('div');
      item.className = 'diag-issue-card';
      const diffHtml = buildSpanContextDiffHtml(block, sp);
      const hasFix = sp.replacement !== null && sp.replacement !== undefined;
      const isVale = sp.pillar === 'vale';
      const ruleId = sp.ruleId || sp.rule || '';
      const term = (sp.matchedText || sp.match || '').trim();
      const expl = sp.explanation || getEditorialRuleExplanation(sp.pillar, ruleId, sp.rule);

      item.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
          <span class="popover-pillar-tag">${escapeHtml(sp.pillar.toUpperCase())} · ${escapeHtml(sp.rule)}</span>
        </div>
        <div style="font-size:11px;color:var(--fg);font-weight:500;">${escapeHtml(sp.message)}</div>
        ${expl ? `<div style="font-size:10.5px;color:var(--text-secondary);line-height:1.35;">${escapeHtml(expl)}</div>` : ''}
        <div class="popover-diff-body" style="font-size:11.5px;background:var(--surface);padding:5px 7px;border-radius:5px;border:1px solid var(--border-col);">${diffHtml}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">
          ${hasFix ? `<button class="btn-success" type="button" data-action="fix-span">✓ Apply Fix (${escapeHtml(sp.replacement === '' ? 'Cut' : `→ "${sp.replacement}"`)})</button>` : ''}
          ${isVocabEligibleRule(ruleId) && term && term.split(/\s+/).length <= 4 ? `<button class="btn-secondary" type="button" data-action="vocab-span">+ Add "${escapeHtml(term)}" to Vocab</button>` : ''}
          ${isVale && ruleId.includes('.') ? `<button class="btn-secondary" type="button" data-action="mute-span">Mute ${escapeHtml(ruleId)}</button>` : ''}
          <button class="btn-secondary" type="button" data-action="ask-agent-span">✨ Fix with AI</button>
        </div>
      `;

      item.querySelector('[data-action="fix-span"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        applySpanInstantReplacement(sp);
        hideLensPopover();
      });
      item.querySelector('[data-action="vocab-span"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        addTermToValeVocab(term);
        hideLensPopover();
      });
      item.querySelector('[data-action="mute-span"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        setValeRuleEnabled(ruleId, false);
        hideLensPopover();
      });
      item.querySelector('[data-action="ask-agent-span"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        hideLensPopover();
        dispatchContextualSpanFixToAgent(sp);
      });

      listEl.appendChild(item);
    }
  }

  diagBox.querySelector('[data-action="diag-ask-agent"]')?.addEventListener('click', () => {
    hideLensPopover();
    dispatchScopedAgentSkill(
      'readability',
      block,
      `Resolve all ${diag.spans.length} flagged readability, AI slop, and Vale style findings in this paragraph while preserving its technical meaning and voice.`
    );
  });

  diagBox.querySelector('[data-action="diag-tourney"]')?.addEventListener('click', () => {
    hideLensPopover();
    launchVariantTournamentForBlock(block.id);
  });

  setHidden(pop, false);
  positionLensPopoverNear(anchorEl);
}

function scheduleHideLensPopover() {
  if (state.popoverPinned) return;
  if (popoverHideTimer) clearTimeout(popoverHideTimer);
  popoverHideTimer = setTimeout(() => {
    if (!state.popoverPinned) hideLensPopover();
  }, 220);
}

function hideLensPopover() {
  setHidden('lens-popover', true);
  state.activePopoverSpanId = null;
  state.popoverPinned = false;
}

function applySpanInstantReplacement(span) {
  const block = state.blocks.find((b) => b.id === span.blockId);
  if (!block) return;

  recordHistorySnapshot(`Before fix (${span.rule})`);

  if (span.isWholeBlockReplacement) {
    block.raw = span.replacement;
  } else {
    const before = block.raw.slice(0, span.startOffset);
    const after = block.raw.slice(span.endOffset);
    const joined = `${before}${span.replacement}${after}`;
    block.raw =
      block.type === 'paragraph' || block.type === 'heading'
        ? joined.replace(/ {2,}/g, ' ').trim()
        : joined;
  }

  state.spans = state.spans.filter((s) => s.blockId !== span.blockId);
  recomputeBlockLineNumbers();
  recordHistorySnapshot(`Applied fix (${span.rule})`);
  renderCanvas();
  syncDocumentToDisk('fix', `Applied fix (${span.rule})`);
}

// ---------------------------------------------------------------------------
// Second-Plane SEO & GEO Readiness Audit (#panel-seo)
// ---------------------------------------------------------------------------

function renderSeoAndGeoPopover() {
  document.querySelectorAll('.seg-btn[data-doc-type]').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.docType === state.docType);
  });

  const seoRes = state.audit?.seo || null;
  const seoScore = typeof seoRes?.score === 'number' ? Math.round(seoRes.score) : state.metrics?.seo;
  const geoScore = typeof seoRes?.geo_score === 'number' ? Math.round(seoRes.geo_score) : null;

  const seoScoreEl = document.getElementById('seo-score-val');
  if (seoScoreEl) {
    seoScoreEl.textContent = seoScore !== null && seoScore !== undefined ? `${seoScore}%` : '—';
  }
  const geoScoreEl = document.getElementById('geo-score-val');
  if (geoScoreEl) {
    geoScoreEl.textContent = geoScore !== null && geoScore !== undefined ? `${geoScore}%` : '—';
  }

  // Dual-Purpose Metadata Split from Go seo.metadata
  const splitEl = document.getElementById('seo-metadata-split');
  if (splitEl) {
    const meta = seoRes?.metadata || null;
    const summary = String(meta?.summary ?? '').trim();
    const description = String(meta?.description ?? '').trim();
    const sumLen = typeof meta?.summary_length === 'number' ? meta.summary_length : summary.length;
    const descLen = typeof meta?.description_length === 'number' ? meta.description_length : description.length;
    const sumStatus = sumLen >= 80 && sumLen <= 180 ? 'pass' : sumLen > 0 ? 'warn' : 'fail';
    const descStatus = descLen >= 120 && descLen <= 160 ? 'pass' : descLen > 0 ? 'warn' : 'fail';
    const isDuplicate = Boolean(meta?.summary_equals_description);

    splitEl.innerHTML = `
      <div class="seo-meta-card status-${sumStatus}">
        <div class="seo-meta-card-top">
          <span>Human Card <code>summary</code> (80–180 chars)</span>
          <span class="cmd-row-badge">${sumLen} chars</span>
        </div>
        <div class="seo-meta-preview">${
          summary ? escapeHtml(summary) : 'Missing frontmatter summary field.'
        }</div>
      </div>
      <div class="seo-meta-card status-${descStatus}">
        <div class="seo-meta-card-top">
          <span>Search / LLM <code>description</code> (120–160 chars)</span>
          <span class="cmd-row-badge">${descLen} chars</span>
        </div>
        <div class="seo-meta-preview">${
          description ? escapeHtml(description) : 'Missing frontmatter description field.'
        }</div>
      </div>
      ${
        isDuplicate
          ? `<div class="seo-check-item status-warn"><strong>⚠ Duplicate Metadata</strong><span>summary and description should be distinct</span></div>`
          : ''
      }
    `;
  }

  // GEO Checks from Go seo.geo_checks
  const geoStrip = document.getElementById('geo-checks-strip');
  if (geoStrip) {
    geoStrip.innerHTML = '';
    const geoChecks = Array.isArray(seoRes?.geo_checks) ? seoRes.geo_checks : [];
    for (const chk of geoChecks) {
      const rawStatus = (chk.status || 'pass').toLowerCase();
      const statusClass = rawStatus === 'warning' ? 'warn' : rawStatus;
      const icon = rawStatus === 'pass' ? '✓' : rawStatus === 'warning' || rawStatus === 'warn' ? '⚠' : '✕';
      const row = document.createElement('div');
      row.className = `seo-check-item status-${statusClass}`;
      row.innerHTML = `
        <strong>${icon} ${escapeHtml(chk.name)}</strong>
        <span style="color: var(--text-muted); text-align: right;">${escapeHtml(chk.description || '')}</span>
      `;
      geoStrip.appendChild(row);
    }
  }

  // Technical SEO Checks from Go seo.checks
  const seoStrip = document.getElementById('seo-checks-strip');
  if (seoStrip) {
    seoStrip.innerHTML = '';
    const checks = Array.isArray(seoRes?.checks) ? seoRes.checks : [];
    for (const chk of checks) {
      const rawStatus = (chk.status || 'pass').toLowerCase();
      const statusClass = rawStatus === 'warning' ? 'warn' : rawStatus;
      const icon = rawStatus === 'pass' ? '✓' : rawStatus === 'warning' || rawStatus === 'warn' ? '⚠' : '✕';
      const row = document.createElement('div');
      row.className = `seo-check-item status-${statusClass}`;
      row.innerHTML = `
        <strong>${icon} ${escapeHtml(chk.name)}</strong>
        <span style="color: var(--text-muted); text-align: right;">${escapeHtml(chk.description || '')}</span>
      `;
      seoStrip.appendChild(row);
    }
  }
}

// ---------------------------------------------------------------------------
// 3-Tab Settings Modal (#panel-settings: AI & General | Vale Rules | Vocabulary)
// ---------------------------------------------------------------------------

function switchSettingsTab(tabName) {
  const next = ['general', 'vale', 'vocab'].includes(tabName) ? tabName : 'general';
  state.settingsActiveTab = next;

  document.querySelectorAll('.settings-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.settingsTab === next);
  });

  setHidden('settings-tab-general', next !== 'general');
  setHidden('settings-tab-vale', next !== 'vale');
  setHidden('settings-tab-vocab', next !== 'vocab');

  if (next === 'vale' || next === 'vocab') {
    loadValeRulesAndVocab();
  }
}

async function loadValeRulesAndVocab() {
  try {
    const res = await apiPost('/api/vale/rules', {
      action: 'list',
      path: state.filePath || '',
      workspacePath: state.workspacePath || '',
    });
    state.valeRulesData.configPath = res.config_path || '';
    state.valeRulesData.rules = Array.isArray(res.rules) ? res.rules : [];
    state.valeRulesData.vocabTerms = Array.isArray(res.vocab_terms) ? res.vocab_terms : [];
    renderValeRulesTab();
    renderVocabTab();
  } catch (err) {
    showError(`Failed to load Vale rules & vocabulary: ${err.message}`);
  }
}

async function setValeRuleEnabled(ruleId, enabled) {
  try {
    clearError();
    const res = await apiPost('/api/vale/rules', {
      action: 'set_rule',
      path: state.filePath || '',
      workspacePath: state.workspacePath || '',
      rule_id: ruleId,
      enabled: Boolean(enabled),
    });
    if (Array.isArray(res.rules)) {
      state.valeRulesData.rules = res.rules;
    } else {
      const existing = state.valeRulesData.rules.find((r) => r.id === ruleId);
      if (existing) existing.enabled = Boolean(enabled);
    }
    renderValeRulesTab();
    await syncDocumentToDisk('user', `${enabled ? 'Enabled' : 'Muted'} Vale rule ${ruleId}`);
  } catch (err) {
    showError(`Failed to update Vale rule "${ruleId}": ${err.message}`);
  }
}

async function addTermToValeVocab(term) {
  const clean = (term || '').trim();
  if (!clean) return;
  try {
    clearError();
    const res = await apiPost('/api/vale/rules', {
      action: 'add_vocab',
      path: state.filePath || '',
      workspacePath: state.workspacePath || '',
      term: clean,
      case_insensitive: true,
    });
    if (Array.isArray(res.vocab_terms)) {
      state.valeRulesData.vocabTerms = res.vocab_terms;
    } else if (!state.valeRulesData.vocabTerms.includes(clean)) {
      state.valeRulesData.vocabTerms.push(clean);
    }
    renderVocabTab();
    await syncDocumentToDisk('user', `Added "${clean}" to vocabulary`);
  } catch (err) {
    showError(`Failed to add "${clean}" to vocabulary: ${err.message}`);
  }
}

async function removeTermFromValeVocab(term) {
  const clean = (term || '').trim();
  if (!clean) return;
  try {
    clearError();
    const res = await apiPost('/api/vale/rules', {
      action: 'remove_vocab',
      path: state.filePath || '',
      workspacePath: state.workspacePath || '',
      term: clean,
    });
    if (Array.isArray(res.vocab_terms)) {
      state.valeRulesData.vocabTerms = res.vocab_terms;
    } else {
      state.valeRulesData.vocabTerms = state.valeRulesData.vocabTerms.filter((t) => t !== clean);
    }
    renderVocabTab();
    await syncDocumentToDisk('user', `Removed "${clean}" from vocabulary`);
  } catch (err) {
    showError(`Failed to remove "${clean}" from vocabulary: ${err.message}`);
  }
}

function renderValeRulesTab() {
  const listEl = document.getElementById('vale-rules-list');
  const pathBadge = document.getElementById('vale-config-path-badge');
  const filterBtn = document.getElementById('vale-filter-active-btn');
  if (!listEl) return;

  if (pathBadge) {
    pathBadge.textContent = state.valeRulesData.configPath ? `Config: ${state.valeRulesData.configPath}` : '';
  }
  if (filterBtn) {
    filterBtn.classList.toggle('active', state.valeRulesData.onlyActiveInDoc);
  }

  const activeDocRuleCounts = new Map();
  for (const sp of state.spans) {
    if (sp.pillar === 'vale') {
      const id = sp.ruleId || sp.rule;
      activeDocRuleCounts.set(id, (activeDocRuleCounts.get(id) || 0) + 1);
    }
  }

  let rules = [...state.valeRulesData.rules];
  // Ensure any rule currently firing in the doc is listed even if not pre-enumerated
  for (const [docRuleId, count] of activeDocRuleCounts.entries()) {
    if (!rules.some((r) => r.id === docRuleId)) {
      rules.unshift({ id: docRuleId, enabled: true, activeCount: count });
    }
  }

  const q = (state.valeRulesData.filterQuery || '').trim().toLowerCase();
  const filtered = rules.filter((r) => {
    const id = String(r.id || '');
    const desc = String(r.description || '');
    const count = activeDocRuleCounts.get(id) || r.activeCount || 0;
    if (state.valeRulesData.onlyActiveInDoc && count === 0) return false;
    if (q && !id.toLowerCase().includes(q) && !desc.toLowerCase().includes(q)) return false;
    return true;
  });

  listEl.innerHTML = '';
  if (filtered.length === 0) {
    listEl.innerHTML = `<div style="font-size:11px;color:var(--text-muted);padding:8px 4px;">No matching Vale rules found.</div>`;
    return;
  }

  for (const r of filtered) {
    const ruleId = String(r.id || '');
    const enabled = r.enabled !== false && String(r.level || '').toUpperCase() !== 'NO';
    const docHits = activeDocRuleCounts.get(ruleId) || 0;

    const row = document.createElement('div');
    row.className = 'vale-rule-row';
    row.innerHTML = `
      <div class="vale-rule-info">
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="vale-rule-id">${escapeHtml(ruleId)}</span>
          ${docHits > 0 ? `<span class="cmd-row-badge" style="color:var(--col-vale);">${docHits} in doc</span>` : ''}
        </div>
        ${r.description ? `<span class="vale-rule-desc">${escapeHtml(r.description)}</span>` : ''}
      </div>
      <div class="segmented-control" role="group">
        <button class="seg-btn ${enabled ? 'active' : ''}" type="button" data-enable="true">On</button>
        <button class="seg-btn ${!enabled ? 'active' : ''}" type="button" data-enable="false">Off</button>
      </div>
    `;

    row.querySelector('[data-enable="true"]')?.addEventListener('click', () => {
      if (!enabled) setValeRuleEnabled(ruleId, true);
    });
    row.querySelector('[data-enable="false"]')?.addEventListener('click', () => {
      if (enabled) setValeRuleEnabled(ruleId, false);
    });

    listEl.appendChild(row);
  }
}

function renderVocabTab() {
  const listEl = document.getElementById('vocab-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  const terms = state.valeRulesData.vocabTerms || [];
  if (terms.length === 0) {
    listEl.innerHTML = `<div style="font-size:11px;color:var(--text-muted);padding:6px 2px;">No custom vocabulary terms in accept.txt yet.</div>`;
    return;
  }

  for (const term of terms) {
    const pill = document.createElement('span');
    pill.className = 'vocab-term-pill';
    pill.innerHTML = `
      <span>${escapeHtml(term)}</span>
      <button class="vocab-remove-btn" type="button" title="Remove ${escapeHtml(term)}">×</button>
    `;
    pill.querySelector('button').addEventListener('click', () => {
      removeTermFromValeVocab(term);
    });
    listEl.appendChild(pill);
  }
}

// ---------------------------------------------------------------------------
// Toolbar Badges & Popovers (SEO & GEO, Ask Agent, Settings)
// ---------------------------------------------------------------------------

function updateHeaderTelemetry() {
  const m = state.metrics || {};
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val !== null && val !== undefined ? String(val) : '—';
  };

  setVal('metric-slop', m.slop);
  setVal('metric-vale', m.vale);
  setVal('metric-fog', m.fog);
  setVal('metric-seo', m.seo !== null && m.seo !== undefined ? `${m.seo}%` : '—');
  setVal('metric-heatmap', state.activeLenses.has('heatmap') ? 'ON' : 'OFF');

  const wordBadge = document.getElementById('word-count-badge');
  if (wordBadge) wordBadge.textContent = `${m.words || 0} words`;

  const fileBadge = document.getElementById('active-file-badge');
  if (fileBadge) {
    fileBadge.textContent = state.filePath ? pathBasename(state.filePath) : 'Unsaved draft';
  }

  // Resolve Comments with AI (N) button — visible in ANY mode when totalReviews > 0 or during confirmation flash
  const totalReviews = getTotalReviewComments();
  const revBtn = document.getElementById('btn-send-review-agent');
  const revLabel = document.getElementById('review-count-label');
  const flash = state.reviewDispatchConfirmation;
  if (flash && flash.count > 0) {
    if (revLabel) {
      revLabel.textContent = `✓ AI Resolving ${flash.count} Comment${flash.count === 1 ? '' : 's'}…`;
    }
    if (revBtn) {
      revBtn.disabled = true;
      revBtn.classList.add('is-dispatched');
    }
    setHidden('btn-send-review-agent', false);
  } else {
    if (revLabel) {
      revLabel.textContent = `Resolve Comments with AI (${totalReviews})`;
    }
    if (revBtn) {
      revBtn.disabled = totalReviews === 0;
      revBtn.classList.remove('is-dispatched');
    }
    setHidden('btn-send-review-agent', totalReviews === 0);
  }

  document.querySelectorAll('.lens-chip').forEach((btn) => {
    const lens = btn.dataset.lens;
    if (lens === 'seo') {
      btn.classList.toggle('active', state.seoPopoverOpen);
    } else {
      btn.classList.toggle('active', state.activeLenses.has(lens));
    }
  });

  renderSeoAndGeoPopover();
  updateUndoRedoButtons();
}

function closeAllPopovers() {
  state.cmdOpen = false;
  state.seoPopoverOpen = false;
  state.settingsPopoverOpen = false;
  setHidden('cmd-palette', true);
  setHidden('panel-seo', true);
  setHidden('panel-settings', true);
  document.getElementById('btn-ask-agent-top')?.classList.remove('active');
  document.getElementById('btn-seo-geo')?.classList.remove('active');
  document.getElementById('btn-settings')?.classList.remove('active');
}

function toggleSeoPopover() {
  const next = !state.seoPopoverOpen;
  closeAllPopovers();
  state.seoPopoverOpen = next;
  setHidden('panel-seo', !next);
  document.getElementById('btn-seo-geo')?.classList.toggle('active', next);
  if (next) {
    renderSeoAndGeoPopover();
  }
}

function toggleSettingsPopover(forceOpen = undefined, initialTab = undefined) {
  const next = typeof forceOpen === 'boolean' ? forceOpen : !state.settingsPopoverOpen;
  closeAllPopovers();
  state.settingsPopoverOpen = next;
  setHidden('panel-settings', !next);
  document.getElementById('btn-settings')?.classList.toggle('active', next);
  if (next) {
    if (initialTab) {
      switchSettingsTab(initialTab);
    } else {
      switchSettingsTab(state.settingsActiveTab || 'general');
    }
    renderSettingsPopover();
  }
}

function renderSettingsPopover() {
  const s = state.aiSettings || {};
  const badge = document.getElementById('settings-status-badge');
  if (badge) {
    badge.textContent = s.configured ? '✓ AI Enabled' : 'Not Configured';
    badge.style.color = s.configured ? 'var(--col-good)' : 'var(--col-warn)';
  }

  document.querySelectorAll('.settings-auth-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.authMode === s.authMode);
  });

  setHidden('settings-vertex-section', s.authMode !== 'vertex');
  setHidden('settings-apikey-section', s.authMode !== 'apikey');

  const projInput = document.getElementById('settings-project-input');
  if (projInput && document.activeElement !== projInput) {
    projInput.value = s.project || '';
  }

  const locInput = document.getElementById('settings-location-input');
  if (locInput && document.activeElement !== locInput) {
    locInput.value = s.location || 'global';
  }

  const adcStatus = document.getElementById('settings-adc-status');
  if (adcStatus) {
    if (s.adcAvailable) {
      adcStatus.textContent = `✓ ADC detected (${s.adcPath || '~/.config/gcloud/application_default_credentials.json'})`;
      adcStatus.style.color = 'var(--col-good)';
    } else {
      adcStatus.textContent = '⚠ ADC file not found. Run "gcloud auth application-default login" or switch to Gemini API Key.';
      adcStatus.style.color = 'var(--col-warn)';
    }
  }

  const maskEl = document.getElementById('settings-apikey-mask');
  if (maskEl) {
    maskEl.textContent = s.hasApiKey ? `Saved (${s.apiKeyMask})` : '';
  }

  const keyInput = document.getElementById('settings-apikey-input');
  if (keyInput) {
    keyInput.placeholder = s.hasApiKey
      ? `Saved (${s.apiKeyMask}) — enter new key to replace…`
      : 'Enter GEMINI_API_KEY…';
  }
  setHidden('btn-clear-apikey', !s.hasApiKey);

  const modelInput = document.getElementById('settings-model-input');
  if (modelInput && document.activeElement !== modelInput) {
    modelInput.value = s.model || 'gemini-3.8-flash';
  }

  const activeThinking = (s.thinkingLevel || 'LOW').toUpperCase();
  document.querySelectorAll('.settings-thinking-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.thinkingLevel === activeThinking);
  });
}

async function loadStudioAiSettings() {
  try {
    const res = await apiPost('/api/settings/get', {});
    state.aiSettings = {
      ...state.aiSettings,
      ...res,
    };
    renderSettingsPopover();
  } catch (err) {
    showError(`Failed to load AI settings: ${err.message}`);
  }
}

async function saveStudioAiSettings(clearApiKey = false) {
  const authMode = state.aiSettings.authMode === 'apikey' ? 'apikey' : 'vertex';
  const project = (document.getElementById('settings-project-input')?.value || '').trim();
  const location = (document.getElementById('settings-location-input')?.value || '').trim() || 'global';
  const model = (document.getElementById('settings-model-input')?.value || '').trim() || 'gemini-3.8-flash';
  const thinkingLevel = (state.aiSettings.thinkingLevel || 'LOW').toUpperCase();
  const apiKeyInput = document.getElementById('settings-apikey-input');
  const apiKey = (apiKeyInput?.value || '').trim();

  try {
    clearError();
    const res = await apiPost('/api/settings', {
      authMode,
      project,
      location,
      model,
      thinkingLevel,
      apiKey,
      clearApiKey,
    });
    if (apiKeyInput) apiKeyInput.value = '';
    state.aiSettings = {
      ...state.aiSettings,
      ...res,
    };
    renderSettingsPopover();
    setSyncStatus('synced', res.configured ? 'Settings Saved' : 'Settings Updated');

    if (!clearApiKey && res.configured) {
      closeAllPopovers();
      if (state.pendingTournamentBlockId) {
        const pendingId = state.pendingTournamentBlockId;
        state.pendingTournamentBlockId = null;
        launchVariantTournamentForBlock(pendingId);
      }
    }
  } catch (err) {
    showError(err.message);
  }
}

// ---------------------------------------------------------------------------
// Ask Agent Popover (#cmd-palette — Free-Style Prompt + Rich Paragraph Context)
// ---------------------------------------------------------------------------

function buildParagraphContextTelemetryMarkdown(block) {
  if (!block) {
    const docFog = state.metrics?.fog ?? '—';
    const docSlop = state.metrics?.slop ?? '—';
    const docVale = state.metrics?.vale ?? 0;
    const docSeo = state.metrics?.seo ?? '—';
    const docGeo = state.audit?.seo?.geo_score ?? '—';
    const lines = [
      `### Document Telemetry Summary:`,
      `- **Words**: ${state.metrics?.words ?? 0} | **Fog Index**: ${docFog} | **Slop Score**: ${docSlop} | **Vale Alerts**: ${docVale} | **SEO Score**: ${docSeo} | **GEO Score**: ${docGeo}`,
      `- **Target Keyword**: ${state.keyword || '(none)'} | **Audit Profile**: ${state.docType || 'auto'}`,
    ];
    const seoChecks = [
      ...(Array.isArray(state.audit?.seo?.checks) ? state.audit.seo.checks : []),
      ...(Array.isArray(state.audit?.seo?.geo_checks) ? state.audit.seo.geo_checks : []),
    ].filter((c) => c.status && c.status.toLowerCase() !== 'pass');
    if (seoChecks.length > 0) {
      lines.push(`- **Non-Passing SEO/GEO Checks (${seoChecks.length})**:`);
      for (const chk of seoChecks) {
        lines.push(`  - **[${String(chk.status).toUpperCase()}] ${chk.name}**: ${chk.description || ''}`);
      }
    }
    return lines.join('\n');
  }

  const diag = computeBlockDiagnostics(block);
  const fogParagraphs = Array.isArray(state.audit?.fog?.paragraphs) ? state.audit.fog.paragraphs : [];
  const serverFogPara = fogParagraphs.find(
    (p) => typeof p.start_line === 'number' && p.start_line <= block.endLine && p.end_line >= block.startLine
  );
  const slopParagraphs = Array.isArray(state.audit?.slop?.paragraphs) ? state.audit.slop.paragraphs : [];
  const serverSlopPara = slopParagraphs.find(
    (p) => typeof p.start_line === 'number' && p.start_line <= block.endLine && p.end_line >= block.startLine
  );
  const blockHealthList = Array.isArray(state.audit?.blocks) ? state.audit.blocks : [];
  const serverHealth = blockHealthList.find(
    (b) => typeof b.start_line === 'number' && b.start_line <= block.endLine && b.end_line >= block.startLine
  );

  const fogVal = diag?.fog ?? serverFogPara?.fog_index ?? '—';
  const wordCount = diag?.wordCount ?? serverFogPara?.total_words ?? countWordsInText(block.raw);
  const sentCount = diag?.sentenceCount ?? serverFogPara?.total_sentences ?? 1;
  const complexCount =
    diag?.complexWords ??
    (typeof serverFogPara?.complex_words === 'number'
      ? serverFogPara.complex_words
      : Array.isArray(serverFogPara?.complex_words)
      ? serverFogPara.complex_words.length
      : 0);
  const asl =
    typeof serverFogPara?.average_sentence_length === 'number'
      ? serverFogPara.average_sentence_length.toFixed(1)
      : (wordCount / Math.max(1, sentCount)).toFixed(1);
  const complexPct =
    typeof serverFogPara?.percentage_complex_words === 'number'
      ? `${serverFogPara.percentage_complex_words.toFixed(1)}%`
      : `${((complexCount / Math.max(1, wordCount)) * 100).toFixed(1)}%`;
  const slopScore =
    typeof serverSlopPara?.slop_score === 'number'
      ? Math.round(serverSlopPara.slop_score)
      : (typeof serverHealth?.slop_score === 'number' ? Math.round(serverHealth.slop_score) : (diag?.slopCount ?? 0));
  const healthScore =
    typeof serverHealth?.health_score === 'number' ? `${Math.round(serverHealth.health_score)}/100` : (diag?.health || 'clean');

  const lines = [
    `### Paragraph Metrics & Findings (Lines ${block.startLine}–${block.endLine} · \`${block.type}\`):`,
    `- **Health**: ${healthScore} | **Gunning Fog Index**: ${fogVal} (${serverFogPara?.classification || 'target 11–15'})`,
    `- **Length & Cadence**: ${wordCount} words, ${sentCount} sentence(s), ASL ${asl} words/sentence, ${complexCount} complex words (${complexPct})`,
    `- **Slop & Style Telemetry**: Paragraph Slop Score ${slopScore}, Slop Spans: ${diag?.slopCount ?? 0}, Vale Alerts: ${diag?.valeCount ?? 0}, Long Sentences: ${diag?.fogSpanCount ?? 0}`,
  ];

  const complexWordsList = Array.isArray(serverFogPara?.complex_words)
    ? serverFogPara.complex_words
    : extractWordsFromText(block.raw).filter((w) => countWordSyllables(w) >= 3);
  if (complexWordsList.length > 0) {
    lines.push(`- **Complex Words (3+ syllables)**: ${[...new Set(complexWordsList)].map((w) => `\`${w}\``).join(', ')}`);
  }

  const blockSpans = state.spans.filter((s) => s.blockId === block.id);
  if (blockSpans.length === 0) {
    lines.push(`- **Active Findings**: None (0 Slop, Vale, or Fog alerts in this paragraph).`);
  } else {
    lines.push(`- **Active Findings in Paragraph (${blockSpans.length})**:`);
    blockSpans.forEach((sp, idx) => {
      const repNote =
        sp.replacement !== null && sp.replacement !== undefined
          ? ` → Suggested replacement: \`${sp.replacement === '' ? '[cut]' : sp.replacement}\``
          : '';
      const expl = sp.explanation || getEditorialRuleExplanation(sp.pillar, sp.ruleId || sp.rule, sp.rule);
      lines.push(
        `  ${idx + 1}. **[${sp.pillar.toUpperCase()} · ${sp.rule}]** on \`"${sp.match}"\`: ${sp.message}${repNote}${
          expl ? ` *(Why: ${expl})*` : ''
        }`
      );
    });
  }

  return lines.join('\n');
}

function renderCommandPaletteContextPreview(block, selectedText = '') {
  const previewEl = document.getElementById('cmd-context-preview');
  if (!previewEl) return;

  if (!block) {
    setHidden(previewEl, false);
    previewEl.innerHTML = `
      <div class="cmd-context-preview-head">
        <span>Attached Context · Full Document</span>
        <span>${state.metrics?.words ?? 0}w · Fog ${state.metrics?.fog ?? '—'} · Slop ${state.metrics?.slop ?? '—'} · Vale ${state.metrics?.vale ?? 0}</span>
      </div>
      <div>Document-wide metrics and active findings will be included with your instruction.</div>
    `;
    return;
  }

  const diag = computeBlockDiagnostics(block);
  const blockSpans = state.spans.filter((s) => s.blockId === block.id);
  const findingsHtml =
    blockSpans.length === 0
      ? `<div style="color:var(--col-good);">✓ No active Slop, Vale, or Fog findings in this paragraph.</div>`
      : `<ul class="cmd-context-findings">${blockSpans
          .slice(0, 6)
          .map(
            (sp) =>
              `<li><strong>${escapeHtml(sp.pillar.toUpperCase())} · ${escapeHtml(sp.rule)}</strong> (<code>${escapeHtml(
                sp.match.length > 32 ? `${sp.match.slice(0, 32)}…` : sp.match
              )}</code>): ${escapeHtml(sp.message)}</li>`
          )
          .join('')}${
          blockSpans.length > 6 ? `<li>…and ${blockSpans.length - 6} more finding(s) attached</li>` : ''
        }</ul>`;

  setHidden(previewEl, false);
  previewEl.innerHTML = `
    <div class="cmd-context-preview-head">
      <span>Attached Paragraph Context · L${block.startLine}–${block.endLine}</span>
      <span>Fog ${diag?.fog ?? '—'} · Slop ${diag?.slopCount ?? 0} · Vale ${diag?.valeCount ?? 0} · ${diag?.wordCount ?? countWordsInText(block.raw)}w</span>
    </div>
    ${
      selectedText
        ? `<div style="font-family:var(--font-mono);font-size:10px;color:var(--accent);">Focused selection: "${escapeHtml(
            selectedText.length > 60 ? `${selectedText.slice(0, 60)}…` : selectedText
          )}"</div>`
        : ''
    }
    ${findingsHtml}
  `;
}

function openCommandPaletteForBlock(blockId = null, selectedText = '', initialPrompt = '') {
  const input = document.getElementById('cmd-input');
  const scopeBadge = document.getElementById('cmd-scope-badge');
  if (!input) return;

  const targetBlock = state.blocks.find((b) => b.id === (blockId || state.activeBlockId)) || null;
  closeAllPopovers();
  state.cmdOpen = true;
  state.cmdBlockId = targetBlock ? targetBlock.id : null;
  state.cmdSelectedText = selectedText || '';
  document.getElementById('btn-ask-agent-top')?.classList.add('active');

  if (scopeBadge) {
    if (state.cmdSelectedText) {
      scopeBadge.textContent = `Selection (${countWordsInText(state.cmdSelectedText)}w) · L${targetBlock?.startLine ?? 1}–${targetBlock?.endLine ?? 1}`;
    } else if (targetBlock) {
      scopeBadge.textContent = `${targetBlock.type} · L${targetBlock.startLine}–${targetBlock.endLine}`;
    } else {
      scopeBadge.textContent = `Full Doc (${state.metrics.words}w)`;
    }
  }

  renderCommandPaletteContextPreview(targetBlock, state.cmdSelectedText);
  setHidden('cmd-palette', false);
  input.value = initialPrompt || '';
  setTimeout(() => input.focus(), 10);
}

// ---------------------------------------------------------------------------
// Centralized In-Panel AI Rewrites, Main Chat Awareness & Live Disk Sync
// ---------------------------------------------------------------------------

function dispatchContextualSpanFixToAgent(span) {
  if (!span) return;
  const block = state.blocks.find((b) => b.id === span.blockId) || null;
  const explanation = span.explanation || getEditorialRuleExplanation(span.pillar, span.ruleId || span.rule, span.rule);
  const repHint =
    span.replacement !== null && span.replacement !== undefined
      ? ` (suggested deterministic replacement: "${span.replacement === '' ? '[cut phrase]' : span.replacement}")`
      : '';

  const instruction = [
    `Fix the hovered **[${span.pillar.toUpperCase()} · ${span.rule}]** finding on \`"${span.match}"\` in this paragraph.`,
    `- **Finding Alert**: ${span.message}${repHint}`,
    explanation ? `- **Rule Explanation**: ${explanation}` : '',
    `Rewrite only the affected sentence/clause within Lines ${block ? `${block.startLine}–${block.endLine}` : '1'} so it resolves this finding naturally while preserving technical accuracy and surrounding context.`,
  ]
    .filter(Boolean)
    .join('\n');

  dispatchScopedAgentSkill('readability', block, instruction);
}

async function dispatchScopedAgentSkill(skillName, block, instruction) {
  if (!state.aiSettings?.configured) {
    toggleSettingsPopover(true, 'general');
    showError(
      'Configure Vertex AI Project ID or Gemini API Key in Settings (⚙️) to run AI rewrites.'
    );
    return;
  }

  if (state.activeBlockId) {
    exitBlockEditMode(state.activeBlockId);
  }

  clearError();
  const modelLabel = state.aiSettings?.model || 'gemini-3.8-flash';
  const selectedFocus = state.cmdSelectedText
    ? `\n\nFocused selection inside paragraph:\n"${state.cmdSelectedText}"`
    : '';
  state.cmdSelectedText = '';

  const effectiveInstruction = `${instruction}${selectedFocus}`.trim();
  const telemetryContext = buildParagraphContextTelemetryMarkdown(block);
  const fullDocument = serializeBlocksToMarkdown(state.blocks);

  if (block) {
    block.busy = true;
    block.busyLabel = `AI (${modelLabel}) rewriting paragraph…`;
    setSyncStatus('agent', `${modelLabel} rewriting L${block.startLine}–${block.endLine}…`);
    renderCanvas();

    try {
      const res = await apiPost('/api/ai/rewrite', {
        fullDocument,
        skill: skillName || 'draft',
        instruction: effectiveInstruction,
        telemetryContext,
        targetBlocks: [
          {
            id: block.id,
            startLine: block.startLine,
            endLine: block.endLine,
            type: block.type,
            raw: block.raw,
            reviews: block.reviews || [],
          },
        ],
      });

      block.busy = false;
      block.busyLabel = '';
      const proposals = Array.isArray(res.proposals) ? res.proposals : [];
      const prop = proposals.find((p) => p.id === block.id) || proposals[0];
      if (!prop || typeof prop.newRaw !== 'string') {
        throw new Error('AI rewrite response did not contain a proposal for the target block.');
      }

      block.diff = {
        oldRaw: block.raw,
        newRaw: prop.newRaw,
        newReviews: block.reviews || [],
        oldReviews: block.reviews || [],
        fromDisk: false,
        source: `✨ AI Proposal (${res.model || modelLabel})${prop.summary ? ` · ${prop.summary}` : ''}`,
        acceptLabel: '✓ Accept Change',
        rejectLabel: '✕ Reject',
      };

      recordHistorySnapshot(`AI staged proposal on ${block.id}`);
      setSyncStatus('agent', 'Review AI proposal');
      updateHeaderTelemetry();
      renderCanvas();
    } catch (err) {
      block.busy = false;
      block.busyLabel = '';
      setSyncStatus('idle', 'AI Rewrite Error');
      renderCanvas();
      showError(`AI rewrite failed:\n${err.message}`);
    }
    return;
  }

  // Full-document AI rewrite (e.g. SEO & GEO Fix with AI or Full-Doc Ask Agent)
  setSyncStatus('agent', `${modelLabel} rewriting document…`);
  for (const b of state.blocks) {
    b.busy = true;
  }
  if (state.blocks[0]) {
    state.blocks[0].busyLabel = `AI (${modelLabel}) updating document…`;
  }
  renderCanvas();

  try {
    const res = await apiPost('/api/ai/rewrite', {
      fullDocument,
      skill: skillName || 'publish',
      instruction: effectiveInstruction,
      telemetryContext,
      targetBlocks: [],
    });

    for (const b of state.blocks) {
      b.busy = false;
      b.busyLabel = '';
    }

    if (typeof res.fullMarkdown !== 'string' || !res.fullMarkdown.trim()) {
      throw new Error('AI full-document rewrite returned empty Markdown.');
    }

    reconcileExternalDiskUpdate(res.fullMarkdown, null, null, {
      fromDisk: false,
      source: `✨ AI Proposal (${res.model || modelLabel})${res.summary ? ` · ${res.summary}` : ''}`,
    });
  } catch (err) {
    for (const b of state.blocks) {
      b.busy = false;
      b.busyLabel = '';
    }
    setSyncStatus('idle', 'AI Rewrite Error');
    renderCanvas();
    showError(`AI document rewrite failed:\n${err.message}`);
  }
}

async function sendContextToMainChat(block, instruction) {
  if (!window.sidecar?.conversationId || !window.sidecar?.agent?.sendMessage) {
    showError(
      'No active Antigravity conversation is connected to this panel. Open Speedgrapher from an active chat session to send context to the main chat.'
    );
    return;
  }

  const fileLabel = state.filePath || 'the active draft in Speedgrapher';
  const selectedFocus = state.cmdSelectedText
    ? `### Highlighted Selection:\n\`\`\`text\n${state.cmdSelectedText}\n\`\`\``
    : '';
  state.cmdSelectedText = '';

  const targetSnippet = block
    ? `### Passage Context (${fileLabel} · Lines ${block.startLine}–${block.endLine}):\n\`\`\`markdown\n${block.raw}\n\`\`\``
    : `### Document Context (${fileLabel}):\n${buildParagraphContextTelemetryMarkdown(null)}`;

  const prompt = [
    `Sharing passage context from Speedgrapher (\`${fileLabel}\`) for our chat conversation:`,
    instruction ? `### User Note / Question:\n${instruction}` : '',
    selectedFocus,
    targetSnippet,
    `*(Shared for main chat awareness and discussion — do NOT edit \`${fileLabel}\` on disk unless explicitly asked in chat.)*`,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    setSyncStatus('agent', 'Sent context to chat');
    await window.sidecar.agent.sendMessage(prompt);
  } catch (err) {
    showError(`Failed to send context to main chat: ${err.message}`);
  }
}

function reconcileExternalDiskUpdate(newDiskMarkdown, _proposedAudit, _proposedMetrics, options = {}) {
  const newDiskBlocks = parseDocumentIntoBlocks(newDiskMarkdown);
  const fromDisk = options.fromDisk !== undefined ? Boolean(options.fromDisk) : true;
  const sourceLabel = options.source || '✨ Proposed Agent Edit';

  for (const b of state.blocks) {
    b.busy = false;
    b.busyLabel = '';
  }

  if (newDiskBlocks.length === state.blocks.length) {
    for (let i = 0; i < state.blocks.length; i++) {
      const cur = state.blocks[i];
      const incoming = newDiskBlocks[i];
      if (incoming.tournament) {
        cur.tournament = incoming.tournament;
      } else if (
        incoming.raw !== cur.raw ||
        JSON.stringify(incoming.reviews || []) !== JSON.stringify(cur.reviews || [])
      ) {
        cur.diff = {
          oldRaw: cur.raw,
          newRaw: incoming.raw,
          newReviews: incoming.reviews || [],
          oldReviews: cur.reviews || [],
          fromDisk,
          source: sourceLabel,
          acceptLabel: '✓ Accept Change',
          rejectLabel: '✕ Reject',
        };
      }
    }
  } else if (state.blocks.length > 0 && newDiskBlocks.length > 0) {
    const oldLen = state.blocks.length;
    const newLen = newDiskBlocks.length;
    let prefixLen = 0;
    while (
      prefixLen < oldLen &&
      prefixLen < newLen &&
      state.blocks[prefixLen].raw === newDiskBlocks[prefixLen].raw
    ) {
      prefixLen++;
    }
    let suffixLen = 0;
    while (
      suffixLen < oldLen - prefixLen &&
      suffixLen < newLen - prefixLen &&
      state.blocks[oldLen - 1 - suffixLen].raw === newDiskBlocks[newLen - 1 - suffixLen].raw
    ) {
      suffixLen++;
    }

    const oldSlice = state.blocks.slice(prefixLen, oldLen - suffixLen);
    const newSlice = newDiskBlocks.slice(prefixLen, newLen - suffixLen);

    if (oldSlice.length > 0 && newSlice.length > 0) {
      if (oldSlice.length === 1) {
        oldSlice[0].diff = {
          oldRaw: oldSlice[0].raw,
          newRaw: newSlice.map((b) => b.raw).join('\n\n'),
          newReviews: newSlice[newSlice.length - 1].reviews || [],
          oldReviews: oldSlice[0].reviews || [],
          fromDisk,
          source: sourceLabel,
          acceptLabel: '✓ Accept Change',
          rejectLabel: '✕ Reject',
        };
      } else {
        for (let i = 0; i < oldSlice.length; i++) {
          const cur = oldSlice[i];
          const incomingRaw =
            i < oldSlice.length - 1
              ? newSlice[i]?.raw ?? ''
              : newSlice
                  .slice(i)
                  .map((b) => b.raw)
                  .join('\n\n');
          if (incomingRaw !== cur.raw) {
            cur.diff = {
              oldRaw: cur.raw,
              newRaw: incomingRaw,
              newReviews: newSlice[Math.min(i, newSlice.length - 1)]?.reviews || [],
              oldReviews: cur.reviews || [],
              fromDisk,
              source: sourceLabel,
              acceptLabel: '✓ Accept Change',
              rejectLabel: '✕ Reject',
            };
          }
        }
      }
    } else if (oldSlice.length === 0 && newSlice.length > 0) {
      const insertedBlocks = newSlice.map((inc, idx) => ({
        ...inc,
        id: `b-ins-${Date.now()}-${idx}`,
        diff: {
          oldRaw: '',
          newRaw: inc.raw,
          newReviews: inc.reviews || [],
          isInsertion: true,
          fromDisk,
          source: `${sourceLabel} (Inserted Block)`,
          acceptLabel: '✓ Accept Insertion',
          rejectLabel: '✕ Reject',
        },
      }));
      state.blocks.splice(prefixLen, 0, ...insertedBlocks);
      recomputeBlockLineNumbers();
    } else if (oldSlice.length > 0 && newSlice.length === 0) {
      for (const cur of oldSlice) {
        cur.diff = {
          oldRaw: cur.raw,
          newRaw: '',
          newReviews: [],
          oldReviews: cur.reviews || [],
          isDeletion: true,
          fromDisk,
          source: `${sourceLabel} (Deleted Block)`,
          acceptLabel: '✓ Accept Deletion',
          rejectLabel: '✕ Reject',
        };
      }
    }
  }

  setSyncStatus('agent', 'Review proposed edit');
  updateHeaderTelemetry();
  renderCanvas();
}

// ---------------------------------------------------------------------------
// File Discovery, Open, Close & Live Disk Sync
// ---------------------------------------------------------------------------

function populateFileSelectDropdown() {
  const select = document.getElementById('file-select');
  if (!select) return;

  const countLabel = state.files.length > 0 ? `Select .md file (${state.files.length})…` : 'Select .md file…';
  select.innerHTML = `<option value="">${escapeHtml(countLabel)}</option>`;

  for (const f of state.files) {
    const opt = document.createElement('option');
    opt.value = f.path;
    opt.textContent = f.rel || f.name || f.path;
    select.appendChild(opt);
  }

  if (state.filePath && ![...select.options].some((o) => o.value === state.filePath)) {
    const opt = document.createElement('option');
    opt.value = state.filePath;
    opt.textContent = pathBasename(state.filePath);
    select.appendChild(opt);
  }

  select.value = state.filePath || '';
}

async function scanWorkspaceAndSessionFiles(workspaceUriOrDir = '') {
  try {
    const res = await apiPost('/api/files', {
      workspaceUri: workspaceUriOrDir || state.workspacePath || '',
      conversationId: window.sidecar?.conversationId || '',
    });

    if (res.workspacePath) state.workspacePath = res.workspacePath;
    if (res.sessionDir) state.sessionDir = res.sessionDir;
    state.files = Array.isArray(res.files) ? res.files : [];

    populateFileSelectDropdown();
    if (!state.filePath && state.blocks.length === 0) {
      renderEmptyState();
    }
    setSyncStatus(
      state.filePath ? 'synced' : 'idle',
      state.filePath ? 'Synced' : (state.files.length > 0 ? `${state.files.length} workspace .md files` : 'Ready')
    );
    return state.files;
  } catch (err) {
    setSyncStatus('idle', 'Scan Error');
    showError(`Workspace file scan failed: ${err.message}`);
    return [];
  }
}

function closeCurrentDocument() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = null;
  }
  state.filePath = '';
  state.mtimeMs = 0;
  state.blocks = [];
  state.activeBlockId = null;
  state.activeCommentBlockId = null;
  state.audit = null;
  state.metrics = { fog: null, slop: null, vale: null, seo: null, geo: null, words: 0, blockHealth: {} };
  state.spans = [];
  undoStack = [];
  redoStack = [];
  populateFileSelectDropdown();
  updateDocNavButtons();
  updateHeaderTelemetry();
  renderCanvas();
  setSyncStatus('idle', 'Ready');
}

function slugifyHeadingAnchor(text) {
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

function scrollToDocumentAnchor(rawAnchor) {
  const cleanAnchor = decodeURIComponent(String(rawAnchor || '').replace(/^#/, '').trim());
  if (!cleanAnchor) return;

  // 1. Check for GitHub-style line anchor (#L47 or #L10-L25)
  const lineMatch = cleanAnchor.match(/^L(\d+)(?:-L?\d+)?$/i);
  let targetBlock = null;
  if (lineMatch) {
    const lineNum = Number(lineMatch[1]);
    targetBlock = findBlockForLine(lineNum);
  } else {
    const targetSlug = slugifyHeadingAnchor(cleanAnchor);
    targetBlock =
      state.blocks.find((b) => b.type === 'heading' && slugifyHeadingAnchor(b.raw) === targetSlug) ||
      state.blocks.find((b) => b.type === 'heading' && slugifyHeadingAnchor(b.raw).includes(targetSlug));
  }

  if (!targetBlock) return;
  const blockEl = document.querySelector(`.doc-block[data-block-id="${targetBlock.id}"]`);
  if (!blockEl) return;

  blockEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  blockEl.classList.add('is-anchor-target');
  setTimeout(() => {
    blockEl.classList.remove('is-anchor-target');
  }, 1800);
}

function updateDocNavButtons() {
  const cluster = document.getElementById('doc-nav-cluster');
  const backBtn = document.getElementById('btn-nav-back');
  const fwdBtn = document.getElementById('btn-nav-forward');
  if (!cluster || !backBtn || !fwdBtn) return;

  const hasBack = state.docNavBackStack.length > 0;
  const hasFwd = state.docNavForwardStack.length > 0;
  setHidden(cluster, !hasBack && !hasFwd);

  backBtn.disabled = !hasBack;
  if (hasBack) {
    const prevEntry = state.docNavBackStack[state.docNavBackStack.length - 1];
    const prevName = pathBasename(prevEntry.filePath) || 'previous file';
    backBtn.setAttribute('data-tooltip', `Back to ${prevName} (⌘[)`);
  } else {
    backBtn.setAttribute('data-tooltip', 'Back (⌘[)');
  }

  fwdBtn.disabled = !hasFwd;
  if (hasFwd) {
    const nextEntry = state.docNavForwardStack[state.docNavForwardStack.length - 1];
    const nextName = pathBasename(nextEntry.filePath) || 'next file';
    fwdBtn.setAttribute('data-tooltip', `Forward to ${nextName} (⌘])`);
  } else {
    fwdBtn.setAttribute('data-tooltip', 'Forward (⌘])');
  }
}

async function navigateToLinkedDocument(rawTargetPath, anchor = '') {
  const cleanTarget = String(rawTargetPath || '').trim();
  if (!cleanTarget) {
    if (anchor) scrollToDocumentAnchor(anchor);
    return;
  }

  const prevFilePath = state.filePath;
  const prevScrollTop = document.getElementById('canvas-scroll')?.scrollTop || 0;
  const prevMode = state.studioMode;

  const opened = await openDocument(cleanTarget, {
    baseDocPath: prevFilePath,
    preserveMode: true,
    anchor,
  });

  if (opened && prevFilePath && state.filePath !== prevFilePath) {
    state.docNavBackStack.push({
      filePath: prevFilePath,
      scrollTop: prevScrollTop,
      studioMode: prevMode,
    });
    state.docNavForwardStack = [];
    updateDocNavButtons();
  }
}

async function navigateBackDocument() {
  if (state.docNavBackStack.length === 0) return;
  const currentEntry = state.filePath
    ? {
        filePath: state.filePath,
        scrollTop: document.getElementById('canvas-scroll')?.scrollTop || 0,
        studioMode: state.studioMode,
      }
    : null;

  const targetEntry = state.docNavBackStack.pop();
  if (currentEntry) {
    state.docNavForwardStack.push(currentEntry);
  }
  updateDocNavButtons();

  await openDocument(targetEntry.filePath, {
    preserveMode: true,
    restoreScrollTop: targetEntry.scrollTop,
    targetMode: targetEntry.studioMode,
  });
}

async function navigateForwardDocument() {
  if (state.docNavForwardStack.length === 0) return;
  const currentEntry = state.filePath
    ? {
        filePath: state.filePath,
        scrollTop: document.getElementById('canvas-scroll')?.scrollTop || 0,
        studioMode: state.studioMode,
      }
    : null;

  const targetEntry = state.docNavForwardStack.pop();
  if (currentEntry) {
    state.docNavBackStack.push(currentEntry);
  }
  updateDocNavButtons();

  await openDocument(targetEntry.filePath, {
    preserveMode: true,
    restoreScrollTop: targetEntry.scrollTop,
    targetMode: targetEntry.studioMode,
  });
}

function handleMarkdownLinkClick(e, linkEl) {
  const rawHref = (linkEl.getAttribute('data-local-href') || linkEl.getAttribute('href') || '').trim();
  if (!rawHref) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // External HTTP/HTTPS/mailto links open in browser
  if (/^(https?:\/\/|mailto:)/i.test(rawHref)) {
    e.stopPropagation();
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  // 1. In-document anchor link (#section or #L10-L20)
  if (rawHref.startsWith('#')) {
    scrollToDocumentAnchor(rawHref.slice(1));
    return;
  }

  // 2. sidecar://speedgrapher/panel/?file=... deep link
  if (/^sidecar:\/\/speedgrapher\/panel/i.test(rawHref)) {
    const qIdx = rawHref.indexOf('?');
    if (qIdx >= 0) {
      const qs = new URLSearchParams(rawHref.slice(qIdx + 1).split('#')[0]);
      const fileParam = qs.get('file');
      const hashPart = rawHref.includes('#') ? rawHref.split('#').slice(1).join('#') : '';
      if (fileParam) {
        navigateToLinkedDocument(fileParam, hashPart);
        return;
      }
    }
    setSyncStatus('synced', 'Speedgrapher Active');
    return;
  }

  // 3. Relative, absolute, or file:// link to another Markdown or text file
  const hashIdx = rawHref.indexOf('#');
  const pathPart = hashIdx >= 0 ? rawHref.slice(0, hashIdx) : rawHref;
  const hashPart = hashIdx >= 0 ? rawHref.slice(hashIdx + 1) : '';
  navigateToLinkedDocument(pathPart, hashPart);
}

function applyOpenedDocumentResponse(res, options = {}) {
  state.filePath = res.path || '';
  state.mtimeMs = res.mtimeMs || 0;
  state.docType = res.docType || state.docType || 'auto';
  state.keyword = res.keyword ?? state.keyword ?? '';

  state.blocks = parseDocumentIntoBlocks(res.content);
  recomputeBlockLineNumbers();
  state.activeBlockId = null;
  state.activeCommentBlockId = null;

  state.audit = res.audit;
  state.metrics = res.metrics || { fog: null, slop: null, vale: null, seo: null, words: countWordsInText(res.content) };
  try {
    state.spans = buildAmbientSpansFromAudit(res.audit);
  } catch (err) {
    state.spans = [];
    showError(`Failed to build ambient spans from audit: ${err.message}`);
  }

  resetHistoryForDocument(res.content, `Opened ${state.filePath ? pathBasename(state.filePath) : 'document'}`);
  populateFileSelectDropdown();
  updateDocNavButtons();

  const kwInput = document.getElementById('keyword-input');
  if (kwInput) kwInput.value = state.keyword;

  // Preserve current mode when drilling down into linked files, or default to Reader Mode
  const nextMode = options.targetMode || (options.preserveMode ? state.studioMode : 'reader');
  setStudioMode(nextMode);

  setSyncStatus('synced', 'Synced');
  updateHeaderTelemetry();
  renderCanvas();

  const canvasScroll = document.getElementById('canvas-scroll');
  if (options.anchor) {
    setTimeout(() => scrollToDocumentAnchor(options.anchor), 30);
  } else if (typeof options.restoreScrollTop === 'number' && canvasScroll) {
    canvasScroll.scrollTop = options.restoreScrollTop;
  } else if (canvasScroll) {
    canvasScroll.scrollTop = 0;
  }

  if (state.filePath) {
    startLiveDiskPolling();
  }

  if (res.auditError) {
    showError(`Document opened, but audit returned an error:\n${res.auditError}`);
  }
}

async function openDocument(targetPath, options = {}) {
  if (!targetPath) {
    closeCurrentDocument();
    return false;
  }
  try {
    clearError();
    setSyncStatus('saving', 'Loading document…');
    const res = await apiPost('/api/doc/open', {
      path: targetPath,
      baseDocPath: options.baseDocPath ?? state.filePath ?? '',
      workspacePath: state.workspacePath || '',
      docType: state.docType,
      keyword: state.keyword,
      conversationId: window.sidecar?.conversationId || '',
    });
    applyOpenedDocumentResponse(res, options);
    return true;
  } catch (err) {
    setSyncStatus('idle', 'Error');
    populateFileSelectDropdown();
    showError(`Failed to open "${targetPath}":\n${err.message}`);
    return false;
  }
}

function scheduleDebouncedSync(source = 'user', label = 'Edited prose') {
  setSyncStatus('saving', state.filePath ? 'Unsaved edits…' : 'Auditing draft…');
  if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    syncDebounceTimer = null;
    syncDocumentToDisk(source, label);
  }, 1200);
}

async function syncDocumentToDisk(source = 'user', label = 'Edited prose') {
  if (state.blocks.length === 0 && !state.filePath) return;
  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = null;
  }
  if (isSyncing) {
    pendingSyncRequest = { source, label };
    return;
  }
  isSyncing = true;
  setSyncStatus('saving', state.filePath ? 'Syncing…' : 'Auditing…');
  try {
    const markdown = serializeBlocksToMarkdown(state.blocks);

    if (!state.filePath) {
      const res = await apiPost('/api/audit', {
        text: markdown,
        docType: state.docType,
        keyword: state.keyword,
        workspacePath: state.workspacePath || '',
      });
      state.audit = res.audit;
      state.metrics = res.metrics || state.metrics;
      state.spans = buildAmbientSpansFromAudit(res.audit);
      setSyncStatus('synced', 'Audited');
      updateHeaderTelemetry();
      if (!state.activeBlockId) {
        renderCanvas();
      }
      return;
    }

    const res = await apiPost('/api/doc/sync', {
      path: state.filePath,
      workspacePath: state.workspacePath || '',
      conversationId: window.sidecar?.conversationId || '',
      content: markdown,
      source,
      label,
      docType: state.docType,
      keyword: state.keyword,
    });

    state.mtimeMs = res.mtimeMs;
    state.audit = res.audit;
    state.metrics = res.metrics || state.metrics;
    state.spans = buildAmbientSpansFromAudit(res.audit);

    setSyncStatus('synced', 'Saved & Audited');
    updateHeaderTelemetry();
    if (!state.activeBlockId) {
      renderCanvas();
    }

    if (res.auditError) {
      showError(`Saved to disk, but audit returned an error:\n${res.auditError}`);
    }
  } catch (err) {
    setSyncStatus('idle', 'Sync Error');
    showError(`Sync failed: ${err.message}`);
  } finally {
    isSyncing = false;
    if (pendingSyncRequest) {
      const next = pendingSyncRequest;
      pendingSyncRequest = null;
      await syncDocumentToDisk(next.source, next.label);
    }
  }
}

function startLiveDiskPolling() {
  if (pollIntervalId) clearInterval(pollIntervalId);
  pollIntervalId = setInterval(async () => {
    if (!state.filePath || isSyncing || syncDebounceTimer || state.activeBlockId) {
      return;
    }
    try {
      const currentMd = serializeBlocksToMarkdown(state.blocks);
      const res = await apiPost('/api/doc/poll', {
        path: state.filePath,
        workspacePath: state.workspacePath || '',
        conversationId: window.sidecar?.conversationId || '',
        knownMtimeMs: state.mtimeMs,
        currentContent: currentMd,
        docType: state.docType,
        keyword: state.keyword,
      });
      if (res.mtimeMs) state.mtimeMs = res.mtimeMs;
      if (res.auditError) {
        showError(`Live disk audit error:\n${res.auditError}`);
      }
      if (res.changed && typeof res.content === 'string') {
        reconcileExternalDiskUpdate(res.content, res.audit, res.metrics);
      }
    } catch (err) {
      showError(`Live file poll failed: ${err.message}`);
    }
  }, 1500);
}

// ---------------------------------------------------------------------------
// Event Wiring & Bootstrap
// ---------------------------------------------------------------------------

function initStudioEvents() {
  applyThemeMode(detectIdeThemeMode());
  setTimeout(() => {
    if (!state.userToggledTheme) {
      applyThemeMode(detectIdeThemeMode());
    }
  }, 120);

  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'theme-change') {
      setTimeout(() => {
        state.userToggledTheme = false;
        applyThemeMode(detectIdeThemeMode());
      }, 20);
    }
  });

  document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
    state.userToggledTheme = true;
    applyThemeMode(state.themeMode === 'dark' ? 'light' : 'dark');
  });

  // 4-Mode Segmented Control (Reader | Editor | Reviewer | Raw)
  document.getElementById('mode-btn-reader')?.addEventListener('click', () => {
    setStudioMode('reader');
  });
  document.getElementById('mode-btn-editor')?.addEventListener('click', () => {
    setStudioMode('editor');
  });
  document.getElementById('mode-btn-reviewer')?.addEventListener('click', () => {
    setStudioMode('reviewer');
  });
  document.getElementById('mode-btn-raw')?.addEventListener('click', () => {
    setStudioMode('raw');
  });

  // Raw Markdown Editor (#raw-markdown-editor) Two-Way Live Sync
  const rawEditor = document.getElementById('raw-markdown-editor');
  if (rawEditor) {
    rawEditor.addEventListener('input', () => {
      if (state.studioMode !== 'raw') return;
      const md = rawEditor.value.replace(/\r\n/g, '\n');
      state.blocks = parseDocumentIntoBlocks(md);
      recomputeBlockLineNumbers();
      state.metrics.words = countWordsInText(md);
      const statsEl = document.getElementById('raw-line-count-badge');
      if (statsEl) {
        const lineCount = md ? md.split('\n').length : 0;
        statsEl.textContent = `${lineCount} lines · ${state.metrics.words} words`;
      }
      updateHeaderTelemetry();
      scheduleTypingHistorySnapshot('Edited Raw Markdown');
      scheduleDebouncedSync('user', 'Edited Raw Markdown');
    });

    rawEditor.addEventListener('keydown', (e) => {
      if (isUndoShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        performUndo();
        return;
      }
      if (isRedoShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        performRedo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        flushPendingHistorySnapshot('Saved Raw Markdown');
        syncDocumentToDisk('user', 'Saved Raw Markdown');
      }
    });
  }

  document.getElementById('btn-nav-back')?.addEventListener('click', () => {
    navigateBackDocument();
  });

  document.getElementById('btn-nav-forward')?.addEventListener('click', () => {
    navigateForwardDocument();
  });

  const fileSelect = document.getElementById('file-select');
  fileSelect?.addEventListener('change', (e) => {
    const chosen = e.target.value;
    if (!chosen) {
      closeCurrentDocument();
      return;
    }
    navigateToLinkedDocument(chosen);
  });

  // Center Editorial Lens Chips (Heatmap, Slop, Vale, Fog) + Second-Plane SEO & GEO
  document.querySelectorAll('.lens-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lens = btn.dataset.lens;
      if (lens === 'seo') {
        toggleSeoPopover();
        return;
      }
      if (state.activeLenses.has(lens)) {
        state.activeLenses.delete(lens);
      } else {
        state.activeLenses.add(lens);
      }
      updateHeaderTelemetry();
      renderCanvas();
    });
  });

  // Resolve Review Comments with AI Button
  document.getElementById('btn-send-review-agent')?.addEventListener('click', () => {
    dispatchReviewCommentsToAgent();
  });

  document.getElementById('btn-undo')?.addEventListener('click', () => {
    performUndo();
  });

  document.getElementById('btn-redo')?.addEventListener('click', () => {
    performRedo();
  });

  document.getElementById('btn-ask-agent-top')?.addEventListener('click', () => {
    if (state.cmdOpen) closeAllPopovers();
    else openCommandPaletteForBlock(state.activeBlockId);
  });

  document.getElementById('btn-settings')?.addEventListener('click', () => {
    toggleSettingsPopover();
  });

  document.getElementById('btn-close-seo')?.addEventListener('click', () => closeAllPopovers());
  document.getElementById('btn-close-cmd')?.addEventListener('click', () => closeAllPopovers());
  document.getElementById('btn-close-settings')?.addEventListener('click', () => closeAllPopovers());
  document.getElementById('btn-popover-close')?.addEventListener('click', () => hideLensPopover());
  document.getElementById('btn-close-comment-popover')?.addEventListener('click', () => closeCommentPopover());

  // 3-Tab Settings Navigation
  document.querySelectorAll('.settings-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchSettingsTab(btn.dataset.settingsTab);
    });
  });

  // Vale Rules Search & Active in Doc Filter
  document.getElementById('vale-rules-search')?.addEventListener('input', (e) => {
    state.valeRulesData.filterQuery = e.target.value;
    renderValeRulesTab();
  });

  document.getElementById('vale-filter-active-btn')?.addEventListener('click', () => {
    state.valeRulesData.onlyActiveInDoc = !state.valeRulesData.onlyActiveInDoc;
    renderValeRulesTab();
  });

  // Vocabulary Add Term Controls
  document.getElementById('btn-vocab-add')?.addEventListener('click', () => {
    const input = document.getElementById('vocab-new-term-input');
    const term = input?.value.trim() || '';
    if (term) {
      addTermToValeVocab(term);
      input.value = '';
    }
  });

  document.getElementById('vocab-new-term-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const term = e.target.value.trim();
      if (term) {
        addTermToValeVocab(term);
        e.target.value = '';
      }
    }
  });

  // AI Settings Popover Controls
  document.querySelectorAll('.settings-auth-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.aiSettings.authMode = btn.dataset.authMode === 'apikey' ? 'apikey' : 'vertex';
      renderSettingsPopover();
    });
  });

  document.querySelectorAll('.settings-thinking-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.aiSettings.thinkingLevel = (btn.dataset.thinkingLevel || 'LOW').toUpperCase();
      renderSettingsPopover();
    });
  });

  document.getElementById('btn-save-settings')?.addEventListener('click', () => {
    saveStudioAiSettings(false);
  });

  document.getElementById('btn-clear-apikey')?.addEventListener('click', () => {
    saveStudioAiSettings(true);
  });

  ['settings-project-input', 'settings-location-input', 'settings-apikey-input', 'settings-model-input'].forEach((id) => {
    document.getElementById(id)?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveStudioAiSettings(false);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeAllPopovers();
      }
    });
  });

  document.getElementById('btn-dismiss-error')?.addEventListener('click', () => clearError());

  // SEO & GEO Popover Profile & Keyword Controls
  document.querySelectorAll('.seg-btn[data-doc-type]').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.docType = chip.dataset.docType || 'auto';
      renderSeoAndGeoPopover();
      syncDocumentToDisk('user', `Set profile to ${state.docType}`);
    });
  });

  const kwInput = document.getElementById('keyword-input');
  kwInput?.addEventListener('change', (e) => {
    state.keyword = e.target.value.trim();
    syncDocumentToDisk('user', `Updated keyword "${state.keyword}"`);
  });
  kwInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      state.keyword = e.target.value.trim();
      syncDocumentToDisk('user', `Updated keyword "${state.keyword}"`);
    }
  });

  document.getElementById('btn-seo-agent-fix')?.addEventListener('click', () => {
    const seoPrompt = `Optimize this document for SEO and GEO with doc_type="${state.docType}" and target keyword="${
      state.keyword || 'technical topic'
    }". Improve heading hierarchy, link hygiene, image alt-text, self-contained section leads, and dual-purpose frontmatter metadata (summary 80–180 chars vs description 120–160 chars).`;
    closeAllPopovers();
    dispatchScopedAgentSkill('publish', null, seoPrompt);
  });

  // Empty State New Blank Draft Button
  document.getElementById('btn-empty-add-block')?.addEventListener('click', () => {
    const initialDraft =
      '# Draft Title\n\nClick any paragraph to edit inline, or press ⌘K to orchestrate with an AI editorial skill.\n';
    state.filePath = '';
    state.blocks = parseDocumentIntoBlocks(initialDraft);
    recomputeBlockLineNumbers();
    resetHistoryForDocument(initialDraft, 'New blank draft');
    setStudioMode('editor');
    updateHeaderTelemetry();
    renderCanvas();
    enterBlockEditMode('b-1');
    scheduleDebouncedSync('user', 'New blank draft');
  });

  const pop = document.getElementById('lens-popover');
  if (pop) {
    pop.addEventListener('mouseenter', () => {
      if (popoverHideTimer) {
        clearTimeout(popoverHideTimer);
        popoverHideTimer = null;
      }
    });
    pop.addEventListener('mouseleave', () => scheduleHideLensPopover());
  }

  const cmdInput = document.getElementById('cmd-input');
  cmdInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeAllPopovers();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const customText = cmdInput.value.trim();
      if (!customText) return;
      const block = state.blocks.find((b) => b.id === state.cmdBlockId) || null;
      closeAllPopovers();
      dispatchScopedAgentSkill('draft', block, customText);
    }
  });

  document.getElementById('btn-cmd-submit')?.addEventListener('click', () => {
    const block = state.blocks.find((b) => b.id === state.cmdBlockId) || null;
    const customText = cmdInput?.value.trim() || 'Review and improve this passage.';
    closeAllPopovers();
    dispatchScopedAgentSkill('draft', block, customText);
  });

  document.getElementById('btn-cmd-send-chat')?.addEventListener('click', () => {
    const block = state.blocks.find((b) => b.id === state.cmdBlockId) || null;
    const customText = cmdInput?.value.trim() || '';
    closeAllPopovers();
    sendContextToMainChat(block, customText);
  });

  document.getElementById('canvas-scroll')?.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.lens-popover') && !e.target.closest('mark.lens-span') && !e.target.closest('.block-heatmap-pill')) {
      hideLensPopover();
    }
    if (!e.target.closest('.comment-popover') && !e.target.closest('[data-action="comment"]')) {
      closeCommentPopover();
    }
    if (!state.activeBlockId) return;
    if (e.target.closest('.doc-block.is-editing')) return;
    if (e.target.closest('.floating-popover') || e.target.closest('.lens-popover') || e.target.closest('.comment-popover')) return;
    exitBlockEditMode(state.activeBlockId);
  });

  window.addEventListener('keydown', (e) => {
    const activeTag = document.activeElement?.tagName?.toLowerCase();
    const isInputFocused = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

    if (!isInputFocused && isUndoShortcut(e)) {
      e.preventDefault();
      performUndo();
      return;
    }
    if (!isInputFocused && isRedoShortcut(e)) {
      e.preventDefault();
      performRedo();
      return;
    }
    if (!isInputFocused && (((e.metaKey || e.ctrlKey) && e.key === '[') || (e.altKey && e.key === 'ArrowLeft'))) {
      e.preventDefault();
      navigateBackDocument();
      return;
    }
    if (!isInputFocused && (((e.metaKey || e.ctrlKey) && e.key === ']') || (e.altKey && e.key === 'ArrowRight'))) {
      e.preventDefault();
      navigateForwardDocument();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'i')) {
      e.preventDefault();
      if (state.studioMode === 'reader') {
        setStudioMode('editor');
      }
      const selText = window.getSelection()?.toString().trim() || '';
      openCommandPaletteForBlock(state.activeBlockId, selText);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      flushPendingHistorySnapshot('Saved');
      syncDocumentToDisk('user', 'Saved');
    } else if (e.key === 'Escape') {
      if (state.activeBlockId) {
        exitBlockEditMode(state.activeBlockId);
      }
      closeAllPopovers();
      hideLensPopover();
      closeCommentPopover();
    }
  });
}

async function bootstrap() {
  initStudioEvents();
  await loadStudioAiSettings();

  const params = new URLSearchParams(window.location.search);
  const deepLinkFile = params.get('file');

  await scanWorkspaceAndSessionFiles('');

  if (deepLinkFile) {
    await openDocument(deepLinkFile);
  } else {
    renderCanvas();
  }

  window.sidecar?.onWorkspaceChange?.((newUris) => {
    if (Array.isArray(newUris) && newUris[0]) {
      scanWorkspaceAndSessionFiles(newUris[0]);
    }
  });

  if (window.sidecar?.getWorkspaceUris) {
    window.sidecar
      .getWorkspaceUris()
      .then((uris) => {
        if (Array.isArray(uris) && uris[0]) {
          scanWorkspaceAndSessionFiles(uris[0]);
        }
      })
      .catch((err) => {
        showError(`Failed to query host workspace URIs: ${err.message}`);
      });
  }
}

bootstrap();
})();
