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
// In-Panel AI Rewrites, 3-Angle Variant Tournament, Chat Dispatch & Block Alignment
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
  clearError,
} from './state.js';
import {
  apiPost,
  registerBlockAbortController,
  linkBlockAbortController,
  clearBlockAbortController,
} from './api.js';
import {
  parseDocumentIntoBlocks,
  serializeBlocksToMarkdown,
  recomputeBlockLineNumbers,
  getTotalReviewComments,
  recordHistorySnapshot,
} from './markdown.js';
import {
  getEditorialRuleExplanation,
  computeBlockDiagnostics,
  buildAmbientSpansFromAudit,
} from './diagnostics.js';
import {
  updateHeaderTelemetry,
  closeAllPopovers,
  toggleSettingsPopover,
} from './popovers.js';
import { closeCommentPopover } from './comments.js';
import { renderCanvas, exitBlockEditMode } from './canvas.js';
import { syncDocumentToDisk } from './sync.js';

const AI_REQUEST_TIMEOUT_MS = 30_000;

export function openReviewResolutionPrompt(blockId = null, reviewId = null) {
  const input = document.getElementById('cmd-input');
  const scopeBadge = document.getElementById('cmd-scope-badge');
  const titleLabel = document.getElementById('cmd-title-label');
  const submitBtn = document.getElementById('btn-cmd-submit');
  const previewEl = document.getElementById('cmd-context-preview');
  const iconAi = document.getElementById('cmd-title-icon-ai');
  const iconChat = document.getElementById('cmd-title-icon-chat');
  if (!input) return;

  const targetBlocks = state.blocks.filter((b) => {
    if (!Array.isArray(b.reviews) || b.reviews.length === 0) return false;
    if (blockId && b.id !== blockId) return false;
    if (reviewId && !b.reviews.some((r) => r.id === reviewId)) return false;
    return true;
  });

  if (targetBlocks.length === 0) return;

  closeCommentPopover();
  closeAllPopovers();

  state.cmdOpen = true;
  state.cmdMode = 'reviews';
  state.cmdSkill = 'readability';
  state.cmdBlockId = blockId || null;
  state.cmdReviewId = reviewId || null;
  state.cmdSelectedText = '';

  document.getElementById('btn-send-review-agent')?.classList.add('active');
  setHidden(iconAi, false);
  setHidden(iconChat, true);

  let totalTargetReviews = 0;
  const reviewItemsHtml = [];
  for (const b of targetBlocks) {
    const revs = reviewId ? b.reviews.filter((r) => r.id === reviewId) : b.reviews;
    for (const r of revs) {
      totalTargetReviews++;
      const quoteChip = r.quote ? ` (<code>"${escapeHtml(r.quote.length > 28 ? `${r.quote.slice(0, 28)}…` : r.quote)}"</code>)` : '';
      reviewItemsHtml.push(
        `<li><strong>L${b.startLine}–${b.endLine}</strong>${quoteChip}: ${escapeHtml(r.text)}</li>`
      );
    }
  }

  if (titleLabel) {
    titleLabel.textContent = 'Resolve Comments with AI';
  }
  if (submitBtn) {
    submitBtn.textContent = targetBlocks.length > 1 ? `✨ Resolve (${targetBlocks.length})` : '✨ Resolve';
    submitBtn.setAttribute('data-tooltip', 'Resolve comments with AI');
  }
  if (scopeBadge) {
    scopeBadge.textContent =
      targetBlocks.length === 1
        ? `L${targetBlocks[0].startLine}–${targetBlocks[0].endLine} (${totalTargetReviews})`
        : `${totalTargetReviews} comment${totalTargetReviews === 1 ? '' : 's'} · ${targetBlocks.length} blocks`;
  }

  if (previewEl) {
    setHidden(previewEl, false);
    previewEl.innerHTML = `
      <div class="cmd-context-preview-head">
        <span>Comments to Resolve (${totalTargetReviews})</span>
        <span>Proposes per-block rewrites (Accept / Reject)</span>
      </div>
      <ul class="cmd-context-findings">${reviewItemsHtml.slice(0, 6).join('')}${
        reviewItemsHtml.length > 6 ? `<li>…and ${reviewItemsHtml.length - 6} more comment(s)</li>` : ''
      }</ul>
    `;
  }

  setHidden('cmd-palette', false);
  input.placeholder = 'Describe how to resolve these comments…';
  input.value = 'Address each reviewer comment while preserving technical accuracy and author voice.';
  setTimeout(() => {
    input.focus();
    input.select();
  }, 10);
}

