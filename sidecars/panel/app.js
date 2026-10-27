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

import {
  state,
  fileBrowserState,
  runtime,
  countWordsInText,
  detectIdeThemeMode,
  applyThemeMode,
  showError,
  clearError,
} from './modules/state.js';
import {
  parseDocumentIntoBlocks,
  recomputeBlockLineNumbers,
  resetHistoryForDocument,
  scheduleTypingHistorySnapshot,
  flushPendingHistorySnapshot,
  isUndoShortcut,
  isRedoShortcut,
} from './modules/markdown.js';
import {
  updateHeaderTelemetry,
  closeAllPopovers,
  toggleSeoPopover,
  toggleSettingsPopover,
  renderSeoAndGeoPopover,
  switchSettingsTab,
  renderValeRulesTab,
  addTermToValeVocab,
  renderSettingsPopover,
  loadStudioAiSettings,
  saveStudioAiSettings,
  scheduleHideLensPopover,
  hideLensPopover,
} from './modules/popovers.js';
import { closeCommentPopover } from './modules/comments.js';
import {
  dispatchReviewCommentsToAgent,
  openReviewResolutionPrompt,
  sendAnnotatedReviewFileToChat,
  openCommandPaletteForBlock,
  dispatchScopedAgentSkill,
  sendContextToMainChat,
} from './modules/ai.js';
import {
  setStudioMode,
  performUndo,
  performRedo,
  renderCanvas,
  enterBlockEditMode,
  exitBlockEditMode,
} from './modules/canvas.js';
import {
  closeFileBrowserPopover,
  toggleFileBrowserPopover,
  loadFileBrowserDirectory,
  getFilteredFileBrowserEntries,
  renderFileBrowserPopover,
  activateFileBrowserEntry,
  openSystemFileDialog,
  scanWorkspaceAndSessionFiles,
  closeCurrentDocument,
  navigateToLinkedDocument,
  navigateBackDocument,
  navigateForwardDocument,
  openDocument,
  scheduleDebouncedSync,
  syncDocumentToDisk,
  pollDiskNow,
} from './modules/sync.js';

window.addEventListener('error', (e) => {
  showError(`Runtime error: ${e.message || e.error || 'Unknown error'}`);
});

