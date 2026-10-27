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

export const MAX_HISTORY_ENTRIES = 100;

export const state = {
  workspacePath: '',
  sessionDir: '',
  files: [],
  filePath: '',
  mtimeMs: 0,
  docType: 'auto',
  keyword: '',

  // 4-Mode Studio Architecture: 'reader' | 'editor' | 'reviewer' | 'raw'
  studioMode: 'reader',

  // Active lenses in Editor/Reviewer Mode ('heatmap' active by default alongside 'slop' and 'vale')
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
  reviewChatDispatchConfirmation: null,

  audit: null,
  metrics: { fog: null, slop: null, vale: null, seo: null, geo: null, words: 0, blockHealth: {} },
  spans: [],
  activePopoverSpanId: null,
  popoverPinned: false,

  cmdOpen: false,
  cmdMode: 'default', // 'default' | 'reviews'
  cmdSkill: 'draft',
  cmdBlockId: null,
  cmdReviewId: null,
  cmdSelectedText: '',

  // Document link drill-down Back / Forward navigation stacks
  docNavBackStack: [],
  docNavForwardStack: [],
};

export const fileBrowserState = {
  open: false,
  currentDir: '',
  parentDir: '',
  homeDir: '',
  workspaceDir: '',
  sessionDir: '',
  directories: [],
  files: [],
  filterText: '',
  selectedIndex: 0,
};

export const runtime = {
  undoStack: [], // [{ markdown, activeBlockId, caretOffset, label }]
  redoStack: [],
  typingHistoryTimer: null,
  syncDebounceTimer: null,
  pollIntervalId: null,
  isPollingDisk: false,
  popoverHideTimer: null,
  reviewDispatchConfirmTimer: null,
  reviewChatDispatchConfirmTimer: null,
  isSyncing: false,
  pendingSyncRequest: null,
  draggedBlockId: null,
};

export function setHidden(elOrId, hidden) {
  const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
  if (!el) return;
  el.hidden = Boolean(hidden);
  el.classList.toggle('hidden', Boolean(hidden));
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
}

export function pathBasename(p) {
  return String(p || '').split(/[\\/]/).pop() || '';
}

export function pathDirname(p) {
  const str = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = str.lastIndexOf('/');
  if (idx <= 0) return idx === 0 ? '/' : '';
  return str.slice(0, idx);
}

export function countWordsInText(text) {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function parseColorLuminance(cssColor) {
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

export function detectIdeThemeMode() {
  const inlineBg = document.documentElement.style.getPropertyValue('--background').trim();
  const computedBg = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
  const lum = parseColorLuminance(inlineBg || computedBg);
  if (lum !== null) {
    return lum > 0.55 ? 'light' : 'dark';
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyThemeMode(mode) {
  const next = mode === 'dark' ? 'dark' : 'light';
  state.themeMode = next;
  document.documentElement.setAttribute('data-theme', next);
  setHidden('theme-icon-sun', next !== 'light');
  setHidden('theme-icon-moon', next !== 'dark');
  const btn = document.getElementById('btn-theme-toggle');
  if (btn) {
    btn.setAttribute('data-tooltip', next === 'light' ? 'Dark mode' : 'Light mode');
    btn.setAttribute('aria-label', next === 'light' ? 'Dark mode' : 'Light mode');
  }
}

export function showError(message) {
  const detail = document.getElementById('error-banner-detail');
  if (detail) {
    detail.textContent = String(message || 'Unknown error');
  }
  setHidden('error-banner', false);
}

export function clearError() {
  setHidden('error-banner', true);
}

export function setSyncStatus(mode, label) {
  const dot = document.getElementById('sync-dot');
  if (!dot) return;
  dot.dataset.state = mode;
  dot.setAttribute('data-tooltip', label);
}