export async function dispatchReviewCommentsToAgent(options = {}) {
  if (state.reviewDispatchConfirmation) return;

  const customInstruction = typeof options === 'string' ? options.trim() : (options.instruction || '').trim();
  const filterBlockId = typeof options === 'object' && options !== null ? options.blockId || null : null;
  const filterReviewId = typeof options === 'object' && options !== null ? options.reviewId || null : null;

  const targetBlocksInfo = [];
  let totalTargetReviews = 0;

  for (const b of state.blocks) {
    if (!Array.isArray(b.reviews) || b.reviews.length === 0) continue;
    if (filterBlockId && b.id !== filterBlockId) continue;
    const allReviews = b.reviews.map((r) => ({ ...r }));
    const resolvedReviews = filterReviewId
      ? allReviews.filter((r) => r.id === filterReviewId)
      : allReviews;
    if (resolvedReviews.length === 0) continue;
    const remainingReviews = filterReviewId
      ? allReviews.filter((r) => r.id !== filterReviewId)
      : [];
    totalTargetReviews += resolvedReviews.length;
    targetBlocksInfo.push({
      id: b.id,
      startLine: b.startLine,
      endLine: b.endLine,
      type: b.type,
      raw: b.raw,
      reviews: resolvedReviews,
      allReviews,
      remainingReviews,
      telemetry: buildParagraphContextTelemetryMarkdown(b),
    });
  }

  if (targetBlocksInfo.length === 0) return;

  if (!state.aiSettings?.configured) {
    toggleSettingsPopover(true, 'general');
    showError(
      'Configure Vertex AI Project ID or Gemini API Key in Settings (⚙️) to resolve review comments with AI.'
    );
    return;
  }

  closeCommentPopover();
  closeAllPopovers();
  if (state.activeBlockId) {
    exitBlockEditMode(state.activeBlockId, false);
  }
  clearError();
  recordHistorySnapshot('Before resolving review comments with AI');

  const fullDocumentWithComments = serializeBlocksToMarkdown(state.blocks);
  const modelLabel = state.aiSettings?.model || 'gemini-3.8-flash';

  for (const info of targetBlocksInfo) {
    const liveBlock = state.blocks.find((b) => b.id === info.id);
    if (!liveBlock) continue;
    liveBlock.busy = true;
    liveBlock.busyLabel = `AI (${modelLabel}) staging diff for ${info.reviews.length} comment${info.reviews.length === 1 ? '' : 's'}…`;
  }

  if (runtime.reviewDispatchConfirmTimer) {
    clearTimeout(runtime.reviewDispatchConfirmTimer);
  }
  state.reviewDispatchConfirmation = {
    count: totalTargetReviews,
  };
  runtime.reviewDispatchConfirmTimer = setTimeout(() => {
    runtime.reviewDispatchConfirmTimer = null;
    state.reviewDispatchConfirmation = null;
    updateHeaderTelemetry();
  }, 3500);

  setSyncStatus('agent', `${modelLabel} resolving ${totalTargetReviews} comment${totalTargetReviews === 1 ? '' : 's'}…`);
  updateHeaderTelemetry();
  renderCanvas();

  const primaryBlockId = targetBlocksInfo[0]?.id || '__doc__';
  const controller = registerBlockAbortController(primaryBlockId);
  for (const info of targetBlocksInfo.slice(1)) {
    linkBlockAbortController(info.id, controller);
  }

  const effectiveInstruction =
    customInstruction ||
    `Address and resolve all ${totalTargetReviews} reviewer comment(s) on the target paragraph(s) while preserving surrounding context, technical accuracy, and the author's voice.`;

  try {
    const res = await apiPost(
      '/api/ai/rewrite',
      {
        fullDocument: fullDocumentWithComments,
        skill: 'readability',
        instruction: effectiveInstruction,
        telemetryContext: targetBlocksInfo.map((t) => t.telemetry).join('\n\n'),
        targetBlocks: targetBlocksInfo.map((t) => ({
          id: t.id,
          startLine: t.startLine,
          endLine: t.endLine,
          type: t.type,
          raw: t.raw,
          reviews: t.reviews,
        })),
      },
      { timeoutMs: AI_REQUEST_TIMEOUT_MS, signal: controller.signal }
    );

    const proposals = Array.isArray(res.proposals) ? res.proposals : [];
    const proposalById = new Map(proposals.map((p) => [p.id, p]));

    for (const info of targetBlocksInfo) {
      const liveBlock = state.blocks.find((b) => b.id === info.id);
      if (!liveBlock) continue;
      liveBlock.busy = false;
      liveBlock.busyLabel = '';
      const prop = proposalById.get(info.id);
      if (prop && typeof prop.newRaw === 'string') {
        liveBlock.diff = {
          oldRaw: liveBlock.raw,
          newRaw: prop.newRaw,
          newReviews: info.remainingReviews,
          oldReviews: info.allReviews,
          fromDisk: false,
          source: `✨ AI (${res.model || modelLabel})${prop.summary ? ` · ${prop.summary}` : ''}`,
          acceptLabel: 'Accept',
          rejectLabel: 'Reject',
        };
      }
    }

    recomputeBlockLineNumbers();
    recordHistorySnapshot('AI staged review comment proposals');
    setSyncStatus('agent', 'Review AI diffs');
    updateHeaderTelemetry();
    renderCanvas();

    const firstEl = document.querySelector(`.doc-block[data-block-id="${targetBlocksInfo[0].id}"]`);
    firstEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    if (runtime.reviewDispatchConfirmTimer) {
      clearTimeout(runtime.reviewDispatchConfirmTimer);
      runtime.reviewDispatchConfirmTimer = null;
    }
    state.reviewDispatchConfirmation = null;
    for (const info of targetBlocksInfo) {
      const liveBlock = state.blocks.find((b) => b.id === info.id);
      if (!liveBlock) continue;
      liveBlock.busy = false;
      liveBlock.busyLabel = '';
    }
    recomputeBlockLineNumbers();
    setSyncStatus('idle', 'AI Rewrite Error');
    updateHeaderTelemetry();
    renderCanvas();
    showError(`AI review comment resolution failed:\n${err.message}`);
  } finally {
    for (const info of targetBlocksInfo) {
      clearBlockAbortController(info.id);
      const liveBlock = state.blocks.find((b) => b.id === info.id);
      if (liveBlock) {
        liveBlock.busy = false;
        liveBlock.busyLabel = '';
      }
    }
  }
}

