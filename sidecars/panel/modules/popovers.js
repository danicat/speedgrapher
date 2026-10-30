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
// Hover & Pinned Suggestion Popovers, SEO & GEO Popover, Settings & Header Telemetry
// ---------------------------------------------------------------------------

import {
  state,
  runtime,
  setHidden,
  escapeHtml,
  pathBasename,
  setSyncStatus,
  showError,
  clearError,
} from './state.js';
import { apiPost } from './api.js';
import {
  getTotalReviewComments,
  computeWordDiffHtml,
  isSpanSliceValidForBlock,
  updateUndoRedoButtons,
} from './markdown.js';
import {
  getEditorialRuleExplanation,
  isVocabEligibleRule,
  locateAlertSpanInBlock,
} from './diagnostics.js';
import { applySpanInstantReplacement, renderCanvas } from './canvas.js';
import {
  dispatchContextualSpanFixToAgent,
  openCommandPaletteForBlock,
  launchVariantTournamentForBlock,
} from './ai.js';
import { closeFileBrowserPopover, updateFilePickerLabel, syncDocumentToDisk } from './sync.js';

export function buildSpanContextDiffHtml(block, span) {
  const raw = block.raw || '';
  if (span.isWholeBlockReplacement && span.replacement !== null && span.replacement !== undefined) {
    return computeWordDiffHtml(raw, span.replacement);
  }

  let startOffset = span.startOffset;
  let endOffset = span.endOffset;
  if (!isSpanSliceValidForBlock(block, span) && span.match) {
    const relocated = locateAlertSpanInBlock(block, null, span.match, null);
    if (relocated) {
      startOffset = relocated.startOffset;
      endOffset = relocated.endOffset;
    }
  }

  let sentStart = startOffset;
  while (sentStart > 0 && !/[.!?\n]/.test(raw[sentStart - 1])) {
    sentStart--;
  }
  while (sentStart < startOffset && /\s/.test(raw[sentStart])) {
    sentStart++;
  }

  let sentEnd = endOffset;
  while (sentEnd < raw.length && !/[.!?\n]/.test(raw[sentEnd])) {
    sentEnd++;
  }
  if (sentEnd < raw.length && /[.!?]/.test(raw[sentEnd])) {
    sentEnd++;
  }

  const beforeCtx = escapeHtml(raw.slice(sentStart, startOffset));
  const afterCtx = escapeHtml(raw.slice(endOffset, sentEnd));
  const matched = escapeHtml(raw.slice(startOffset, endOffset) || span.match);

  if (span.replacement !== null && span.replacement !== undefined) {
    const insHtml =
      span.replacement === ''
        ? `<ins class="diff-ins">[cut phrase]</ins>`
        : `<ins class="diff-ins">${escapeHtml(span.replacement)}</ins>`;
    return `${beforeCtx}<del class="diff-del">${matched}</del> ${insHtml}${afterCtx}`;
  }

  return `${beforeCtx}<mark class="flagged-context-mark" data-pillar="${escapeHtml(span.pillar || 'slop')}">${matched}</mark>${afterCtx}`;
}

export function bindLensSpanHoverEvents() {
  document.querySelectorAll('mark.lens-span').forEach((mark) => {
    mark.addEventListener('mouseenter', () => {
      if (state.popoverPinned) return;
      if (runtime.popoverHideTimer) {
        clearTimeout(runtime.popoverHideTimer);
        runtime.popoverHideTimer = null;
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
        return;
      }
      e.stopPropagation();
      const span = state.spans.find((s) => s.id === mark.dataset.spanId);
      if (!span) return;
      showLensPopover(mark, span, true);
    });
  });
}

export function positionLensPopoverNear(anchorEl) {
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

export function showLensPopover(anchorEl, span, pinned = false) {
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
    const displayRep = span.replacement === '' ? 'Cut' : `"${span.replacement}"`;
    replaceBtn.textContent = `Apply (${displayRep})`;
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
      addVocabBtn.textContent = '+ Vocab';
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
      disableRuleBtn.textContent = 'Mute';
      disableRuleBtn.onclick = () => {
        setValeRuleEnabled(ruleId, false);
        hideLensPopover();
      };
    } else {
      setHidden(disableRuleBtn, true);
    }
  }

  askAgentBtn.textContent = '✨ Rewrite';
  askAgentBtn.onclick = () => {
    hideLensPopover();
    dispatchContextualSpanFixToAgent(span);
  };

  setHidden(pop, false);
  positionLensPopoverNear(anchorEl);
}

