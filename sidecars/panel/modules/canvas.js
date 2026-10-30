/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// ---------------------------------------------------------------------------
// Document Canvas, Block Editing, Caret Mapping, Drag-and-Drop, Diffs & Undo/Redo
// ---------------------------------------------------------------------------

import {
  state,
  runtime,
  setHidden,
  escapeHtml,
  pathBasename,
  countWordsInText,
  setSyncStatus,
  showError,
} from './state.js';
import { cancelBlockAiRequest } from './api.js';
import {
  parseDocumentIntoBlocks,
  serializeBlocksToMarkdown,
  recomputeBlockLineNumbers,
  computeWordDiffHtml,
  isSpanSliceValidForBlock,
  updateUndoRedoButtons,
  recordHistorySnapshot,
  scheduleTypingHistorySnapshot,
  flushPendingHistorySnapshot,
  isUndoShortcut,
  isRedoShortcut,
} from './markdown.js';
import {
  locateAlertSpanInBlock,
  computeBlockDiagnostics,
} from './diagnostics.js';
import {
  renderBlockWithAmbientSpans,
  autoResizeBlockTextarea,
} from './renderer.js';
import {
  bindLensSpanHoverEvents,
  showBlockDiagnosticPopover,
  hideLensPopover,
  updateHeaderTelemetry,
  closeAllPopovers,
} from './popovers.js';
import {
  openCommentPopoverForBlock,
  closeCommentPopover,
  createReviewThreadCard,
} from './comments.js';
import {
  openCommandPaletteForBlock,
  openSendToChatPopover,
  launchVariantTournamentForBlock,
} from './ai.js';
import {
  handleMarkdownLinkClick,
  scheduleDebouncedSync,
  syncDocumentToDisk,
  openSaveDraftPrompt,
} from './sync.js';

export function setStudioMode(mode) {
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
  const hasDoc = Boolean(state.filePath || state.blocks.length > 0);

  setHidden('editor-lens-cluster', !showLenses);
  setHidden('btn-seo-geo', !showLenses);
  setHidden('btn-undo', !showUndoRedo);
  setHidden('btn-redo', !showUndoRedo);
  setHidden('btn-send-chat-top', !hasDoc);

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
    if (state.seoPopoverOpen || (state.cmdOpen && state.cmdMode !== 'chat')) {
      closeAllPopovers();
    }
  }
  if (next !== 'editor' && next !== 'reviewer') {
    closeCommentPopover();
  }

  updateHeaderTelemetry();
  renderCanvas();
}

function restoreHistorySnapshot(snap, actionLabel) {
  if (!snap) return;
  if (Array.isArray(snap.blocks) && snap.blocks.length > 0) {
    state.blocks = JSON.parse(JSON.stringify(snap.blocks));
  } else {
    state.blocks = parseDocumentIntoBlocks(snap.markdown);
  }
  state.activeBlockId = snap.activeBlockId || null;
  recomputeBlockLineNumbers();
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
  syncDocumentToDisk('user', actionLabel, { immediate: true, forceRender: true });
}

export function performUndo() {
  if (state.studioMode === 'reader') return;
  flushPendingHistorySnapshot('Typing');
  if (runtime.undoStack.length <= 1) return;
  const current = runtime.undoStack.pop();
  runtime.redoStack.push(current);
  const prev = runtime.undoStack[runtime.undoStack.length - 1];
  restoreHistorySnapshot(prev, 'Undo');
}

export function performRedo() {
  if (state.studioMode === 'reader') return;
  flushPendingHistorySnapshot('Typing');
  if (runtime.redoStack.length === 0) return;
  const next = runtime.redoStack.pop();
  runtime.undoStack.push(next);
  restoreHistorySnapshot(next, 'Redo');
}

export function renderEmptyState() {
  const subtitleEl = document.getElementById('empty-state-subtitle');
  if (subtitleEl) {
    subtitleEl.innerHTML = state.workspacePath
      ? `Workspace: <code>${escapeHtml(pathBasename(state.workspacePath) || state.workspacePath)}</code> · Create a new file or open an existing Markdown file.`
      : 'Create a new file or open an existing Markdown file.';
  }
}

export function setHighlightedBlock(blockId) {
  if (state.studioMode === 'reader') return;
  const nextId = blockId || null;
  if (state.highlightedBlockId === nextId) return;
  state.highlightedBlockId = nextId;
  document.querySelectorAll('#block-canvas .doc-block').forEach((el) => {
    const isMatch = el.dataset.blockId === nextId || el.classList.contains('is-editing');
    el.classList.toggle('is-highlighted', isMatch);
  });
}