export async function sendAnnotatedReviewFileToChat() {
  if (state.reviewChatDispatchConfirmation) return;
  const total = getTotalReviewComments();
  if (total === 0) return;

  if (!window.sidecar?.conversationId || !window.sidecar?.agent?.sendMessage) {
    showError(
      'No active Antigravity conversation is connected to this panel. Open Speedgrapher from an active chat session to send the annotated file to chat.'
    );
    return;
  }

  if (!state.filePath) {
    showError(
      'Cannot send an unsaved draft to chat. Please open a Markdown file on disk before sending annotated review comments to the chat session.'
    );
    return;
  }

  closeCommentPopover();
  if (state.activeBlockId) {
    exitBlockEditMode(state.activeBlockId, false);
  }
  clearError();

  try {
    await syncDocumentToDisk('user', 'Synced review comments before sending to chat', { immediate: true });

    const reviewSummaryLines = [];
    let idx = 1;
    for (const b of state.blocks) {
      if (!Array.isArray(b.reviews) || b.reviews.length === 0) continue;
      for (const r of b.reviews) {
        const quoteNote = r.quote ? ` (quoting \`"${r.quote}"\`)` : '';
        reviewSummaryLines.push(
          `${idx++}. **Lines ${b.startLine}–${b.endLine}**${quoteNote}: ${r.text}`
        );
      }
    }

    const fileBase = pathBasename(state.filePath) || state.filePath;
    const prompt = [
      `Please resolve the **${total}** inline \`<!-- review: ... -->\` comment${total === 1 ? '' : 's'} in [\`${fileBase}\`](file://${state.filePath}) (\`${state.filePath}\`):`,
      reviewSummaryLines.join('\n'),
      `### Instructions:`,
      `1. Read \`${state.filePath}\` on disk and locate every \`<!-- review: ... -->\` and \`<!-- review(...): ... -->\` block.`,
      `2. Rewrite or update the preceding paragraph/block to address each reviewer comment while preserving surrounding context, technical accuracy, and author voice.`,
      `3. Delete the resolved \`<!-- review... -->\` HTML comment tags from \`${state.filePath}\` on disk.`,
    ].join('\n\n');

    await window.sidecar.agent.sendMessage(prompt);

    if (runtime.reviewChatDispatchConfirmTimer) {
      clearTimeout(runtime.reviewChatDispatchConfirmTimer);
    }
    state.reviewChatDispatchConfirmation = {
      count: total,
    };
    runtime.reviewChatDispatchConfirmTimer = setTimeout(() => {
      runtime.reviewChatDispatchConfirmTimer = null;
      state.reviewChatDispatchConfirmation = null;
      updateHeaderTelemetry();
    }, 3500);

    setSyncStatus('agent', `Sent ${total} review comment${total === 1 ? '' : 's'} to chat`);
    updateHeaderTelemetry();
  } catch (err) {
    if (runtime.reviewChatDispatchConfirmTimer) {
      clearTimeout(runtime.reviewChatDispatchConfirmTimer);
      runtime.reviewChatDispatchConfirmTimer = null;
    }
    state.reviewChatDispatchConfirmation = null;
    updateHeaderTelemetry();
    showError(`Failed to send annotated file to chat: ${err.message}`);
  }
}