export function showBlockDiagnosticPopover(anchorEl, block, diag) {
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

  const fogLabel = typeof diag.fog === 'number' && !Number.isNaN(diag.fog) ? diag.fog.toFixed(1) : '—';

  diagBox.innerHTML = `
    <div class="diag-metrics-row">
      <div class="diag-metric-pill"><span>Fog Index</span><strong>${fogLabel}</strong></div>
      <div class="diag-metric-pill"><span>AI Slop</span><strong>${diag.slopCount}</strong></div>
      <div class="diag-metric-pill"><span>Vale Style</span><strong>${diag.valeCount}</strong></div>
      <div class="diag-metric-pill"><span>Long Sent.</span><strong>${diag.fogSpanCount}</strong></div>
    </div>
    <div class="diag-issues-list"></div>
    <div style="display:flex;justify-content:space-between;gap:6px;padding-top:4px;border-top:1px solid var(--border-col);">
      <button class="btn-secondary" type="button" data-action="diag-ask-agent">✨ Fix Paragraph (${diag.spans.length})</button>
      <button class="btn-primary" type="button" data-action="diag-tourney">✨ 3 Angles</button>
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
          ${hasFix ? `<button class="btn-success" type="button" data-action="fix-span">Apply (${escapeHtml(sp.replacement === '' ? 'Cut' : `"${sp.replacement}"`)})</button>` : ''}
          ${isVocabEligibleRule(ruleId) && term && term.split(/\s+/).length <= 4 ? `<button class="btn-secondary" type="button" data-action="vocab-span">+ Vocab</button>` : ''}
          ${isVale && ruleId.includes('.') ? `<button class="btn-secondary" type="button" data-action="mute-span">Mute</button>` : ''}
          <button class="btn-secondary" type="button" data-action="ask-agent-span">✨ Rewrite</button>
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
    openCommandPaletteForBlock(
      block.id,
      '',
      `Resolve all ${diag.spans.length} flagged readability, AI slop, and Vale style findings in this paragraph while preserving its technical meaning and voice.`,
      'readability'
    );
  });

  diagBox.querySelector('[data-action="diag-tourney"]')?.addEventListener('click', () => {
    hideLensPopover();
    launchVariantTournamentForBlock(block.id);
  });

  setHidden(pop, false);
  positionLensPopoverNear(anchorEl);
}

export function scheduleHideLensPopover() {
  if (state.popoverPinned) return;
  if (runtime.popoverHideTimer) clearTimeout(runtime.popoverHideTimer);
  runtime.popoverHideTimer = setTimeout(() => {
    if (!state.popoverPinned) hideLensPopover();
  }, 220);
}

export function hideLensPopover() {
  setHidden('lens-popover', true);
  state.activePopoverSpanId = null;
  state.popoverPinned = false;
}

export function renderSeoAndGeoPopover() {
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

export function switchSettingsTab(tabName) {
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

export async function loadValeRulesAndVocab(scopeOverride = undefined) {
  const targetScope =
    scopeOverride === 'global' || scopeOverride === 'local'
      ? scopeOverride
      : state.valeRulesData.scope === 'local'
      ? 'local'
      : 'global';
  state.valeRulesData.scope = targetScope;
  renderValeRulesTab();
  renderVocabTab();
  try {
    const res = await apiPost('/api/vale/rules', {
      action: 'list',
      scope: targetScope,
      path: state.filePath || '',
      workspacePath: state.workspacePath || '',
      conversationId: window.sidecar?.conversationId || '',
    });
    updateValeStateFromResponse(res, targetScope);
    renderValeRulesTab();
    renderVocabTab();
  } catch (err) {
    showError(`Failed to load Vale rules & vocabulary: ${err.message}`);
  }
}

function updateValeStateFromResponse(res, requestedScope = undefined) {
  if (!res || typeof res !== 'object') return;
  if (requestedScope === 'global' || requestedScope === 'local') {
    state.valeRulesData.scope = requestedScope;
  } else if (res.scope === 'global' || res.scope === 'local') {
    state.valeRulesData.scope = res.scope;
  }
  state.valeRulesData.configPath = res.config_path || '';
  state.valeRulesData.globalConfigPath = res.global_config_path || '';
  state.valeRulesData.localConfigPath = res.local_config_path || '';
  state.valeRulesData.hasLocalConfig = Boolean(res.has_local_config);
  if (Array.isArray(res.rules)) {
    state.valeRulesData.rules = res.rules;
  }
  if (Array.isArray(res.vocab_terms)) {
    state.valeRulesData.vocabTerms = res.vocab_terms;
  }
  if (Array.isArray(res.global_vocab_terms)) {
    state.valeRulesData.globalVocabTerms = res.global_vocab_terms;
  }
  if (Array.isArray(res.local_vocab_terms)) {
    state.valeRulesData.localVocabTerms = res.local_vocab_terms;
  }
  if (Array.isArray(res.merged_vocab_terms)) {
    state.valeRulesData.mergedVocabTerms = res.merged_vocab_terms;
  }
}

export async function setValeSettingsScope(scope) {
  const nextScope = scope === 'local' ? 'local' : 'global';
  state.valeRulesData.scope = nextScope;
  document.querySelectorAll('.vale-scope-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.valeScope === nextScope);
  });
  await loadValeRulesAndVocab(nextScope);
}

export async function setValeRuleEnabled(ruleId, enabled, scopeOverride = undefined) {
  const targetScope =
    scopeOverride === 'global' || scopeOverride === 'local'
      ? scopeOverride
      : state.valeRulesData.scope === 'local'
      ? 'local'
      : 'global';
  try {
    clearError();
    if (!enabled) {
      state.spans = state.spans.filter((s) => !(s.pillar === 'vale' && s.rule === ruleId));
      if (state.metrics) {
        state.metrics.vale = state.spans.filter((s) => s.pillar === 'vale').length;
      }
      updateHeaderTelemetry();
      renderCanvas();
    }
    const res = await apiPost('/api/vale/rules', {
      action: 'set_rule',
      scope: targetScope,
      path: state.filePath || '',
      workspacePath: state.workspacePath || '',
      conversationId: window.sidecar?.conversationId || '',
      rule_id: ruleId,
      enabled: Boolean(enabled),
    });
    updateValeStateFromResponse(res, targetScope);
    renderValeRulesTab();
    await syncDocumentToDisk(
      'user',
      `${enabled ? 'Enabled' : 'Muted'} Vale rule ${ruleId} (${targetScope})`,
      { forceRender: true }
    );
  } catch (err) {
    showError(`Failed to update Vale rule "${ruleId}": ${err.message}`);
  }
}

export async function resetValeRuleToGlobal(ruleId) {
  const currentScope = state.valeRulesData.scope === 'local' ? 'local' : 'global';
  try {
    clearError();
    const res = await apiPost('/api/vale/rules', {
      action: 'reset_rule',
      scope: 'local',
      path: state.filePath || '',
      workspacePath: state.workspacePath || '',
      conversationId: window.sidecar?.conversationId || '',
      rule_id: ruleId,
    });
    updateValeStateFromResponse(res, currentScope);
    renderValeRulesTab();
    await syncDocumentToDisk('user', `Reset project override for Vale rule ${ruleId}`, {
      forceRender: true,
    });
  } catch (err) {
    showError(`Failed to reset Vale rule "${ruleId}": ${err.message}`);
  }
}

export async function addTermToValeVocab(term, scopeOverride = undefined) {
  const clean = (term || '').trim();
  if (!clean) return;
  const targetScope =
    scopeOverride === 'global' || scopeOverride === 'local'
      ? scopeOverride
      : state.valeRulesData.scope === 'local'
      ? 'local'
      : 'global';
  try {
    clearError();
    const lowerClean = clean.toLowerCase();
    state.spans = state.spans.filter(
      (s) => !(s.pillar === 'vale' && String(s.matchedText || s.match || '').trim().toLowerCase() === lowerClean)
    );
    if (state.metrics) {
      state.metrics.vale = state.spans.filter((s) => s.pillar === 'vale').length;
    }
    updateHeaderTelemetry();
    renderCanvas();

    const res = await apiPost('/api/vale/rules', {
      action: 'add_vocab',
      scope: targetScope,
      path: state.filePath || '',
      workspacePath: state.workspacePath || '',
      conversationId: window.sidecar?.conversationId || '',
      term: clean,
      case_insensitive: true,
    });
    updateValeStateFromResponse(res, targetScope);
    renderVocabTab();
    await syncDocumentToDisk('user', `Added "${clean}" to ${targetScope} vocabulary`, { forceRender: true });
  } catch (err) {
    showError(`Failed to add "${clean}" to vocabulary: ${err.message}`);
  }
}

export async function removeTermFromValeVocab(term, scopeOverride = undefined) {
  const clean = (term || '').trim();
  if (!clean) return;
  const uiScope = state.valeRulesData.scope === 'local' ? 'local' : 'global';
  const targetScope =
    scopeOverride === 'global' || scopeOverride === 'local'
      ? scopeOverride
      : uiScope;
  try {
    clearError();
    const res = await apiPost('/api/vale/rules', {
      action: 'remove_vocab',
      scope: targetScope,
      path: state.filePath || '',
      workspacePath: state.workspacePath || '',
      conversationId: window.sidecar?.conversationId || '',
      term: clean,
    });
    updateValeStateFromResponse(res, uiScope);
    renderVocabTab();
    await syncDocumentToDisk('user', `Removed "${clean}" from ${targetScope} vocabulary`, { forceRender: true });
  } catch (err) {
    showError(`Failed to remove "${clean}" from vocabulary: ${err.message}`);
  }
}

export function renderValeRulesTab() {
  const listEl = document.getElementById('vale-rules-list');
  const pathBadge = document.getElementById('vale-config-path-badge');
  const filterBtn = document.getElementById('vale-filter-active-btn');
  if (!listEl) return;

  const activeScope = state.valeRulesData.scope === 'local' ? 'local' : 'global';
  document.querySelectorAll('.vale-scope-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.valeScope === activeScope);
  });

  if (pathBadge) {
    const scopePrefix = activeScope === 'local' ? 'Project Config' : 'Global Config';
    pathBadge.textContent = state.valeRulesData.configPath
      ? `${scopePrefix}: ${state.valeRulesData.configPath}`
      : '';
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

  const rules = [...state.valeRulesData.rules];
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
    const enabled =
      activeScope === 'global'
        ? r.global_enabled !== undefined
          ? Boolean(r.global_enabled)
          : r.enabled !== false && String(r.effective_level || r.level || '').toUpperCase() !== 'NO'
        : r.enabled !== false && String(r.effective_level || r.level || '').toUpperCase() !== 'NO';
    const docHits = activeDocRuleCounts.get(ruleId) || 0;
    const hasLocalOverride = Boolean(r.local_override);
    const hasGlobalOverride = Boolean(r.global_override);

    let sourceBadgeHtml = '';
    if (hasLocalOverride) {
      sourceBadgeHtml = `<span class="cmd-row-badge" style="color:var(--accent);">Project override</span>`;
    } else if (hasGlobalOverride) {
      sourceBadgeHtml = `<span class="cmd-row-badge">Global</span>`;
    }

    const resetBtnHtml =
      activeScope === 'local' && hasLocalOverride
        ? `<button class="btn-secondary" type="button" data-action="reset-rule" title="Remove local override and inherit from Global" style="padding:2px 6px;font-size:9.5px;">Reset</button>`
        : '';

    const row = document.createElement('div');
    row.className = 'vale-rule-row';
    row.innerHTML = `
      <div class="vale-rule-info">
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:5px;">
          <span class="vale-rule-id">${escapeHtml(ruleId)}</span>
          ${sourceBadgeHtml}
          ${docHits > 0 ? `<span class="cmd-row-badge" style="color:var(--col-vale);">${docHits} in doc</span>` : ''}
        </div>
        ${r.description ? `<span class="vale-rule-desc">${escapeHtml(r.description)}</span>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
        ${resetBtnHtml}
        <div class="segmented-control" role="group">
          <button class="seg-btn ${enabled ? 'active' : ''}" type="button" data-enable="true">On</button>
          <button class="seg-btn ${!enabled ? 'active' : ''}" type="button" data-enable="false">Off</button>
        </div>
      </div>
    `;

    row.querySelector('[data-enable="true"]')?.addEventListener('click', () => {
      if (!enabled || (activeScope === 'local' && !hasLocalOverride)) {
        setValeRuleEnabled(ruleId, true, activeScope);
      }
    });
    row.querySelector('[data-enable="false"]')?.addEventListener('click', () => {
      if (enabled || (activeScope === 'local' && !hasLocalOverride)) {
        setValeRuleEnabled(ruleId, false, activeScope);
      }
    });
    row.querySelector('[data-action="reset-rule"]')?.addEventListener('click', () => {
      resetValeRuleToGlobal(ruleId);
    });

    listEl.appendChild(row);
  }
}