export function renderCanvas() {
  const canvasEl = document.getElementById('block-canvas');
  const rawWrapEl = document.getElementById('raw-editor-wrap');
  const rawTextareaEl = document.getElementById('raw-markdown-editor');
  if (!canvasEl) return;

  if (!canvasEl.dataset.hoverBound) {
    canvasEl.dataset.hoverBound = '1';
    canvasEl.addEventListener('mouseleave', () => {
      setHighlightedBlock(state.activeBlockId || null);
    });
  }

  if (!state.filePath && state.blocks.length === 0) {
    setHidden('canvas-empty', false);
    setHidden('block-canvas', true);
    if (rawWrapEl) setHidden(rawWrapEl, true);
    setHidden('sheet-footer', true);
    renderEmptyState();
    return;
  }

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

  if (
    state.highlightedBlockId &&
    !state.blocks.some((b) => b.id === state.highlightedBlockId)
  ) {
    state.highlightedBlockId = state.activeBlockId || (state.blocks[0]?.id ?? null);
  }

  state.blocks.forEach((block, blockIdx) => {
    if (isReader && /^(?:<!--[\s\S]*?-->\s*)+$/.test(block.raw.trim())) {
      return;
    }
    const isEditing = isEditor && state.activeBlockId === block.id;
    const isHighlighted = !isReader && (state.highlightedBlockId === block.id || isEditing);
    const article = document.createElement('article');
    article.className = 'doc-block';
    article.dataset.blockId = block.id;
    article.dataset.type = block.type;
    if (block.level) article.dataset.level = String(block.level);
    if (isEditing) article.classList.add('is-editing');
    if (isHighlighted) article.classList.add('is-highlighted');
    if (block.busy) article.classList.add('is-busy');

    if (!isReader) {
      article.addEventListener('mouseenter', () => {
        setHighlightedBlock(block.id);
      });
    }

    if (block.type === 'blockquote' && /^\s*>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(block.raw)) {
      article.dataset.alert = 'true';
    }

    const diag = showDiagnostics ? computeBlockDiagnostics(block) : null;
    if (diag) {
      article.dataset.heatmap = diag.health;
    }

    if (!isReader) {
      const hoverPill = document.createElement('div');
      hoverPill.className = 'block-hover-pill';
    const revCount = Array.isArray(block.reviews) ? block.reviews.length : 0;

    const chatDispatchIconSvg = `<svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`;
    const commentIconSvg = `<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    const dragGripIconSvg = `<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>`;
    const aiSparkleIconSvg = `<svg viewBox="0 0 24 24"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>`;
    const tourneyIconSvg = `<svg viewBox="0 0 24 24"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`;

    const formatDiagPillLabel = (d) => {
      const parts = [`Fog ${d.fog}`];
      if (d.slopCount > 0) parts.push(`${d.slopCount} Slop`);
      if (d.valeCount > 0) parts.push(`${d.valeCount} Vale`);
      return parts.join(' · ');
    };

    const commentTriggerHtml =
      revCount > 0
        ? `<button class="block-comment-trigger" type="button" data-action="comment" data-tooltip="Comments" data-tooltip-pos="top">${commentIconSvg}<span>${revCount}</span></button>`
        : `<button class="block-mini-icon" type="button" data-action="comment" data-tooltip="Comment" data-tooltip-pos="top">${commentIconSvg}</button>`;

    const diagPillHtml = diag
      ? `<button class="block-heatmap-pill" type="button" data-action="block-diag" data-health="${diag.health}" data-tooltip="Diagnostics" data-tooltip-pos="top">${formatDiagPillLabel(diag)}</button>`
      : '';

    if (isReviewer) {
      hoverPill.innerHTML = `
        <div class="block-header-left">
          <span class="block-tag-label">L${block.startLine}</span>
          ${diagPillHtml}
        </div>
        <div class="block-header-right">
          ${commentTriggerHtml}
          <button class="block-mini-icon" type="button" data-action="send-chat" data-tooltip="Send to chat" data-tooltip-pos="top">
            ${chatDispatchIconSvg}
          </button>
          <button class="block-mini-icon" type="button" data-action="cmd" data-tooltip="AI rewrite" data-tooltip-pos="top">
            ${aiSparkleIconSvg}
          </button>
        </div>
      `;
    } else {
      const doneBtnHtml = isEditing
        ? `<button class="block-done-btn" type="button" data-action="done-edit" data-tooltip="Done (Esc)" data-tooltip-pos="top">Done</button>`
        : '';
      hoverPill.innerHTML = `
        <div class="block-header-left">
          <button class="block-mini-icon block-drag-handle" type="button" draggable="${isEditing ? 'false' : 'true'}" data-action="drag-handle" aria-label="Reorder" data-tooltip="Reorder" data-tooltip-pos="top">
            ${dragGripIconSvg}
          </button>
          <span class="block-tag-label">L${block.startLine}</span>
          ${diagPillHtml}
        </div>
        <div class="block-header-right">
          ${doneBtnHtml}
          ${commentTriggerHtml}
          <button class="block-mini-icon" type="button" data-action="send-chat" data-tooltip="Send to chat" data-tooltip-pos="top">
            ${chatDispatchIconSvg}
          </button>
          <button class="block-mini-icon" type="button" data-action="cmd" data-tooltip="AI rewrite" data-tooltip-pos="top">
            ${aiSparkleIconSvg}
          </button>
          <button class="block-mini-icon" type="button" data-action="tourney" data-tooltip="3 Angles" data-tooltip-pos="left">
            ${tourneyIconSvg}
          </button>
        </div>
      `;
    }

    hoverPill.addEventListener('mousedown', (e) => {
      if (e.target.closest('[data-action="drag-handle"]')) return;
      e.stopPropagation();
    });

    hoverPill.querySelector('[data-action="comment"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const selText = window.getSelection()?.toString().trim() || '';
      openCommentPopoverForBlock(block.id, e.currentTarget, selText);
    });
    hoverPill.querySelector('[data-action="send-chat"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const selText = window.getSelection()?.toString().trim() || '';
      openSendToChatPopover(block.id, selText);
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

    if (isEditor && !isEditing) {
      const dragHandle = hoverPill.querySelector('[data-action="drag-handle"]');
      if (dragHandle) {
        dragHandle.addEventListener('dragstart', (e) => {
          state.draggedBlockId = block.id;
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', block.id);
          }
          requestAnimationFrame(() => article.classList.add('is-dragging'));
        });
        dragHandle.addEventListener('dragend', () => {
          state.draggedBlockId = null;
          document.querySelectorAll('.doc-block.is-dragging, .doc-block.drop-target-above, .doc-block.drop-target-below').forEach((el) => {
            el.classList.remove('is-dragging', 'drop-target-above', 'drop-target-below');
          });
        });
      }

      article.addEventListener('dragover', (e) => {
        if (!state.draggedBlockId || state.draggedBlockId === block.id) return;
        e.preventDefault();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'move';
        }
        const rect = article.getBoundingClientRect();
        const isAbove = e.clientY < rect.top + rect.height / 2;
        article.classList.toggle('drop-target-above', isAbove);
        article.classList.toggle('drop-target-below', !isAbove);
      });

      article.addEventListener('dragleave', (e) => {
        if (!article.contains(e.relatedTarget)) {
          article.classList.remove('drop-target-above', 'drop-target-below');
        }
      });

        article.addEventListener('drop', (e) => {
          if (!state.draggedBlockId || state.draggedBlockId === block.id) return;
          e.preventDefault();
          const draggedId = state.draggedBlockId;
          state.draggedBlockId = null;
          const rect = article.getBoundingClientRect();
          const placeBefore = e.clientY < rect.top + rect.height / 2;
          article.classList.remove('drop-target-above', 'drop-target-below');
          reorderBlockByDrag(draggedId, block.id, placeBefore);
        });
      }

      article.appendChild(hoverPill);
    }

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
        if (block.diff) {
          block.diff = null;
          article.querySelector('.block-diff-card')?.remove();
        }
        autoResizeBlockTextarea(ta);
        if (/^(#{1,6})\s+/.test(block.raw)) {
          block.type = 'heading';
          block.level = block.raw.match(/^(#{1,6})\s+/)[1].length;
          article.dataset.type = 'heading';
          article.dataset.level = String(block.level);
        }
        state.spans = state.spans.filter((s) => s.blockId !== block.id || isSpanSliceValidForBlock(block, s));
        scheduleTypingHistorySnapshot(`Edited L${block.startLine}`);
        scheduleDebouncedSync('user', `Edited block #${blockIdx + 1}`);
      });

      ta.addEventListener('keydown', (e) => {
        handleBlockKeydown(e, block, blockIdx, ta);
      });

      surface.appendChild(ta);
      setTimeout(() => autoResizeBlockTextarea(ta), 0);
    } else if (block.diff?.isInsertion) {
      surface.hidden = true;
      surface.classList.add('hidden');
    } else {
      surface.innerHTML = renderBlockWithAmbientSpans(block);
    }

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
        if (isReader) {
          chk.disabled = true;
          return;
        }
        chk.addEventListener('click', (e) => {
          e.stopPropagation();
          const lineIdx = Number(chk.dataset.lineIdx);
          const rawLines = block.raw.split('\n');
          if (lineIdx >= 0 && lineIdx < rawLines.length) {
            recordHistorySnapshot(`Before toggling task on L${block.startLine + lineIdx}`);
            rawLines[lineIdx] = rawLines[lineIdx].replace(
              /^(\s*(?:[-*+]|\d+\.)\s+\[)([ xX])(\]\s+)/,
              (_, pre, cur, post) => `${pre}${cur.toLowerCase() === 'x' ? ' ' : 'x'}${post}`
            );
            block.raw = rawLines.join('\n');
            block.diff = null;
            recordHistorySnapshot(`Toggled task on L${block.startLine + lineIdx}`);
            renderCanvas();
            syncDocumentToDisk('user', `Toggled task list item`, { immediate: true, forceRender: true });
          }
        });
      });

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
          const caretOffset = computeRawCaretOffsetFromClick(surface, block, e);
          enterBlockEditMode(block.id, e.clientX, e.clientY, caretOffset);
        }
      });
    }

    article.appendChild(surface);

    if (isReviewer && Array.isArray(block.reviews) && block.reviews.length > 0) {
      article.appendChild(createReviewThreadCard(block));
    }

    if (block.busy && block.busyLabel) {
      const busyBanner = document.createElement('div');
      busyBanner.className = 'block-busy-banner';
      busyBanner.innerHTML = `
        <div class="block-busy-banner-main">
          <span class="busy-spinner"></span>
          <span>${escapeHtml(block.busyLabel)}</span>
        </div>
        <button class="btn-secondary block-busy-cancel-btn" type="button" data-action="cancel-ai" title="Cancel in-flight AI request">✕ Cancel</button>
      `;
      busyBanner.querySelector('[data-action="cancel-ai"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        cancelBlockAiRequest(block.id, () => {
          updateHeaderTelemetry();
          renderCanvas();
        });
      });
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

  const hasOnlyFrontmatter =
    state.blocks.length > 0 && state.blocks.every((b) => b.type === 'frontmatter');
  if (!isReader && (state.blocks.length === 0 || hasOnlyFrontmatter)) {
    const emptyBlockPrompt = document.createElement('div');
    emptyBlockPrompt.className = 'doc-empty-placeholder';
    emptyBlockPrompt.textContent = hasOnlyFrontmatter
      ? 'No body text yet — click here to start writing below frontmatter…'
      : 'Empty file — click here to start writing Markdown…';
    emptyBlockPrompt.addEventListener('click', (e) => {
      e.stopPropagation();
      const newId = `b-${state.blocks.length}-${Date.now().toString(36)}`;
      const lastLine =
        state.blocks.length > 0 ? state.blocks[state.blocks.length - 1].endLine + 1 : 1;
      state.blocks.push({
        id: newId,
        type: 'paragraph',
        level: 0,
        raw: '',
        startLine: lastLine,
        endLine: lastLine,
        trailingBlankLines: 1,
        reviews: [],
        diff: null,
        tournament: null,
        busy: false,
      });
      recomputeBlockLineNumbers();
      enterBlockEditMode(newId, undefined, undefined, 0);
    });
    canvasEl.appendChild(emptyBlockPrompt);
  }

  if (showDiagnostics) {
    bindLensSpanHoverEvents();
  }
}

