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
// Comment Popup Window (#comment-popover) & Reviewer Inline Threads (<!-- review: ... -->)
// ---------------------------------------------------------------------------

import { state, setHidden, escapeHtml } from './state.js';
import {
  recomputeBlockLineNumbers,
  getTotalReviewComments,
  recordHistorySnapshot,
} from './markdown.js';
import { updateHeaderTelemetry } from './popovers.js';
import { renderCanvas } from './canvas.js';
import {
  sendContextToMainChat,
  sendAnnotatedReviewFileToChat,
  openReviewResolutionPrompt,
} from './ai.js';
import { syncDocumentToDisk } from './sync.js';

export function positionCommentPopoverNear(anchorEl) {
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

export function closeCommentPopover() {
  state.activeCommentBlockId = null;
  state.editingCommentId = null;
  state.pendingCommentQuote = '';
  setHidden('comment-popover', true);
}

export function openCommentPopoverForBlock(blockId, anchorEl = null, quoteText = '', editReviewId = null) {
  const block = state.blocks.find((b) => b.id === blockId);
  if (!block) return;

  state.activeCommentBlockId = blockId;
  state.editingCommentId = editReviewId;
  state.pendingCommentQuote = quoteText || '';

  renderCommentPopover(block, anchorEl);
}

export function renderCommentPopover(block, anchorEl = null) {
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

  for (const rev of reviews) {
    const item = document.createElement('div');
    item.className = 'comment-popover-item';
    item.innerHTML = `
      <div class="comment-popover-item-head">
        <span>💬 Comment${rev.ts ? ` · ${escapeHtml(rev.ts)}` : ''}</span>
        <div style="display:flex;gap:4px;">
          <button class="btn-secondary btn-chat-icon" type="button" data-action="send-existing-chat" title="Discuss passage & note in chat" style="padding:2px 6px;font-size:10px;">
            <svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
          </button>
          <button class="btn-secondary" type="button" data-action="resolve-ai-single" title="Resolve this comment with AI (prompt + diff)" style="padding:2px 6px;font-size:10px;">✨ AI</button>
          <button class="btn-primary" type="button" data-action="save-existing" style="padding:2px 7px;font-size:10px;">Save</button>
          <button class="btn-success" type="button" data-action="resolve-existing" style="padding:2px 7px;font-size:10px;">Resolve</button>
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
      syncDocumentToDisk('user', `Updated review comment on L${block.startLine}`, { immediate: true, forceRender: true });
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
      syncDocumentToDisk('user', `Cleared quote on L${block.startLine}`, { immediate: true, forceRender: true });
    });

    item.querySelector('[data-action="send-existing-chat"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const noteText = ta.value.trim() || rev.text || '';
      sendContextToMainChat(block, noteText, rev.quote || '');
      closeCommentPopover();
    });

    item.querySelector('[data-action="resolve-ai-single"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const noteText = ta.value.trim();
      if (noteText && noteText !== rev.text) {
        rev.text = noteText;
      }
      openReviewResolutionPrompt(block.id, rev.id);
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
      syncDocumentToDisk('user', `Resolved review comment on L${block.startLine}`, { immediate: true, forceRender: true });
    });

    bodyEl.appendChild(item);
  }

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
    <textarea id="comment-popover-new-input" class="review-comment-input" rows="2" placeholder="Add a note (saved on disk, or send to chat)…"></textarea>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
      <button class="btn-secondary" type="button" data-action="close-pop">Close</button>
      <div style="display:flex;align-items:center;gap:6px;">
        <button class="btn-secondary btn-chat-icon" type="button" data-action="send-comment-chat" title="Send passage & note to chat (⇧⌘Enter)">
          <svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
          <span>Chat</span>
        </button>
        <button class="btn-primary" type="button" data-action="add-new-comment" title="Save comment to Markdown file (⌘Enter)">Add Comment</button>
      </div>
    </div>
  `;

  const newTa = composer.querySelector('#comment-popover-new-input');

  composer.querySelector('[data-action="clear-new-quote"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    state.pendingCommentQuote = '';
    renderCommentPopover(block);
  });

  const sendTypedCommentToChat = () => {
    const text = newTa.value.trim();
    const quote = state.pendingCommentQuote || '';
    state.pendingCommentQuote = '';
    sendContextToMainChat(block, text, quote);
    closeCommentPopover();
  };

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
    syncDocumentToDisk('user', `Added review comment on L${block.startLine}`, { immediate: true, forceRender: true });
  };

  newTa.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      sendTypedCommentToChat();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      addNewComment();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeCommentPopover();
    }
  });

  composer.querySelector('[data-action="send-comment-chat"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    sendTypedCommentToChat();
  });

  composer.querySelector('[data-action="add-new-comment"]').addEventListener('click', (e) => {
    e.stopPropagation();
    addNewComment();
  });

  composer.querySelector('[data-action="close-pop"]').addEventListener('click', (e) => {
    e.stopPropagation();
    closeCommentPopover();
  });

  const totalDocReviews = getTotalReviewComments();
  if (totalDocReviews > 0) {
    const batchBar = document.createElement('div');
    batchBar.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;gap:6px;padding-top:8px;margin-top:6px;border-top:1px solid var(--border-col);';
    batchBar.innerHTML = `
      <span style="font-size:10.5px;color:var(--text-muted);">${totalDocReviews} comment${totalDocReviews === 1 ? '' : 's'} in file</span>
      <div style="display:flex;align-items:center;gap:6px;">
        <button class="btn-secondary btn-chat-icon" type="button" data-action="pop-send-chat" title="Send all file comments to main chat" style="padding:3px 8px;font-size:10.5px;">
          <svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
          <span>${totalDocReviews}</span>
        </button>
        <button class="btn-primary" type="button" data-action="pop-resolve-ai" title="Resolve comments with AI (prompt + individual diffs)" style="padding:3px 8px;font-size:10.5px;">✨ Resolve (${totalDocReviews})</button>
      </div>
    `;
    batchBar.querySelector('[data-action="pop-send-chat"]').addEventListener('click', (e) => {
      e.stopPropagation();
      sendAnnotatedReviewFileToChat();
    });
    batchBar.querySelector('[data-action="pop-resolve-ai"]').addEventListener('click', (e) => {
      e.stopPropagation();
      openReviewResolutionPrompt();
    });
    composer.appendChild(batchBar);
  }

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