export function renderVocabTab() {
  const listEl = document.getElementById('vocab-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  const activeScope = state.valeRulesData.scope === 'local' ? 'local' : 'global';
  document.querySelectorAll('.vale-scope-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.valeScope === activeScope);
  });

  const vocabInput = document.getElementById('vocab-new-term-input');
  if (vocabInput) {
    vocabInput.placeholder =
      activeScope === 'local'
        ? 'Add term to project vocabulary (e.g. Sidecar, Blowfish)…'
        : 'Add term to shared global vocabulary (e.g. Ebitengine, Genkit)…';
  }

  const globalTerms = Array.isArray(state.valeRulesData.globalVocabTerms)
    ? state.valeRulesData.globalVocabTerms
    : state.valeRulesData.vocabTerms || [];
  const localTerms = Array.isArray(state.valeRulesData.localVocabTerms)
    ? state.valeRulesData.localVocabTerms
    : [];

  const items = [];
  if (activeScope === 'global') {
    for (const t of globalTerms) {
      items.push({ term: t, termScope: 'global' });
    }
    for (const t of localTerms) {
      if (!globalTerms.some((g) => g.toLowerCase() === t.toLowerCase())) {
        items.push({ term: t, termScope: 'local' });
      }
    }
  } else {
    for (const t of localTerms) {
      items.push({ term: t, termScope: 'local' });
    }
    for (const t of globalTerms) {
      if (!localTerms.some((l) => l.toLowerCase() === t.toLowerCase())) {
        items.push({ term: t, termScope: 'global' });
      }
    }
  }

  if (items.length === 0) {
    listEl.innerHTML = `<div style="font-size:11px;color:var(--text-muted);padding:6px 2px;">No custom vocabulary terms in accept.txt yet.</div>`;
    return;
  }

  for (const { term, termScope } of items) {
    const pill = document.createElement('span');
    pill.className = 'vocab-term-pill';
    const badgeLabel = termScope === 'local' ? 'Project' : 'Global';
    pill.innerHTML = `
      <span>${escapeHtml(term)}</span>
      <span class="cmd-row-badge" style="font-size:8.5px;padding:1px 4px;">${badgeLabel}</span>
      <button class="vocab-remove-btn" type="button" title="Remove ${escapeHtml(term)} from ${badgeLabel} vocabulary">×</button>
    `;
    pill.querySelector('button').addEventListener('click', () => {
      removeTermFromValeVocab(term, termScope);
    });
    listEl.appendChild(pill);
  }
}