export function reorderBlockByDrag(fromBlockId, toBlockId, placeBefore) {
  if (!fromBlockId || !toBlockId || fromBlockId === toBlockId) return;
  const fromIdx = state.blocks.findIndex((b) => b.id === fromBlockId);
  const toIdx = state.blocks.findIndex((b) => b.id === toBlockId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;

  recordHistorySnapshot(`Before reordering L${state.blocks[fromIdx].startLine}`);
  const [movedBlock] = state.blocks.splice(fromIdx, 1);
  const adjustedTargetIdx = state.blocks.findIndex((b) => b.id === toBlockId);
  const insertIdx = placeBefore ? adjustedTargetIdx : adjustedTargetIdx + 1;
  state.blocks.splice(insertIdx, 0, movedBlock);
  recomputeBlockLineNumbers();
  recordHistorySnapshot(`Reordered block to L${movedBlock.startLine}`);
  renderCanvas();
  syncDocumentToDisk('user', `Reordered block to L${movedBlock.startLine}`, { immediate: true, forceRender: true });
}

export function computeRawCaretOffsetFromClick(surfaceEl, block, clickEvent) {
  if (!surfaceEl || !block || typeof block.raw !== 'string' || !clickEvent) {
    return undefined;
  }

  let hitNode = null;
  let hitOffset = 0;

  if (typeof document.caretRangeFromPoint === 'function') {
    const range = document.caretRangeFromPoint(clickEvent.clientX, clickEvent.clientY);
    if (range) {
      hitNode = range.startContainer;
      hitOffset = range.startOffset;
    }
  } else if (typeof document.caretPositionFromPoint === 'function') {
    const pos = document.caretPositionFromPoint(clickEvent.clientX, clickEvent.clientY);
    if (pos) {
      hitNode = pos.offsetNode;
      hitOffset = pos.offset;
    }
  }

  if (!hitNode || !surfaceEl.contains(hitNode)) {
    return undefined;
  }

  let visibleCharsBefore = 0;
  let foundTarget = false;

  const walker = document.createTreeWalker(surfaceEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parentEl = node.parentElement;
      if (!parentEl) return NodeFilter.FILTER_REJECT;
      if (
        parentEl.closest('.md-image-error') ||
        parentEl.closest('.code-lang-pill') ||
        parentEl.closest('.alert-title') ||
        parentEl.closest('[hidden]')
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  if (hitNode.nodeType === Node.TEXT_NODE) {
    let curr = walker.nextNode();
    while (curr) {
      if (curr === hitNode) {
        visibleCharsBefore += Math.min(curr.nodeValue.length, Math.max(0, hitOffset));
        foundTarget = true;
        break;
      }
      visibleCharsBefore += curr.nodeValue.length;
      curr = walker.nextNode();
    }
  } else if (hitNode.nodeType === Node.ELEMENT_NODE) {
    const childTarget = hitNode.childNodes[hitOffset] || null;
    let curr = walker.nextNode();
    while (curr) {
      if (childTarget && (curr === childTarget || childTarget.contains(curr))) {
        foundTarget = true;
        break;
      }
      visibleCharsBefore += curr.nodeValue.length;
      curr = walker.nextNode();
    }
  }

  if (!foundTarget) {
    return undefined;
  }

  return mapVisibleOffsetToRawOffset(block.raw, block.type, visibleCharsBefore);
}

function mapVisibleOffsetToRawOffset(raw, blockType, targetVisibleOffset) {
  if (!raw || targetVisibleOffset <= 0) {
    const leadMatch = raw.match(/^(?:#{1,6}\s+|\s*>\s?(?:\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*)?|\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?)/i);
    return leadMatch ? leadMatch[0].length : 0;
  }

  if (blockType === 'code') {
    const firstNewline = raw.indexOf('\n');
    const bodyStart = firstNewline >= 0 ? firstNewline + 1 : 0;
    return Math.min(raw.length, bodyStart + targetVisibleOffset);
  }

  let visCount = 0;
  let i = 0;
  const len = raw.length;
  let atLineStart = true;

  while (i < len) {
    if (atLineStart) {
      atLineStart = false;
      const lineRest = raw.slice(i);
      const prefixMatch = lineRest.match(
        /^(?:#{1,6}\s+|\s*>\s?(?:\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?)?|\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?)/i
      );
      if (prefixMatch) {
        i += prefixMatch[0].length;
        if (visCount >= targetVisibleOffset) return i;
        continue;
      }
    }

    if (raw[i] === '\n') {
      atLineStart = true;
      if (visCount >= targetVisibleOffset) return i;
      i++;
      continue;
    }

    const rest = raw.slice(i);

    const imgMatch = rest.match(/^!\[([^\]]*)\]\((\s*\{\{[\s\S]*?\}\}\s*|(?:[^()\s]|\([^()\s]*\))+)(?:\s+"([^"]*)")?\)/);
    if (imgMatch) {
      i += imgMatch[0].length;
      continue;
    }

    const linkMatch = rest.match(/^\[((?:`+[^`\n]*`+|[^\[\]\n])+)\]\((\s*\{\{[\s\S]*?\}\}\s*|(?:[^()\s]|\([^()\s]*\))+)(?:\s+"([^"]*)")?\)/);
    if (linkMatch) {
      const fullLen = linkMatch[0].length;
      const label = linkMatch[1];
      i++;
      for (let k = 0; k < label.length; k++) {
        if (visCount >= targetVisibleOffset) return i;
        if (label[k] !== '`') {
          visCount++;
        }
        i++;
      }
      if (visCount >= targetVisibleOffset) return i;
      i += fullLen - 1 - label.length;
      continue;
    }

    const codeMatch = rest.match(/^(`+)([^`\n]+)\1/);
    if (codeMatch) {
      const ticksLen = codeMatch[1].length;
      const bodyLen = codeMatch[2].length;
      i += ticksLen;
      for (let k = 0; k < bodyLen; k++) {
        if (visCount >= targetVisibleOffset) return i;
        visCount++;
        i++;
      }
      if (visCount >= targetVisibleOffset) return i;
      i += ticksLen;
      continue;
    }

    const delimMatch = rest.match(/^(\*\*\*|\*\*|__|~~|\*|_)/);
    if (delimMatch) {
      i += delimMatch[0].length;
      continue;
    }

    if (visCount >= targetVisibleOffset) {
      return i;
    }

    visCount++;
    i++;
  }

  return len;
}

export function enterBlockEditMode(blockId, _clientX = undefined, _clientY = undefined, caretOffset = undefined) {
  if (state.studioMode !== 'editor') {
    setStudioMode('editor');
  }
  if (state.activeBlockId && state.activeBlockId !== blockId) {
    exitBlockEditMode(state.activeBlockId, true);
  }
  hideLensPopover();
  closeCommentPopover();
  recordHistorySnapshot('Before block edit');
  const targetBlock = state.blocks.find((b) => b.id === blockId);
  state.activeBlockId = blockId;
  state.highlightedBlockId = blockId;
  state.activeBlockOriginalRaw = targetBlock ? targetBlock.raw : null;
  renderCanvas();
  const ta = document.querySelector(`.block-editor-textarea[data-block-id="${blockId}"]`);
  if (!ta) return;
  autoResizeBlockTextarea(ta);
  ta.focus();
  const pos = typeof caretOffset === 'number' ? Math.min(ta.value.length, Math.max(0, caretOffset)) : ta.value.length;
  ta.setSelectionRange(pos, pos);
}

export function exitBlockEditMode(blockId, syncToDisk = true) {
  if (state.activeBlockId !== blockId) return;
  const idx = state.blocks.findIndex((b) => b.id === blockId);
  const cur = idx !== -1 ? state.blocks[idx] : null;
  const hasChanged = Boolean(
    cur && (state.activeBlockOriginalRaw === null || cur.raw !== state.activeBlockOriginalRaw || runtime.syncDebounceTimer)
  );
  if (hasChanged) {
    flushPendingHistorySnapshot('Edited block');
  }
  state.activeBlockId = null;
  state.activeBlockOriginalRaw = null;

  if (idx !== -1 && cur) {
    const rep = parseDocumentIntoBlocks(cur.raw);
    if (rep.length === 0) {
      state.blocks.splice(idx, 1);
    } else {
      rep[0].id = cur.id;
      rep[0].busy = cur.busy;
      rep[0].busyLabel = cur.busyLabel;
      rep[0].diff = cur.diff;
      rep[0].tournament = cur.tournament;
      if (idx === 0 && typeof cur.leadingBlankLines === 'number') {
        rep[0].leadingBlankLines = cur.leadingBlankLines;
      }
      rep[rep.length - 1].reviews = cur.reviews || [];
      rep[rep.length - 1].trailingBlankLines =
        typeof cur.trailingBlankLines === 'number' && cur.trailingBlankLines >= 0 ? cur.trailingBlankLines : 1;
      state.blocks.splice(idx, 1, ...rep);
    }
  }
  recomputeBlockLineNumbers();
  renderCanvas();
  if (syncToDisk && hasChanged) {
    syncDocumentToDisk('user', 'Edited block', { immediate: true });
  }
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
    if (!state.filePath) {
      openSaveDraftPrompt();
    } else {
      syncDocumentToDisk('user', 'Saved', { immediate: true, forceRender: true });
    }
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
      id: `b-${blockIdx + 1}-${Date.now().toString(36)}`,
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

function applyBlockDiffAccept(block) {
  const idx = state.blocks.findIndex((b) => b.id === block.id);
  if (idx === -1 || !block.diff) return false;
  const diffObj = block.diff;
  if (diffObj.isDeletion) {
    state.blocks.splice(idx, 1);
  } else if (diffObj.isInsertion) {
    block.diff = null;
    if (Array.isArray(diffObj.newReviews)) {
      block.reviews = diffObj.newReviews;
    }
  } else {
    const rep = parseDocumentIntoBlocks(diffObj.newRaw);
    if (rep.length === 0) {
      state.blocks.splice(idx, 1);
    } else {
      rep[0].id = block.id;
      if (idx === 0 && typeof block.leadingBlankLines === 'number') {
        rep[0].leadingBlankLines = block.leadingBlankLines;
      }
      const nextReviews = Array.isArray(diffObj.newReviews) ? diffObj.newReviews : (block.reviews || []);
      rep[rep.length - 1].reviews = nextReviews;
      rep[rep.length - 1].trailingBlankLines =
        typeof block.trailingBlankLines === 'number' && block.trailingBlankLines >= 0 ? block.trailingBlankLines : 1;
      state.blocks.splice(idx, 1, ...rep);
    }
  }
  state.spans = state.spans.filter((s) => s.blockId !== block.id);
  return true;
}

function applyBlockDiffReject(block) {
  const idx = state.blocks.findIndex((b) => b.id === block.id);
  if (idx === -1 || !block.diff) return false;
  const diffObj = block.diff;
  if (diffObj.isInsertion) {
    state.blocks.splice(idx, 1);
  } else {
    if (Array.isArray(diffObj.oldReviews)) {
      block.reviews = diffObj.oldReviews;
    }
    block.diff = null;
  }
  return true;
}

export function createInlineDiffCard(block, diffObj) {
  const card = document.createElement('div');
  card.className = 'block-diff-card';
  const diffHtml = computeWordDiffHtml(diffObj.oldRaw, diffObj.newRaw);
  const totalPendingDiffs = state.blocks.filter((b) => Boolean(b.diff)).length;
  const batchButtonsHtml =
    totalPendingDiffs > 1
      ? `<button class="btn-secondary" type="button" data-action="accept-all" title="Accept all ${totalPendingDiffs} pending changes">Accept All (${totalPendingDiffs})</button>
         <button class="btn-secondary" type="button" data-action="reject-all" title="Reject all ${totalPendingDiffs} pending changes">Reject All</button>`
      : '';
  card.innerHTML = `
    <div class="diff-card-header">
      <span class="diff-source-badge">${escapeHtml(diffObj.source || '✨ AI Proposal')}</span>
      <div class="diff-actions">
        <button class="btn-success" type="button" data-action="accept">${escapeHtml(diffObj.acceptLabel || 'Accept')}</button>
        <button class="btn-secondary" type="button" data-action="reject">${escapeHtml(diffObj.rejectLabel || 'Reject')}</button>
        ${batchButtonsHtml}
      </div>
    </div>
    <div class="diff-prose-body">${diffHtml}</div>
  `;

  card.querySelector('[data-action="accept"]').addEventListener('click', (e) => {
    e.stopPropagation();
    recordHistorySnapshot(`Before accepting edit on ${block.id}`);
    applyBlockDiffAccept(block);
    recomputeBlockLineNumbers();
    recordHistorySnapshot(`Accepted edit on ${block.id}`);
    updateHeaderTelemetry();
    renderCanvas();
    syncDocumentToDisk('fix', `Accepted edit on ${block.id}`, { immediate: true, forceRender: true });
  });

  card.querySelector('[data-action="reject"]').addEventListener('click', (e) => {
    e.stopPropagation();
    recordHistorySnapshot(`Before rejecting edit on ${block.id}`);
    applyBlockDiffReject(block);
    recomputeBlockLineNumbers();
    recordHistorySnapshot(`Rejected edit on ${block.id}`);
    updateHeaderTelemetry();
    renderCanvas();
    if (diffObj.fromDisk !== false) {
      syncDocumentToDisk('user', `Rejected edit on ${block.id}`, { immediate: true, forceRender: true });
    } else {
      setSyncStatus(state.filePath ? 'synced' : 'idle', 'Rejected AI proposal');
    }
  });

  const acceptAllBtn = card.querySelector('[data-action="accept-all"]');
  if (acceptAllBtn) {
    acceptAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      recordHistorySnapshot('Before accepting all edits');
      const pending = state.blocks.filter((b) => Boolean(b.diff));
      for (const b of pending) {
        applyBlockDiffAccept(b);
      }
      recomputeBlockLineNumbers();
      recordHistorySnapshot('Accepted all edits');
      updateHeaderTelemetry();
      renderCanvas();
      syncDocumentToDisk('fix', 'Accepted all edits', { immediate: true, forceRender: true });
    });
  }

  const rejectAllBtn = card.querySelector('[data-action="reject-all"]');
  if (rejectAllBtn) {
    rejectAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      recordHistorySnapshot('Before rejecting all edits');
      const pending = state.blocks.filter((b) => Boolean(b.diff));
      const anyFromDisk = pending.some((b) => b.diff && b.diff.fromDisk !== false);
      for (const b of pending) {
        applyBlockDiffReject(b);
      }
      recomputeBlockLineNumbers();
      recordHistorySnapshot('Rejected all edits');
      updateHeaderTelemetry();
      renderCanvas();
      if (anyFromDisk) {
        syncDocumentToDisk('user', 'Rejected all edits', { immediate: true, forceRender: true });
      } else {
        setSyncStatus(state.filePath ? 'synced' : 'idle', 'Rejected AI proposals');
      }
    });
  }

  return card;
}

export function createTournamentCard(block) {
  const tourney = block.tournament;
  const card = document.createElement('div');
  card.className = 'block-tournament-card';

  const modelBadge = tourney.model ? ` · ${tourney.model}` : '';
  const header = document.createElement('div');
  header.className = 'tourney-card-header';
  header.innerHTML = `
    <span class="diff-source-badge" title="Click sentences from any angle to combine them into a composite paragraph">✨ 3 Angles${escapeHtml(modelBadge)}</span>
    <div class="diff-actions">
      <button class="btn-secondary" type="button" data-action="regenerate-tourney" title="Generate 3 fresh variant angles">↻</button>
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
    block.diff = null;
    block.tournament = null;
    state.spans = state.spans.filter((s) => s.blockId !== block.id);
    recomputeBlockLineNumbers();
    recordHistorySnapshot(`Accepted Variant Tournament on ${block.id}`);
    updateHeaderTelemetry();
    renderCanvas();
    syncDocumentToDisk('fix', `Accepted Variant Tournament on ${block.id}`, { immediate: true, forceRender: true });
  });

  header.querySelector('[data-action="cancel-tourney"]').addEventListener('click', (e) => {
    e.stopPropagation();
    block.tournament = null;
    renderCanvas();
  });

  return card;
}

export function applySpanInstantReplacement(span) {
  const block = state.blocks.find((b) => b.id === span.blockId);
  if (!block) {
    showError(`Cannot apply fix (${span.rule}): target block ${span.blockId} not found in memory.`);
    return;
  }

  recordHistorySnapshot(`Before fix (${span.rule})`);
  block.diff = null;

  if (span.isWholeBlockReplacement) {
    block.raw = span.replacement;
    state.spans = state.spans.filter((s) => s.blockId !== span.blockId);
  } else {
    let startOffset = span.startOffset;
    let endOffset = span.endOffset;
    const expectedMatch = String(span.match || '');
    if (
      expectedMatch &&
      block.raw.slice(startOffset, endOffset).toLowerCase() !== expectedMatch.toLowerCase()
    ) {
      const relocated = locateAlertSpanInBlock(block, null, expectedMatch, null);
      if (!relocated) {
        showError(
          `Cannot apply fix (${span.rule}): "${expectedMatch}" is no longer at the expected position in this block.`
        );
        return;
      }
      startOffset = relocated.startOffset;
      endOffset = relocated.endOffset;
    }

    const rep = String(span.replacement ?? '');
    let spliceStart = startOffset;
    let spliceEnd = endOffset;
    if (rep === '') {
      if (spliceStart > 0 && block.raw[spliceStart - 1] === ' ' && block.raw[spliceEnd] === ' ') {
        spliceEnd += 1;
      } else if (spliceStart === 0 && block.raw[spliceEnd] === ' ') {
        spliceEnd += 1;
      } else if (
        spliceEnd === block.raw.length &&
        spliceStart > 0 &&
        block.raw[spliceStart - 1] === ' '
      ) {
        spliceStart -= 1;
      }
    }

    const before = block.raw.slice(0, spliceStart);
    const after = block.raw.slice(spliceEnd);
    block.raw = `${before}${rep}${after}`;

    const delta = rep.length - (spliceEnd - spliceStart);
    const updatedSpans = [];
    for (const s of state.spans) {
      if (s.id === span.id) continue;
      if (s.blockId !== block.id) {
        updatedSpans.push(s);
        continue;
      }
      if (s.isWholeBlockReplacement) continue;
      if (s.endOffset <= spliceStart) {
        if (isSpanSliceValidForBlock(block, s)) {
          updatedSpans.push(s);
        }
      } else if (s.startOffset >= spliceEnd) {
        s.startOffset += delta;
        s.endOffset += delta;
        if (isSpanSliceValidForBlock(block, s)) {
          updatedSpans.push(s);
        }
      }
    }
    state.spans = updatedSpans;
  }

  recomputeBlockLineNumbers();
  state.metrics.words = countWordsInText(serializeBlocksToMarkdown(state.blocks));
  recordHistorySnapshot(`Applied fix (${span.rule})`);
  updateHeaderTelemetry();
  renderCanvas();
  syncDocumentToDisk('fix', `Applied fix (${span.rule})`, { immediate: true, forceRender: true });
}