window.addEventListener('unhandledrejection', (e) => {
  showError(`Unhandled promise rejection: ${e.reason?.message || e.reason || 'Unknown error'}`);
});

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

  // Immediately check disk for external edits when panel regains focus or becomes visible
  window.addEventListener('focus', () => {
    pollDiskNow();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      pollDiskNow();
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

  document.getElementById('btn-open-file')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFileBrowserPopover();
  });

  document.getElementById('btn-close-file')?.addEventListener('click', () => {
    closeCurrentDocument();
  });

  document.getElementById('btn-empty-open-file')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFileBrowserPopover(true);
  });

  document.getElementById('fb-btn-up')?.addEventListener('click', () => {
    if (fileBrowserState.parentDir) {
      loadFileBrowserDirectory(fileBrowserState.parentDir);
    }
  });

  document.getElementById('fb-root-workspace')?.addEventListener('click', () => {
    if (fileBrowserState.workspaceDir) {
      loadFileBrowserDirectory(fileBrowserState.workspaceDir);
    }
  });

  document.getElementById('fb-root-session')?.addEventListener('click', () => {
    if (fileBrowserState.sessionDir) {
      loadFileBrowserDirectory(fileBrowserState.sessionDir);
    }
  });

  document.getElementById('fb-root-home')?.addEventListener('click', () => {
    if (fileBrowserState.homeDir) {
      loadFileBrowserDirectory(fileBrowserState.homeDir);
    }
  });

  document.getElementById('fb-btn-system-dialog')?.addEventListener('click', () => {
    closeFileBrowserPopover();
    openSystemFileDialog();
  });

  const fbInput = document.getElementById('fb-filter-input');
  fbInput?.addEventListener('input', (e) => {
    fileBrowserState.filterText = e.target.value;
    fileBrowserState.selectedIndex = 0;
    renderFileBrowserPopover();
  });

  fbInput?.addEventListener('keydown', async (e) => {
    const entries = getFilteredFileBrowserEntries();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (entries.length > 0) {
        fileBrowserState.selectedIndex = (fileBrowserState.selectedIndex + 1) % entries.length;
        renderFileBrowserPopover();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (entries.length > 0) {
        fileBrowserState.selectedIndex = (fileBrowserState.selectedIndex - 1 + entries.length) % entries.length;
        renderFileBrowserPopover();
      }
    } else if (e.key === 'Backspace' && !fbInput.value && fileBrowserState.parentDir) {
      e.preventDefault();
      await loadFileBrowserDirectory(fileBrowserState.parentDir);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const rawVal = fbInput.value.trim();
      if (rawVal && (rawVal.includes('/') || rawVal.startsWith('~'))) {
        if (/\.(md|markdown)$/i.test(rawVal)) {
          closeFileBrowserPopover();
          await navigateToLinkedDocument(rawVal);
        } else {
          await loadFileBrowserDirectory(rawVal);
        }
        return;
      }
      if (entries[fileBrowserState.selectedIndex]) {
        await activateFileBrowserEntry(entries[fileBrowserState.selectedIndex]);
      } else if (rawVal && /\.(md|markdown)$/i.test(rawVal)) {
        closeFileBrowserPopover();
        await navigateToLinkedDocument(rawVal);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeFileBrowserPopover();
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (fileBrowserState.open && !e.target.closest('.file-selector-wrap')) {
      closeFileBrowserPopover();
    }
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

  document.getElementById('btn-send-review-agent')?.addEventListener('click', () => {
    if (state.cmdOpen && state.cmdMode === 'reviews') closeAllPopovers();
    else openReviewResolutionPrompt();
  });

  document.getElementById('btn-send-review-chat')?.addEventListener('click', () => {
    sendAnnotatedReviewFileToChat();
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

  document.querySelectorAll('.settings-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchSettingsTab(btn.dataset.settingsTab);
    });
  });

  document.getElementById('vale-rules-search')?.addEventListener('input', (e) => {
    state.valeRulesData.filterQuery = e.target.value;
    renderValeRulesTab();
  });

  document.getElementById('vale-filter-active-btn')?.addEventListener('click', () => {
    state.valeRulesData.onlyActiveInDoc = !state.valeRulesData.onlyActiveInDoc;
    renderValeRulesTab();
  });

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

  ['settings-project-input', 'settings-location-input', 'settings-apikey-input', 'settings-model-input'].forEach(
    (id) => {
      document.getElementById(id)?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveStudioAiSettings(false);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeAllPopovers();
        }
      });
    }
  );

  document.getElementById('btn-dismiss-error')?.addEventListener('click', () => clearError());

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
    openCommandPaletteForBlock(null, '', seoPrompt, 'publish');
  });

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
      if (runtime.popoverHideTimer) {
        clearTimeout(runtime.popoverHideTimer);
        runtime.popoverHideTimer = null;
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
      const mode = state.cmdMode;
      const skill = state.cmdSkill || 'draft';
      const blockId = state.cmdBlockId;
      const reviewId = state.cmdReviewId;
      const block = state.blocks.find((b) => b.id === blockId) || null;
      closeAllPopovers();
      if (mode === 'reviews') {
        dispatchReviewCommentsToAgent({ instruction: customText, blockId, reviewId });
      } else {
        dispatchScopedAgentSkill(skill, block, customText);
      }
    }
  });

  document.getElementById('btn-cmd-submit')?.addEventListener('click', () => {
    const mode = state.cmdMode;
    const skill = state.cmdSkill || 'draft';
    const blockId = state.cmdBlockId;
    const reviewId = state.cmdReviewId;
    const block = state.blocks.find((b) => b.id === blockId) || null;
    const customText = cmdInput?.value.trim() || 'Review and improve this passage.';
    closeAllPopovers();
    if (mode === 'reviews') {
      dispatchReviewCommentsToAgent({ instruction: customText, blockId, reviewId });
    } else {
      dispatchScopedAgentSkill(skill, block, customText);
    }
  });

  document.getElementById('btn-cmd-send-chat')?.addEventListener('click', () => {
    const mode = state.cmdMode;
    const blockId = state.cmdBlockId;
    const block = state.blocks.find((b) => b.id === blockId) || null;
    const customText = cmdInput?.value.trim() || '';
    closeAllPopovers();
    if (mode === 'reviews' && !block) {
      sendAnnotatedReviewFileToChat();
    } else {
      sendContextToMainChat(block, customText);
    }
  });

  document.getElementById('canvas-scroll')?.addEventListener('mousedown', (e) => {
    if (
      !e.target.closest('.lens-popover') &&
      !e.target.closest('mark.lens-span') &&
      !e.target.closest('.block-heatmap-pill')
    ) {
      hideLensPopover();
    }
    if (!e.target.closest('.comment-popover') && !e.target.closest('[data-action="comment"]')) {
      closeCommentPopover();
    }
    if (!state.activeBlockId) return;
    if (e.target.closest('.doc-block.is-editing')) return;
    if (
      e.target.closest('.floating-popover') ||
      e.target.closest('.lens-popover') ||
      e.target.closest('.comment-popover')
    )
      return;
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
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      toggleFileBrowserPopover(true);
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

  // Dynamic URL & postMessage watcher for sidecar pill navigation while panel is open
  let pendingOpenFile = null;
  window.__lastObservedSearch = window.location.search;

  const checkUrlFileChanges = () => {
    if (window.location.search === window.__lastObservedSearch) {
      return;
    }
    window.__lastObservedSearch = window.location.search;
    const currentParams = new URLSearchParams(window.location.search);
    const targetFile = currentParams.get('file');
    if (targetFile && targetFile !== state.filePath && targetFile !== pendingOpenFile) {
      pendingOpenFile = targetFile;
      openDocument(targetFile).finally(() => {
        if (pendingOpenFile === targetFile) {
          pendingOpenFile = null;
        }
      });
    } else if (!targetFile && state.filePath && !pendingOpenFile) {
      pendingOpenFile = '';
      closeCurrentDocument();
      pendingOpenFile = null;
    }
  };

  window.addEventListener('popstate', checkUrlFileChanges);
  window.addEventListener('hashchange', checkUrlFileChanges);
  setInterval(checkUrlFileChanges, 300);

  window.addEventListener('message', (event) => {
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data && typeof data === 'object') {
        const file = data.file || data.path || data.filePath;
        if (file && typeof file === 'string' && file !== state.filePath && file !== pendingOpenFile) {
          pendingOpenFile = file;
          openDocument(file).finally(() => {
            if (pendingOpenFile === file) {
              pendingOpenFile = null;
            }
          });
        }
      }
    } catch {}
  });
}

async function bootstrap() {
  initStudioEvents();
  await loadStudioAiSettings();

  const params = new URLSearchParams(window.location.search);
  const deepLinkFile = params.get('file');

  let initialOpenPromise = null;
  if (deepLinkFile) {
    initialOpenPromise = openDocument(deepLinkFile);
  }

  scanWorkspaceAndSessionFiles('').then(async () => {
    if (initialOpenPromise) {
      await initialOpenPromise;
    }
    if (!state.filePath) {
      renderCanvas();
    }
  });

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