export function updateHeaderTelemetry() {
  const m = state.metrics || {};
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val !== null && val !== undefined ? String(val) : '—';
  };

  const isHeatmapActive =
    state.lenses && typeof state.lenses.heatmap === 'boolean'
      ? state.lenses.heatmap
      : Boolean(state.activeLenses?.has('heatmap'));

  setVal('metric-slop', m.slop);
  setVal('metric-vale', m.vale);
  setVal('metric-fog', m.fog);
  setVal('metric-seo', m.seo !== null && m.seo !== undefined ? `${m.seo}%` : '—');
  setVal('metric-heatmap', isHeatmapActive ? 'ON' : 'OFF');

  const elHeatmap = document.getElementById('lens-btn-heatmap');
  const elHeatmapIcon = document.getElementById('heatmap-toggle-icon');
  if (elHeatmapIcon) {
    elHeatmapIcon.textContent = isHeatmapActive ? '🔥' : '🧊';
  }
  if (elHeatmap) {
    elHeatmap.classList.toggle('active', isHeatmapActive);
    elHeatmap.setAttribute('data-tooltip', 'Heatmap');
  }

  const wordBadge = document.getElementById('word-count-badge');
  if (wordBadge) wordBadge.textContent = `${m.words || 0} words`;

  const fileBadge = document.getElementById('active-file-badge');
  if (fileBadge) {
    fileBadge.textContent = state.filePath ? pathBasename(state.filePath) : 'Unsaved draft';
  }

  updateFilePickerLabel();

  const isReaderMode = state.studioMode === 'reader';
  const totalReviews = getTotalReviewComments();
  const revBtn = document.getElementById('btn-send-review-agent');
  const revLabel = document.getElementById('review-count-label');
  const flash = state.reviewDispatchConfirmation;
  if (!isReaderMode && flash && flash.count > 0) {
    if (revLabel) {
      revLabel.textContent = `${flash.count}…`;
    }
    if (revBtn) {
      revBtn.disabled = true;
      revBtn.classList.add('is-dispatched');
    }
    setHidden('btn-send-review-agent', false);
  } else {
    if (revLabel) {
      revLabel.textContent = `${totalReviews}`;
    }
    if (revBtn) {
      revBtn.disabled = totalReviews === 0;
      revBtn.classList.remove('is-dispatched');
    }
    setHidden('btn-send-review-agent', isReaderMode || totalReviews === 0);
  }

  const chatRevBtn = document.getElementById('btn-send-review-chat');
  const chatRevLabel = document.getElementById('review-chat-count-label');
  const chatFlash = state.reviewChatDispatchConfirmation;
  if (!isReaderMode && chatFlash && chatFlash.count > 0) {
    if (chatRevLabel) {
      chatRevLabel.textContent = `✓ ${chatFlash.count}`;
    }
    if (chatRevBtn) {
      chatRevBtn.disabled = true;
      chatRevBtn.classList.add('is-dispatched');
    }
    setHidden('btn-send-review-chat', false);
  } else {
    if (chatRevLabel) {
      chatRevLabel.textContent = `${totalReviews}`;
    }
    if (chatRevBtn) {
      chatRevBtn.disabled = totalReviews === 0;
      chatRevBtn.classList.remove('is-dispatched');
    }
    setHidden('btn-send-review-chat', isReaderMode || totalReviews === 0);
  }

  document.querySelectorAll('.lens-chip').forEach((btn) => {
    const lens = btn.dataset.lens;
    if (lens === 'seo') {
      btn.classList.toggle('active', state.seoPopoverOpen);
    } else if (lens === 'heatmap') {
      btn.classList.toggle('active', isHeatmapActive);
    } else {
      const isLensActive =
        state.lenses && typeof state.lenses[lens] === 'boolean'
          ? state.lenses[lens]
          : Boolean(state.activeLenses?.has(lens));
      btn.classList.toggle('active', isLensActive);
    }
  });

  renderSeoAndGeoPopover();
  updateUndoRedoButtons();
}

export function closeAllPopovers() {
  state.cmdOpen = false;
  state.cmdMode = 'default';
  state.cmdSkill = 'draft';
  state.cmdReviewId = null;
  state.seoPopoverOpen = false;
  state.settingsPopoverOpen = false;
  setHidden('cmd-palette', true);
  setHidden('panel-seo', true);
  setHidden('panel-settings', true);
  closeFileBrowserPopover();
  document.getElementById('btn-send-chat-top')?.classList.remove('active');
  document.getElementById('btn-send-review-agent')?.classList.remove('active');
  document.getElementById('btn-seo-geo')?.classList.remove('active');
  document.getElementById('btn-settings')?.classList.remove('active');
}

export function toggleSeoPopover() {
  const next = !state.seoPopoverOpen;
  closeAllPopovers();
  state.seoPopoverOpen = next;
  setHidden('panel-seo', !next);
  document.getElementById('btn-seo-geo')?.classList.toggle('active', next);
  if (next) {
    renderSeoAndGeoPopover();
  }
}

export function toggleSettingsPopover(forceOpen = undefined, initialTab = undefined) {
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

export function renderSettingsPopover() {
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

export async function loadStudioAiSettings() {
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

export async function saveStudioAiSettings(clearApiKey = false) {
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