export function createReviewThreadCard(block) {
  const wrap = document.createElement('div');
  wrap.className = 'block-review-thread';

  const reviews = Array.isArray(block.reviews) ? block.reviews : [];
  for (const rev of reviews) {
    const item = document.createElement('div');
    item.className = 'review-comment-card';
    item.innerHTML = `
      <div class="review-comment-head">
        <span>💬 L${block.startLine}${rev.ts ? ` · ${escapeHtml(rev.ts)}` : ''}</span>
        <div style="display: flex; gap: 4px;">
          <button class="btn-secondary btn-chat-icon" type="button" data-action="chat-rev" title="Discuss passage & note in chat" style="padding: 2px 6px; font-size: 10px;">
            <svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
          </button>
          <button class="btn-secondary" type="button" data-action="ai-rev" title="Resolve this comment with AI (prompt + diff)" style="padding: 2px 6px; font-size: 10px;">✨ AI</button>
          <button class="btn-secondary" type="button" data-action="edit-rev" style="padding: 2px 6px; font-size: 10px;">Edit</button>
          <button class="btn-success" type="button" data-action="resolve-rev" style="padding: 2px 6px; font-size: 10px;">Resolve</button>
        </div>
      </div>
      ${rev.quote ? `<div class="review-quote-pill">“${escapeHtml(rev.quote)}”</div>` : ''}
      <div class="review-comment-body">${escapeHtml(rev.text)}</div>
    `;

    item.querySelector('[data-action="chat-rev"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      sendContextToMainChat(block, rev.text || '', rev.quote || '');
    });

    item.querySelector('[data-action="ai-rev"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openReviewResolutionPrompt(block.id, rev.id);
    });

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
      syncDocumentToDisk('user', `Resolved review comment on L${block.startLine}`, { immediate: true, forceRender: true });
    });

    wrap.appendChild(item);
  }

  return wrap;
}