export async function launchVariantTournamentForBlock(blockId) {
  const resolvedId = blockId || state.activeBlockId;
  if (state.activeBlockId && state.activeBlockId === resolvedId) {
    exitBlockEditMode(state.activeBlockId, false);
  }

  const getLiveBlock = () => state.blocks.find((b) => b.id === resolvedId);
  const initialBlock = getLiveBlock();
  if (!initialBlock || !initialBlock.raw || !initialBlock.raw.trim()) {
    showError('Click inside a non-empty paragraph or heading block first to run a 3-Angle Variant Tournament.');
    return;
  }
  if (initialBlock.busy) return;

  if (!state.aiSettings?.configured) {
    state.pendingTournamentBlockId = initialBlock.id;
    toggleSettingsPopover(true, 'general');
    return;
  }

  closeAllPopovers();
  clearError();

  const modelLabel = state.aiSettings?.model || 'gemini-3.8-flash';
  const thinkingLabel = (state.aiSettings?.thinkingLevel || 'LOW').toUpperCase();
  initialBlock.tournament = null;
  initialBlock.busy = true;
  initialBlock.busyLabel = `Generating 3 AI rewrite angles with ${modelLabel} (Thinking: ${thinkingLabel})…`;
  setSyncStatus('agent', `${modelLabel} (${thinkingLabel}) generating 3 angles…`);
  renderCanvas();

  const el = document.querySelector(`.doc-block[data-block-id="${initialBlock.id}"]`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const idx = state.blocks.findIndex((b) => b.id === initialBlock.id);
  const prevRaw = idx > 0 ? state.blocks[idx - 1].raw : '';
  const nextRaw = idx >= 0 && idx < state.blocks.length - 1 ? state.blocks[idx + 1].raw : '';
  const surroundingContext = [prevRaw, nextRaw].filter(Boolean).join('\n\n');

  const controller = registerBlockAbortController(initialBlock.id);

  try {
    const res = await apiPost(
      '/api/tournament',
      {
        passage: initialBlock.raw,
        blockType: initialBlock.type,
        keyword: state.keyword || '',
        surroundingContext,
      },
      { timeoutMs: AI_REQUEST_TIMEOUT_MS, signal: controller.signal }
    );

    const liveBlock = getLiveBlock();
    if (!liveBlock) return;
    liveBlock.busy = false;
    liveBlock.busyLabel = '';
    liveBlock.tournament = {
      model: res.model || modelLabel,
      angles: res.angles,
      selectedSentences: [...(res.angles[0]?.sentences || [])],
      compositeRaw: res.angles[0]?.raw || '',
    };
    setSyncStatus('synced', '3 AI angles ready');
    renderCanvas();

    const updatedEl = document.querySelector(`.doc-block[data-block-id="${liveBlock.id}"]`);
    updatedEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    const liveBlock = getLiveBlock();
    if (liveBlock) {
      liveBlock.busy = false;
      liveBlock.busyLabel = '';
    }
    setSyncStatus('idle', 'Tournament Error');
    renderCanvas();
    if (String(err.message || '').includes('AI features are not configured')) {
      state.pendingTournamentBlockId = resolvedId;
      toggleSettingsPopover(true, 'general');
    }
    showError(`Variant Tournament failed:\n${err.message}`);
  } finally {
    clearBlockAbortController(resolvedId);
    const liveBlock = getLiveBlock();
    if (liveBlock) {
      liveBlock.busy = false;
      liveBlock.busyLabel = '';
    }
  }
}

export function buildParagraphContextTelemetryMarkdown(block) {
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

  const blockSpans = state.spans.filter((s) => s.blockId === block.id);
  const complexWordsList = blockSpans
    .filter((s) => s.pillar === 'fog' && !s.isSentenceSpan && s.match)
    .map((s) => s.match);

  const fogVal = diag?.fog ?? serverFogPara?.fog_index ?? '—';
  const wordCount = diag?.wordCount ?? serverFogPara?.total_words ?? countWordsInText(block.raw);
  const sentCount = diag?.sentenceCount ?? serverFogPara?.total_sentences ?? 1;
  const complexCount =
    diag?.complexWords ??
    (typeof serverFogPara?.complex_words === 'number'
      ? serverFogPara.complex_words
      : complexWordsList.length);
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

  if (complexWordsList.length > 0) {
    lines.push(`- **Complex Words (3+ syllables)**: ${[...new Set(complexWordsList)].map((w) => `\`${w}\``).join(', ')}`);
  }

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

export function renderCommandPaletteContextPreview(block, selectedText = '') {
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

export function openCommandPaletteForBlock(blockId = null, selectedText = '', initialPrompt = '', skill = 'draft') {
  const input = document.getElementById('cmd-input');
  const scopeBadge = document.getElementById('cmd-scope-badge');
  const titleLabel = document.getElementById('cmd-title-label');
  const submitBtn = document.getElementById('btn-cmd-submit');
  const iconAi = document.getElementById('cmd-title-icon-ai');
  const iconChat = document.getElementById('cmd-title-icon-chat');
  if (!input) return;

  const targetBlock = state.blocks.find((b) => b.id === (blockId || state.activeBlockId)) || null;
  closeAllPopovers();
  state.cmdOpen = true;
  state.cmdMode = 'default';
  state.cmdSkill = skill || 'draft';
  state.cmdReviewId = null;
  state.cmdBlockId = targetBlock ? targetBlock.id : null;
  state.cmdSelectedText = selectedText || '';
  setHidden(iconAi, false);
  setHidden(iconChat, true);

  if (titleLabel) {
    titleLabel.textContent = 'AI Rewrite';
  }
  if (submitBtn) {
    submitBtn.textContent = '✨ Rewrite';
    submitBtn.setAttribute('data-tooltip', 'Rewrite with AI');
  }

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
  input.placeholder = 'Describe how to rewrite this passage…';
  input.value = initialPrompt || '';
  setTimeout(() => {
    input.focus();
    if (initialPrompt) {
      input.select();
    }
  }, 10);
}

export function openSendToChatPopover(blockId = null, selectedText = '') {
  const input = document.getElementById('cmd-input');
  const scopeBadge = document.getElementById('cmd-scope-badge');
  const titleLabel = document.getElementById('cmd-title-label');
  const submitBtn = document.getElementById('btn-cmd-submit');
  const previewEl = document.getElementById('cmd-context-preview');
  const iconAi = document.getElementById('cmd-title-icon-ai');
  const iconChat = document.getElementById('cmd-title-icon-chat');
  if (!input) return;

  const targetBlock = blockId ? state.blocks.find((b) => b.id === blockId) || null : null;
  const cleanSelection = (selectedText || '').trim();

  closeCommentPopover();
  closeAllPopovers();
  state.cmdOpen = true;
  state.cmdMode = 'chat';
  state.cmdSkill = 'draft';
  state.cmdReviewId = null;
  state.cmdBlockId = targetBlock ? targetBlock.id : null;
  state.cmdSelectedText = cleanSelection;

  if (!targetBlock) {
    document.getElementById('btn-send-chat-top')?.classList.add('active');
  }
  setHidden(iconAi, true);
  setHidden(iconChat, false);

  if (titleLabel) {
    titleLabel.textContent = 'Send to Chat';
  }
  if (submitBtn) {
    submitBtn.textContent = 'Send to Chat';
    submitBtn.setAttribute('data-tooltip', 'Send to main chat');
  }

  if (scopeBadge) {
    if (cleanSelection) {
      scopeBadge.textContent = targetBlock
        ? `Selection (${countWordsInText(cleanSelection)}w) · L${targetBlock.startLine}–${targetBlock.endLine}`
        : `Selection (${countWordsInText(cleanSelection)}w)`;
    } else if (targetBlock) {
      scopeBadge.textContent = `Paragraph · L${targetBlock.startLine}–${targetBlock.endLine} (${countWordsInText(targetBlock.raw)}w)`;
    } else {
      scopeBadge.textContent = `Full Doc (${state.metrics.words}w)`;
    }
  }

  if (previewEl) {
    setHidden(previewEl, false);
    const fullDocMd =
      state.studioMode === 'raw'
        ? document.getElementById('raw-markdown-editor')?.value || ''
        : serializeBlocksToMarkdown(state.blocks);
    const previewSource = cleanSelection || (targetBlock ? targetBlock.raw : fullDocMd);
    const snippet = previewSource.length > 260 ? `${previewSource.slice(0, 260)}…` : previewSource;
    const headLabel = cleanSelection
      ? 'Selected Text to Send'
      : targetBlock
      ? `Paragraph · L${targetBlock.startLine}–${targetBlock.endLine}`
      : `Full Document · ${state.filePath ? pathBasename(state.filePath) : 'Unsaved Draft'}`;

    previewEl.innerHTML = `
      <div class="cmd-context-preview-head">
        <span>${escapeHtml(headLabel)}</span>
        <span>${countWordsInText(previewSource)} words</span>
      </div>
      <div style="font-family:var(--font-mono);font-size:11px;white-space:pre-wrap;color:var(--fg);line-height:1.45;">${escapeHtml(
        snippet || '(empty)'
      )}</div>
    `;
  }

  setHidden('cmd-palette', false);
  input.placeholder = 'Add an optional comment or instruction (or press Enter to send as-is)…';
  input.value = '';
  setTimeout(() => {
    input.focus();
  }, 10);
}

export function dispatchContextualSpanFixToAgent(span) {
  if (!span) return;
  const explanation = span.explanation || getEditorialRuleExplanation(span.pillar, span.ruleId || span.rule, span.rule);
  const repHint =
    span.replacement !== null && span.replacement !== undefined
      ? ` (suggested: "${span.replacement === '' ? '[cut phrase]' : span.replacement}")`
      : '';

  const instruction = `Fix [${span.pillar.toUpperCase()} · ${span.rule}] on "${span.match}": ${span.message}${repHint}.${
    explanation ? ` ${explanation}` : ''
  } Rewrite naturally while preserving technical accuracy and context.`;

  openCommandPaletteForBlock(span.blockId, span.match, instruction, 'readability');
}

export async function dispatchScopedAgentSkill(skillName, blockOrId, instruction) {
  if (!state.aiSettings?.configured) {
    toggleSettingsPopover(true, 'general');
    showError(
      'Configure Vertex AI Project ID or Gemini API Key in Settings (⚙️) to run AI rewrites.'
    );
    return;
  }

  const targetBlockId = typeof blockOrId === 'string' ? blockOrId : blockOrId?.id || null;

  if (state.activeBlockId) {
    exitBlockEditMode(state.activeBlockId, false);
  }

  clearError();
  const modelLabel = state.aiSettings?.model || 'gemini-3.8-flash';
  const selectedFocus = state.cmdSelectedText
    ? `\n\nFocused selection inside paragraph:\n"${state.cmdSelectedText}"`
    : '';
  state.cmdSelectedText = '';

  const effectiveInstruction = `${instruction}${selectedFocus}`.trim();

  if (targetBlockId) {
    const getLiveBlock = () => state.blocks.find((b) => b.id === targetBlockId);
    const initialBlock = getLiveBlock();
    if (!initialBlock) {
      showError(`Target block ${targetBlockId} not found.`);
      return;
    }

    initialBlock.busy = true;
    initialBlock.busyLabel = `AI (${modelLabel}) rewriting paragraph…`;
    setSyncStatus('agent', `${modelLabel} rewriting L${initialBlock.startLine}–${initialBlock.endLine}…`);
    renderCanvas();

    const controller = registerBlockAbortController(targetBlockId);

    try {
      const telemetryContext = buildParagraphContextTelemetryMarkdown(initialBlock);
      const fullDocument = serializeBlocksToMarkdown(state.blocks);
      const res = await apiPost(
        '/api/ai/rewrite',
        {
          fullDocument,
          skill: skillName || 'draft',
          instruction: effectiveInstruction,
          telemetryContext,
          targetBlocks: [
            {
              id: initialBlock.id,
              startLine: initialBlock.startLine,
              endLine: initialBlock.endLine,
              type: initialBlock.type,
              raw: initialBlock.raw,
              reviews: initialBlock.reviews || [],
            },
          ],
        },
        { timeoutMs: AI_REQUEST_TIMEOUT_MS, signal: controller.signal }
      );

      const liveBlock = getLiveBlock();
      if (!liveBlock) return;
      liveBlock.busy = false;
      liveBlock.busyLabel = '';

      const proposals = Array.isArray(res.proposals) ? res.proposals : [];
      const prop = proposals.find((p) => p.id === liveBlock.id) || proposals[0];
      if (!prop || typeof prop.newRaw !== 'string') {
        throw new Error('AI rewrite response did not contain a proposal for the target block.');
      }

      liveBlock.diff = {
        oldRaw: liveBlock.raw,
        newRaw: prop.newRaw,
        newReviews: liveBlock.reviews || [],
        oldReviews: liveBlock.reviews || [],
        fromDisk: false,
        source: `✨ AI (${res.model || modelLabel})${prop.summary ? ` · ${prop.summary}` : ''}`,
        acceptLabel: 'Accept',
        rejectLabel: 'Reject',
      };

      recordHistorySnapshot(`AI staged proposal on ${liveBlock.id}`);
      setSyncStatus('agent', 'Review AI diff');
      updateHeaderTelemetry();
      renderCanvas();

      const blockEl = document.querySelector(`.doc-block[data-block-id="${liveBlock.id}"]`);
      blockEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      const liveBlock = getLiveBlock();
      if (liveBlock) {
        liveBlock.busy = false;
        liveBlock.busyLabel = '';
      }
      setSyncStatus('idle', 'AI Rewrite Error');
      renderCanvas();
      showError(`AI rewrite failed:\n${err.message}`);
    } finally {
      clearBlockAbortController(targetBlockId);
      const liveBlock = getLiveBlock();
      if (liveBlock) {
        liveBlock.busy = false;
        liveBlock.busyLabel = '';
      }
    }
    return;
  }

  // Full-document AI rewrite
  setSyncStatus('agent', `${modelLabel} rewriting document…`);
  for (const b of state.blocks) {
    b.busy = true;
  }
  if (state.blocks[0]) {
    state.blocks[0].busyLabel = `AI (${modelLabel}) staging document diffs…`;
  }
  renderCanvas();

  const docController = registerBlockAbortController(state.blocks[0]?.id || '__doc__');
  for (const b of state.blocks.slice(1)) {
    linkBlockAbortController(b.id, docController);
  }

  try {
    const telemetryContext = buildParagraphContextTelemetryMarkdown(null);
    const fullDocument = serializeBlocksToMarkdown(state.blocks);
    const res = await apiPost(
      '/api/ai/rewrite',
      {
        fullDocument,
        skill: skillName || 'publish',
        instruction: effectiveInstruction,
        telemetryContext,
        targetBlocks: [],
      },
      { timeoutMs: AI_REQUEST_TIMEOUT_MS, signal: docController.signal }
    );

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
  } finally {
    clearBlockAbortController('__doc__');
    for (const b of state.blocks) {
      clearBlockAbortController(b.id);
      b.busy = false;
      b.busyLabel = '';
    }
  }
}

export async function sendContextToMainChat(block, instruction = '', quote = '') {
  if (!window.sidecar?.conversationId || !window.sidecar?.agent?.sendMessage) {
    showError(
      'No active Antigravity conversation is connected to this panel. Open Speedgrapher from an active chat session to send to the main chat.'
    );
    return;
  }

  const fileLabel = state.filePath ? `\`${state.filePath}\`` : 'unsaved draft in Speedgrapher';
  const effectiveQuote = (quote || state.cmdSelectedText || '').trim();
  const cleanInstruction = (instruction || '').trim();
  state.cmdSelectedText = '';

  let contentSection = '';
  if (effectiveQuote && block) {
    contentSection = [
      `### Selected Excerpt (${fileLabel} · Lines ${block.startLine}–${block.endLine}):`,
      `\`\`\`markdown\n${effectiveQuote}\n\`\`\``,
      `### Full Paragraph (${fileLabel} · Lines ${block.startLine}–${block.endLine}):`,
      `\`\`\`markdown\n${block.raw}\n\`\`\``,
    ].join('\n');
  } else if (effectiveQuote) {
    contentSection = `### Selected Text (${fileLabel}):\n\`\`\`markdown\n${effectiveQuote}\n\`\`\``;
  } else if (block) {
    contentSection = `### Passage (${fileLabel} · Lines ${block.startLine}–${block.endLine}):\n\`\`\`markdown\n${block.raw}\n\`\`\``;
  } else {
    const fullDocMd =
      state.studioMode === 'raw'
        ? document.getElementById('raw-markdown-editor')?.value || ''
        : serializeBlocksToMarkdown(state.blocks);
    contentSection = `### Document (${fileLabel}):\n\`\`\`markdown\n${fullDocMd}\n\`\`\``;
  }

  const prompt = [
    cleanInstruction ? cleanInstruction : '',
    contentSection,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    setSyncStatus('agent', 'Sent to chat');
    await window.sidecar.agent.sendMessage(prompt);
  } catch (err) {
    showError(`Failed to send to main chat: ${err.message}`);
  }
}

function extractBlockWordTokens(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[`*_~#>[\]()!]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function computeBlockPairSimilarity(oldB, newB, isSingleBlockGap = false) {
  if (!oldB || !newB) return -1;
  if (oldB.type !== newB.type) {
    return -1;
  }
  if (oldB.type === 'hr') {
    return 1;
  }
  const tokensA = extractBlockWordTokens(oldB.raw);
  const tokensB = extractBlockWordTokens(newB.raw);
  if (tokensA.length === 0 && tokensB.length === 0) {
    return 1;
  }
  if (tokensA.length === 0 || tokensB.length === 0) {
    return isSingleBlockGap ? 0.25 : -1;
  }

  const countsA = new Map();
  for (const t of tokensA) {
    countsA.set(t, (countsA.get(t) || 0) + 1);
  }
  let intersection = 0;
  for (const t of tokensB) {
    const c = countsA.get(t) || 0;
    if (c > 0) {
      intersection++;
      countsA.set(t, c - 1);
    }
  }
  const dice = (2 * intersection) / (tokensA.length + tokensB.length);
  const levelBonus =
    oldB.type === 'heading' && newB.type === 'heading' && oldB.level === newB.level ? 0.25 : 0.15;
  const score = levelBonus + 0.85 * dice;

  if (isSingleBlockGap && oldB.type === newB.type) {
    if (oldB.type === 'heading' && oldB.level !== newB.level && dice < 0.2) {
      return -1;
    }
    return Math.max(score, 0.25);
  }

  const minThreshold = oldB.type === 'heading' ? 0.35 : 0.22;
  return score >= minThreshold ? score : -1;
}

function alignGapBlocksDP(oldSlice, newSlice, fromDisk, sourceLabel) {
  const m = oldSlice.length;
  const n = newSlice.length;
  const result = [];

  if (m === 0 && n === 0) {
    return result;
  }
  if (m === 0) {
    for (const inc of newSlice) {
      result.push({
        ...inc,
        id: `b-ins-${Date.now()}-${++runtime.reconcileBlockSeq}`,
        diff: {
          oldRaw: '',
          newRaw: inc.raw,
          newReviews: inc.reviews || [],
          isInsertion: true,
          fromDisk,
          source: `${sourceLabel} (Inserted)`,
          acceptLabel: 'Accept',
          rejectLabel: 'Reject',
        },
      });
    }
    return result;
  }
  if (n === 0) {
    for (const cur of oldSlice) {
      cur.diff = {
        oldRaw: cur.raw,
        newRaw: '',
        newReviews: [],
        oldReviews: cur.reviews || [],
        isDeletion: true,
        fromDisk,
        source: `${sourceLabel} (Deleted)`,
        acceptLabel: 'Accept',
        rejectLabel: 'Reject',
      };
      result.push(cur);
    }
    return result;
  }

  const isSingleBlockGap = m === 1 && n === 1;
  const dp = Array.from({ length: m + 1 }, () => new Float64Array(n + 1));
  const choice = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      let bestScore = dp[i + 1][j];
      let bestChoice = 2;

      if (dp[i][j + 1] > bestScore) {
        bestScore = dp[i][j + 1];
        bestChoice = 3;
      }

      const sim = computeBlockPairSimilarity(oldSlice[i], newSlice[j], isSingleBlockGap);
      if (sim >= 0) {
        const pairScore = sim + dp[i + 1][j + 1];
        if (pairScore >= bestScore) {
          bestScore = pairScore;
          bestChoice = 1;
        }
      }

      dp[i][j] = bestScore;
      choice[i][j] = bestChoice;
    }
  }

  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    const c = choice[i][j];
    if (c === 1) {
      const cur = oldSlice[i];
      const inc = newSlice[j];
      cur.trailingBlankLines = inc.trailingBlankLines;
      if (inc.tournament) {
        cur.tournament = inc.tournament;
      } else if (inc.raw !== cur.raw) {
        cur.diff = {
          oldRaw: cur.raw,
          newRaw: inc.raw,
          newReviews: inc.reviews || [],
          oldReviews: cur.reviews || [],
          fromDisk,
          source: sourceLabel,
          acceptLabel: 'Accept',
          rejectLabel: 'Reject',
        };
      } else if (JSON.stringify(inc.reviews || []) !== JSON.stringify(cur.reviews || [])) {
        cur.reviews = inc.reviews || [];
        cur.comments = cur.reviews;
      }
      result.push(cur);
      i++;
      j++;
    } else if (c === 2) {
      const cur = oldSlice[i];
      cur.diff = {
        oldRaw: cur.raw,
        newRaw: '',
        newReviews: [],
        oldReviews: cur.reviews || [],
        isDeletion: true,
        fromDisk,
        source: `${sourceLabel} (Deleted)`,
        acceptLabel: 'Accept',
        rejectLabel: 'Reject',
      };
      result.push(cur);
      i++;
    } else {
      const inc = newSlice[j];
      result.push({
        ...inc,
        id: `b-ins-${Date.now()}-${++runtime.reconcileBlockSeq}`,
        diff: {
          oldRaw: '',
          newRaw: inc.raw,
          newReviews: inc.reviews || [],
          isInsertion: true,
          fromDisk,
          source: `${sourceLabel} (Inserted)`,
          acceptLabel: 'Accept',
          rejectLabel: 'Reject',
        },
      });
      j++;
    }
  }

  while (i < m) {
    const cur = oldSlice[i++];
    cur.diff = {
      oldRaw: cur.raw,
      newRaw: '',
      newReviews: [],
      oldReviews: cur.reviews || [],
      isDeletion: true,
      fromDisk,
      source: `${sourceLabel} (Deleted)`,
      acceptLabel: 'Accept',
      rejectLabel: 'Reject',
    };
    result.push(cur);
  }

  while (j < n) {
    const inc = newSlice[j++];
    result.push({
      ...inc,
      id: `b-ins-${Date.now()}-${++runtime.reconcileBlockSeq}`,
      diff: {
        oldRaw: '',
        newRaw: inc.raw,
        newReviews: inc.reviews || [],
        isInsertion: true,
        fromDisk,
        source: `${sourceLabel} (Inserted)`,
        acceptLabel: 'Accept',
        rejectLabel: 'Reject',
      },
    });
  }

  return result;
}

export function reconcileExternalDiskUpdate(newDiskMarkdown, proposedAudit, proposedMetrics, options = {}) {
  const newDiskBlocks = parseDocumentIntoBlocks(newDiskMarkdown);
  const fromDisk = options.fromDisk !== undefined ? Boolean(options.fromDisk) : true;
  const sourceLabel = options.source || '✨ Proposed Agent Edit';

  if (fromDisk) {
    const baselineBlocks = [];
    for (const b of state.blocks) {
      b.busy = false;
      b.busyLabel = '';
      if (b.diff && b.diff.fromDisk !== false) {
        if (b.diff.isInsertion) {
          continue;
        }
        b.raw = b.diff.oldRaw;
        if (Array.isArray(b.diff.oldReviews)) {
          b.reviews = b.diff.oldReviews;
          b.comments = b.reviews;
        }
        b.diff = null;
      }
      baselineBlocks.push(b);
    }
    state.blocks = baselineBlocks;
  } else {
    for (const b of state.blocks) {
      b.busy = false;
      b.busyLabel = '';
    }
  }

  const oldBlocks = state.blocks;
  const M = oldBlocks.length;
  const N = newDiskBlocks.length;

  const lcs = Array.from({ length: M + 1 }, () => new Int32Array(N + 1));
  for (let i = M - 1; i >= 0; i--) {
    const oldTrim = oldBlocks[i].raw.trim();
    const oldType = oldBlocks[i].type;
    for (let j = N - 1; j >= 0; j--) {
      if (oldType === newDiskBlocks[j].type && oldTrim === newDiskBlocks[j].raw.trim()) {
        lcs[i][j] = 1 + lcs[i + 1][j + 1];
      } else {
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
  }

  const anchors = [{ oldIdx: -1, newIdx: -1 }];
  let ai = 0;
  let aj = 0;
  while (ai < M && aj < N) {
    if (
      oldBlocks[ai].type === newDiskBlocks[aj].type &&
      oldBlocks[ai].raw.trim() === newDiskBlocks[aj].raw.trim()
    ) {
      anchors.push({ oldIdx: ai, newIdx: aj });
      ai++;
      aj++;
    } else if (lcs[ai + 1][aj] >= lcs[ai][aj + 1]) {
      ai++;
    } else {
      aj++;
    }
  }
  anchors.push({ oldIdx: M, newIdx: N });

  const reconciled = [];
  for (let k = 0; k < anchors.length - 1; k++) {
    const prev = anchors[k];
    const next = anchors[k + 1];
    const oldSlice = oldBlocks.slice(prev.oldIdx + 1, next.oldIdx);
    const newSlice = newDiskBlocks.slice(prev.newIdx + 1, next.newIdx);

    const alignedGap = alignGapBlocksDP(oldSlice, newSlice, fromDisk, sourceLabel);
    reconciled.push(...alignedGap);

    if (next.oldIdx < M && next.newIdx < N) {
      const cur = oldBlocks[next.oldIdx];
      const inc = newDiskBlocks[next.newIdx];
      cur.trailingBlankLines = inc.trailingBlankLines;
      if (inc.tournament) {
        cur.tournament = inc.tournament;
      } else if (inc.raw !== cur.raw) {
        cur.diff = {
          oldRaw: cur.raw,
          newRaw: inc.raw,
          newReviews: inc.reviews || [],
          oldReviews: cur.reviews || [],
          fromDisk,
          source: sourceLabel,
          acceptLabel: 'Accept',
          rejectLabel: 'Reject',
        };
      } else if (JSON.stringify(inc.reviews || []) !== JSON.stringify(cur.reviews || [])) {
        cur.reviews = inc.reviews || [];
        cur.comments = cur.reviews;
      }
      reconciled.push(cur);
    }
  }

  if (reconciled.length > 0 && newDiskBlocks.length > 0) {
    reconciled[0].leadingBlankLines = newDiskBlocks[0].leadingBlankLines || 0;
  }

  state.blocks = reconciled;
  recomputeBlockLineNumbers();
  if (proposedAudit !== undefined && proposedAudit !== null) {
    state.audit = proposedAudit;
  }
  if (proposedMetrics !== undefined && proposedMetrics !== null) {
    state.metrics = proposedMetrics;
  }
  state.spans = buildAmbientSpansFromAudit(state.audit);
  if (state.studioMode === 'raw') {
    const rawEditor = document.getElementById('raw-markdown-editor');
    if (rawEditor && document.activeElement !== rawEditor) {
      rawEditor.value = newDiskMarkdown;
    }
  }
  recordHistorySnapshot(fromDisk ? 'Proposed external disk edit' : 'Proposed AI rewrite');
  const hasPendingDiffs = state.blocks.some((b) => Boolean(b.diff || b.tournament));
  setSyncStatus(
    hasPendingDiffs ? 'agent' : 'synced',
    hasPendingDiffs ? 'Review proposed edit' : 'Synced from disk'
  );
  updateHeaderTelemetry();
  renderCanvas();
}
