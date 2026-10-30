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
// File Browser, Document Navigation, Live Sync & External Disk Polling
// ---------------------------------------------------------------------------

import {
  state,
  fileBrowserState,
  runtime,
  setHidden,
  escapeHtml,
  pathBasename,
  pathDirname,
  countWordsInText,
  setSyncStatus,
  showError,
  clearError,
} from './state.js';
import { apiPost } from './api.js';
import {
  parseDocumentIntoBlocks,
  serializeBlocksToMarkdown,
  serializeBaselineBlocksToMarkdown,
  recomputeBlockLineNumbers,
  findBlockForLine,
  slugifyHeadingAnchor,
  resetHistoryForDocument,
  recordHistorySnapshot,
} from './markdown.js';
import {
  buildAmbientSpansFromAudit,
} from './diagnostics.js';
import {
  closeAllPopovers,
  hideLensPopover,
  updateHeaderTelemetry,
} from './popovers.js';
import { closeCommentPopover } from './comments.js';
import {
  setStudioMode,
  renderEmptyState,
  renderCanvas,
  enterBlockEditMode,
} from './canvas.js';
import { reconcileExternalDiskUpdate } from './ai.js';

export function updateFilePickerLabel() {
  const newBtn = document.getElementById('btn-new-file');
  const openBtn = document.getElementById('btn-open-file');
  const saveBtn = document.getElementById('btn-save-file');
  const saveAsBtn = document.getElementById('btn-save-as-file');
  const filePill = document.getElementById('active-file-pill');
  const labelEl = document.getElementById('active-file-label');
  const closeBtn = document.getElementById('btn-close-file');
  const sendChatTopBtn = document.getElementById('btn-send-chat-top');
  const isUnsavedDraft = !state.filePath && state.blocks.length > 0;
  const hasDoc = Boolean(state.filePath || state.blocks.length > 0);

  if (labelEl) {
    if (state.filePath) {
      labelEl.textContent = pathBasename(state.filePath);
    } else if (isUnsavedDraft) {
      labelEl.textContent = 'Untitled';
    } else {
      labelEl.textContent = '';
    }
  }

  if (filePill) {
    setHidden(filePill, !hasDoc);
    filePill.classList.toggle('is-unsaved-draft', isUnsavedDraft);
    filePill.setAttribute(
      'data-tooltip',
      state.filePath ? state.filePath : 'Untitled (unsaved file)'
    );
  }

  if (newBtn) {
    newBtn.setAttribute('data-tooltip', 'New File (⌘N)');
  }

  if (openBtn) {
    openBtn.setAttribute('data-tooltip', 'Open File… (⌘O)');
  }

  if (saveBtn) {
    saveBtn.disabled = !hasDoc;
    saveBtn.classList.toggle('is-unsaved-draft', isUnsavedDraft);
    saveBtn.setAttribute(
      'data-tooltip',
      isUnsavedDraft ? 'Save (⌘S)' : 'Save (⌘S)'
    );
  }

  if (saveAsBtn) {
    saveAsBtn.disabled = !hasDoc;
    saveAsBtn.setAttribute('data-tooltip', 'Save As… (⇧⌘S)');
  }

  if (closeBtn) {
    setHidden(closeBtn, !hasDoc);
  }

  if (sendChatTopBtn) {
    setHidden(sendChatTopBtn, !hasDoc);
  }
}

export function startNewFile() {
  if (runtime.pollIntervalId) {
    clearInterval(runtime.pollIntervalId);
    runtime.pollIntervalId = null;
  }
  if (runtime.syncDebounceTimer) {
    clearTimeout(runtime.syncDebounceTimer);
    runtime.syncDebounceTimer = null;
  }
  closeFileBrowserPopover();
  clearError();
  state.filePath = '';
  state.mtimeMs = 0;
  state.fileSize = 0;
  state.lastDiskContent = '';
  state.audit = null;
  state.metrics = { fog: null, slop: null, vale: null, seo: null, geo: null, words: 0, blockHealth: {} };
  state.spans = [];
  state.blocks = [
    {
      id: 'b-1',
      type: 'paragraph',
      level: 0,
      raw: '',
      baselineRaw: '',
      reviews: [],
      startLine: 1,
      endLine: 1,
      diff: null,
      tournament: null,
      busy: false,
      busyLabel: '',
    },
  ];
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('file');
    window.history.replaceState({}, '', url.toString());
  } catch {}
  resetHistoryForDocument('', 'New file');
  setStudioMode('editor');
  updateFilePickerLabel();
  updateDocNavButtons();
  updateHeaderTelemetry();
  renderCanvas();
  enterBlockEditMode('b-1');
  setSyncStatus('idle', 'Untitled — unsaved');
}

export function suggestFilenameFromDraft() {
  for (const b of state.blocks) {
    if (b.type === 'heading' && typeof b.raw === 'string') {
      const headingText = b.raw.replace(/^#{1,6}\s+/, '').trim();
      const slug = slugifyHeadingAnchor(headingText);
      if (slug && slug !== 'draft-title') {
        return `${slug}.md`;
      }
    }
  }
  return 'untitled.md';
}

export function closeFileBrowserPopover() {
  fileBrowserState.open = false;
  fileBrowserState.creatingNewFile = false;
  fileBrowserState.saveDraftMode = false;
  setHidden('file-browser-popover', true);
  setHidden('fb-new-file-bar', true);
  for (const id of ['btn-open-file', 'btn-save-file', 'btn-save-as-file']) {
    const btn = document.getElementById(id);
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      btn.classList.remove('active');
    }
  }
}

export function toggleNewFileBar(forceVisible = undefined, defaultName = '', options = {}) {
  const next = typeof forceVisible === 'boolean' ? forceVisible : !fileBrowserState.creatingNewFile;
  const hasDoc = Boolean(state.filePath || state.blocks.length > 0);
  const saveDraft =
    typeof options.saveDraftMode === 'boolean' ? options.saveDraftMode : hasDoc;

  fileBrowserState.creatingNewFile = next;
  fileBrowserState.saveDraftMode = next ? saveDraft : false;
  setHidden('fb-new-file-bar', !next);
  const confirmBtn = document.getElementById('fb-btn-create-confirm');
  if (confirmBtn) {
    confirmBtn.textContent = 'Save';
  }
  if (next) {
    const inputEl = document.getElementById('fb-new-file-input');
    if (inputEl) {
      const initialVal =
        defaultName ||
        (state.filePath ? pathBasename(state.filePath) : suggestFilenameFromDraft());
      inputEl.value = initialVal;
      inputEl.placeholder = 'filename.md';
      setTimeout(() => {
        inputEl.focus();
        const dotIdx = initialVal.lastIndexOf('.');
        if (dotIdx > 0) {
          inputEl.setSelectionRange(0, dotIdx);
        } else {
          inputEl.select();
        }
      }, 10);
    }
  } else {
    const filterInput = document.getElementById('fb-filter-input');
    setTimeout(() => filterInput?.focus(), 10);
  }
}

export async function openNewFilePrompt(defaultName = '', options = {}) {
  if (!fileBrowserState.open) {
    await toggleFileBrowserPopover(true);
  }
  toggleNewFileBar(true, defaultName, options);
}

export async function openSaveDraftPrompt() {
  const defaultName = state.filePath
    ? pathBasename(state.filePath)
    : suggestFilenameFromDraft();
  await openNewFilePrompt(defaultName, { saveDraftMode: true });
}

export async function openSaveAsPrompt() {
  const defaultName = state.filePath
    ? pathBasename(state.filePath)
    : suggestFilenameFromDraft();
  await openNewFilePrompt(defaultName, { saveDraftMode: true });
}

export async function createNewDocument(rawFilename, rawDir = '', options = {}) {
  const cleanName = String(rawFilename || '').trim();
  if (!cleanName) {
    showError('Please enter a file name for the Markdown document.');
    return false;
  }
  const targetDir =
    rawDir ||
    fileBrowserState.currentDir ||
    (state.filePath ? pathDirname(state.filePath) : state.workspacePath || '');

  const hasDoc = Boolean(state.filePath || state.blocks.length > 0);
  const shouldSaveContent =
    typeof options.saveCurrentDraft === 'boolean'
      ? options.saveCurrentDraft
      : Boolean(fileBrowserState.saveDraftMode || hasDoc);
  const rawEditor = document.getElementById('raw-markdown-editor');
  const currentMarkdown =
    state.studioMode === 'raw' && rawEditor
      ? rawEditor.value.replace(/\r\n/g, '\n')
      : serializeBlocksToMarkdown(state.blocks);
  const initialContent = shouldSaveContent ? currentMarkdown : '';

  try {
    clearError();
    setSyncStatus('saving', 'Saving file…');
    const res = await apiPost('/api/doc/create', {
      dir: targetDir,
      filename: cleanName,
      content: initialContent,
      baseDocPath: state.filePath || '',
      workspacePath: state.workspacePath || '',
      docType: state.docType,
      keyword: state.keyword,
      conversationId: window.sidecar?.conversationId || '',
    });

    closeFileBrowserPopover();
    applyOpenedDocumentResponse(res, { targetMode: state.studioMode === 'raw' ? 'raw' : 'editor' });

    if (state.blocks.length === 0) {
      state.blocks = [
        {
          id: 'b-1',
          type: 'paragraph',
          level: 0,
          raw: '',
          baselineRaw: '',
          reviews: [],
          startLine: 1,
          endLine: 1,
          diff: null,
          tournament: null,
          busy: false,
          busyLabel: '',
        },
      ];
      renderCanvas();
      enterBlockEditMode(state.blocks[0].id);
    }
    return true;
  } catch (err) {
    setSyncStatus('idle', 'Error');
    showError(`Failed to save "${cleanName}":\n${err.message}`);
    return false;
  }
}

export async function toggleFileBrowserPopover(forceOpen = undefined) {
  const next = typeof forceOpen === 'boolean' ? forceOpen : !fileBrowserState.open;
  if (!next) {
    closeFileBrowserPopover();
    return;
  }

  closeAllPopovers();
  hideLensPopover();
  closeCommentPopover();

  fileBrowserState.open = true;
  fileBrowserState.creatingNewFile = false;
  fileBrowserState.saveDraftMode = false;
  fileBrowserState.filterText = '';
  fileBrowserState.selectedIndex = 0;

  setHidden('file-browser-popover', false);
  setHidden('fb-new-file-bar', true);
  const openBtn = document.getElementById('btn-open-file');
  if (openBtn) {
    openBtn.setAttribute('aria-expanded', 'true');
    openBtn.classList.add('active');
  }

  const inputEl = document.getElementById('fb-filter-input');
  if (inputEl) {
    inputEl.value = '';
    setTimeout(() => inputEl.focus(), 10);
  }

  const startDir = state.filePath
    ? pathDirname(state.filePath)
    : fileBrowserState.currentDir || state.workspacePath || '';
  await loadFileBrowserDirectory(startDir);
}

export async function loadFileBrowserDirectory(targetDir = '') {
  try {
    const res = await apiPost('/api/fs/list-dir', {
      dir: targetDir,
      currentFilePath: state.filePath || '',
      workspaceUri: state.workspacePath || '',
      conversationId: window.sidecar?.conversationId || '',
    });

    if (res.isFile && res.filePath) {
      closeFileBrowserPopover();
      await navigateToLinkedDocument(res.filePath);
      return;
    }

    if (res.workspaceDir && !state.workspacePath) {
      state.workspacePath = res.workspaceDir;
    }

    fileBrowserState.currentDir = res.currentDir || '';
    fileBrowserState.parentDir = res.parentDir || '';
    fileBrowserState.homeDir = res.homeDir || '';
    fileBrowserState.workspaceDir = res.workspaceDir || state.workspacePath || '';
    fileBrowserState.sessionDir = res.sessionDir || state.sessionDir || '';
    fileBrowserState.directories = Array.isArray(res.directories) ? res.directories : [];
    fileBrowserState.files = Array.isArray(res.files) ? res.files : [];
    fileBrowserState.filterText = '';
    fileBrowserState.selectedIndex = 0;

    const inputEl = document.getElementById('fb-filter-input');
    if (inputEl) {
      inputEl.value = '';
    }

    renderFileBrowserPopover();
  } catch (err) {
    showError(`Failed to list directory: ${err.message}`);
  }
}

export function getFilteredFileBrowserEntries() {
  const q = (fileBrowserState.filterText || '').trim().toLowerCase();
  const dirs = q
    ? fileBrowserState.directories.filter((d) => d.name.toLowerCase().includes(q))
    : fileBrowserState.directories;
  const files = q
    ? fileBrowserState.files.filter((f) => f.name.toLowerCase().includes(q))
    : fileBrowserState.files;
  return [...dirs, ...files];
}

export function renderFileBrowserPopover() {
  const dirLabel = document.getElementById('fb-current-dir');
  const upBtn = document.getElementById('fb-btn-up');
  const wsBtn = document.getElementById('fb-root-workspace');
  const sessBtn = document.getElementById('fb-root-session');
  const homeBtn = document.getElementById('fb-root-home');
  const listEl = document.getElementById('fb-entry-list');
  if (!listEl) return;

  const home = fileBrowserState.homeDir;
  let displayDir = fileBrowserState.currentDir || '';
  if (home && displayDir.startsWith(home)) {
    displayDir = `~${displayDir.slice(home.length) || '/'}`;
  }
  if (dirLabel) {
    dirLabel.textContent = displayDir;
    dirLabel.title = fileBrowserState.currentDir || '';
  }

  if (upBtn) {
    upBtn.disabled = !fileBrowserState.parentDir;
  }

  if (wsBtn) {
    setHidden(wsBtn, !fileBrowserState.workspaceDir);
    wsBtn.classList.toggle(
      'active',
      Boolean(fileBrowserState.workspaceDir && fileBrowserState.currentDir === fileBrowserState.workspaceDir)
    );
  }
  if (sessBtn) {
    setHidden(sessBtn, !fileBrowserState.sessionDir);
    sessBtn.classList.toggle(
      'active',
      Boolean(fileBrowserState.sessionDir && fileBrowserState.currentDir === fileBrowserState.sessionDir)
    );
  }
  if (homeBtn) {
    homeBtn.classList.toggle('active', Boolean(home && fileBrowserState.currentDir === home));
  }

  const entries = getFilteredFileBrowserEntries();
  if (fileBrowserState.selectedIndex >= entries.length) {
    fileBrowserState.selectedIndex = Math.max(0, entries.length - 1);
  }

  listEl.innerHTML = '';
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'fb-empty-msg';
    empty.textContent = fileBrowserState.filterText
      ? `No matching folders or .md files in this directory.`
      : `No subdirectories or .md files in this folder.`;
    listEl.appendChild(empty);
  } else {
    entries.forEach((entry, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isCurrentDoc = entry.type === 'file' && state.filePath && entry.path === state.filePath;
      btn.className = `fb-entry-item${idx === fileBrowserState.selectedIndex ? ' is-active' : ''}${
        isCurrentDoc ? ' is-current-doc' : ''
      }`;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', idx === fileBrowserState.selectedIndex ? 'true' : 'false');

      const icon = entry.type === 'dir' ? '📁' : '📄';
      const badge = entry.type === 'dir' ? 'Folder ↵' : isCurrentDoc ? 'Active' : '.md';

      btn.innerHTML = `
        <span class="fb-entry-main">
          <span class="fb-entry-icon" aria-hidden="true">${icon}</span>
          <span class="fb-entry-name">${escapeHtml(entry.name)}</span>
        </span>
        <span class="fb-entry-badge">${escapeHtml(badge)}</span>
      `;

      btn.addEventListener('click', () => {
        activateFileBrowserEntry(entry);
      });

      listEl.appendChild(btn);
    });
  }

  const rawFilter = (fileBrowserState.filterText || '').trim();
  if (rawFilter && !rawFilter.includes('/') && !rawFilter.includes('\\')) {
    const candidateName = /\.(md|markdown)$/i.test(rawFilter) ? rawFilter : `${rawFilter}.md`;
    const exactExists = fileBrowserState.files.some(
      (f) => f.name.toLowerCase() === candidateName.toLowerCase()
    );
    if (!exactExists) {
      const isUnsavedDraft = !state.filePath && state.blocks.length > 0;
      const createRowBtn = document.createElement('button');
      createRowBtn.type = 'button';
      createRowBtn.className = 'fb-entry-item fb-entry-create';
      createRowBtn.innerHTML = `
        <span class="fb-entry-main">
          <span class="fb-entry-icon" aria-hidden="true">${isUnsavedDraft ? '💾' : '＋'}</span>
          <span class="fb-entry-name">${isUnsavedDraft ? 'Save draft as' : 'Create'} <strong>${escapeHtml(candidateName)}</strong></span>
        </span>
        <span class="fb-entry-badge">${isUnsavedDraft ? 'Save .md' : 'New .md'}</span>
      `;
      createRowBtn.addEventListener('click', () => {
        createNewDocument(candidateName, fileBrowserState.currentDir, {
          saveCurrentDraft: isUnsavedDraft,
        });
      });
      listEl.appendChild(createRowBtn);
    }
  }

  const activeEl = listEl.querySelector('.fb-entry-item.is-active');
  if (activeEl) {
    activeEl.scrollIntoView({ block: 'nearest' });
  }
}

export async function activateFileBrowserEntry(entry) {
  if (!entry) return;
  if (entry.type === 'dir') {
    await loadFileBrowserDirectory(entry.path);
  } else {
    closeFileBrowserPopover();
    await navigateToLinkedDocument(entry.path);
  }
}

export async function scanWorkspaceAndSessionFiles(workspaceUriOrDir = '') {
  try {
    const res = await apiPost('/api/files', {
      workspaceUri: workspaceUriOrDir || state.workspacePath || '',
      conversationId: window.sidecar?.conversationId || '',
    });

    if (res.workspacePath) state.workspacePath = res.workspacePath;
    if (res.sessionDir) state.sessionDir = res.sessionDir;
    state.files = [];

    updateFilePickerLabel();
    if (!state.filePath && state.blocks.length === 0) {
      renderEmptyState();
    }
    setSyncStatus(
      state.filePath ? 'synced' : 'idle',
      state.filePath ? 'Synced' : 'Ready'
    );
    return state.files;
  } catch (err) {
    setSyncStatus('idle', 'Error');
    showError(`Workspace metadata lookup failed: ${err.message}`);
    return [];
  }
}

export function closeCurrentDocument() {
  if (runtime.pollIntervalId) {
    clearInterval(runtime.pollIntervalId);
    runtime.pollIntervalId = null;
  }
  if (runtime.syncDebounceTimer) {
    clearTimeout(runtime.syncDebounceTimer);
    runtime.syncDebounceTimer = null;
  }
  state.filePath = '';
  state.mtimeMs = 0;
  state.fileSize = 0;
  state.lastDiskContent = '';
  state.blocks = [];
  state.activeBlockId = null;
  state.activeCommentBlockId = null;
  state.audit = null;
  state.metrics = { fog: null, slop: null, vale: null, seo: null, geo: null, words: 0, blockHealth: {} };
  state.spans = [];
  runtime.undoStack = [];
  runtime.redoStack = [];
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('file');
    window.history.replaceState({}, '', url.toString());
  } catch {}
  updateFilePickerLabel();
  updateDocNavButtons();
  updateHeaderTelemetry();
  renderCanvas();
  setSyncStatus('idle', 'Ready');
}

export function scrollToDocumentAnchor(rawAnchor) {
  const cleanAnchor = decodeURIComponent(String(rawAnchor || '').replace(/^#/, '').trim());
  if (!cleanAnchor) return;

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

export function updateDocNavButtons() {
  const cluster = document.getElementById('doc-nav-cluster');
  const backBtn = document.getElementById('btn-nav-back');
  const fwdBtn = document.getElementById('btn-nav-forward');
  if (!cluster || !backBtn || !fwdBtn) return;

  const hasBack = state.docNavBackStack.length > 0;
  const hasFwd = state.docNavForwardStack.length > 0;
  setHidden(cluster, !hasBack && !hasFwd);

  backBtn.disabled = !hasBack;
  backBtn.setAttribute('data-tooltip', 'Back');

  fwdBtn.disabled = !hasFwd;
  fwdBtn.setAttribute('data-tooltip', 'Forward');
}

export async function navigateToLinkedDocument(rawTargetPath, anchor = '') {
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

export async function navigateBackDocument() {
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

export async function navigateForwardDocument() {
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

export function handleMarkdownLinkClick(e, linkEl) {
  const rawHref = (linkEl.getAttribute('data-local-href') || linkEl.getAttribute('href') || '').trim();
  if (!rawHref) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  if (/^(https?:\/\/|mailto:)/i.test(rawHref)) {
    e.stopPropagation();
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  if (rawHref.startsWith('#')) {
    scrollToDocumentAnchor(rawHref.slice(1));
    return;
  }

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

  const hashIdx = rawHref.indexOf('#');
  const pathPart = hashIdx >= 0 ? rawHref.slice(0, hashIdx) : rawHref;
  const hashPart = hashIdx >= 0 ? rawHref.slice(hashIdx + 1) : '';
  navigateToLinkedDocument(pathPart, hashPart);
}

function applyOpenedDocumentResponse(res, options = {}) {
  state.filePath = res.path || '';
  state.mtimeMs = res.mtimeMs || 0;
  state.fileSize = typeof res.size === 'number' ? res.size : 0;
  state.lastDiskContent = typeof res.content === 'string' ? res.content : '';
  state.docType = res.docType || state.docType || 'auto';
  state.keyword = res.keyword ?? state.keyword ?? '';
  if (res.workspacePath && !state.workspacePath) {
    state.workspacePath = res.workspacePath;
  }
  try {
    const url = new URL(window.location.href);
    if (state.filePath) {
      url.searchParams.set('file', state.filePath);
    } else {
      url.searchParams.delete('file');
    }
    window.history.replaceState({}, '', url.toString());
    window.__lastObservedSearch = window.location.search;
  } catch {}

  const hasBaselineDiff =
    typeof res.baselineContent === 'string' &&
    res.baselineContent.replace(/\r\n/g, '\n') !== (res.content || '').replace(/\r\n/g, '\n');

  state.blocks = parseDocumentIntoBlocks(hasBaselineDiff ? res.baselineContent : res.content);
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

  resetHistoryForDocument(
    hasBaselineDiff ? res.baselineContent : res.content,
    `Opened ${state.filePath ? pathBasename(state.filePath) : 'document'}`
  );
  updateFilePickerLabel();
  updateDocNavButtons();

  const kwInput = document.getElementById('keyword-input');
  if (kwInput) kwInput.value = state.keyword;

  const nextMode = options.targetMode || (options.preserveMode ? state.studioMode : 'reader');
  setStudioMode(nextMode);

  if (hasBaselineDiff) {
    reconcileExternalDiskUpdate(res.content, res.audit, res.metrics, {
      fromDisk: true,
      source: '✨ Proposed Agent Edit',
    });
    if (!state.blocks.some((b) => Boolean(b.diff))) {
      syncDocumentToDisk('user', 'Normalized baseline');
    }
  } else {
    setSyncStatus('synced', 'Synced');
    updateHeaderTelemetry();
    renderCanvas();
  }

  const canvasScroll = document.getElementById('canvas-scroll');
  if (options.anchor) {
    setTimeout(() => scrollToDocumentAnchor(options.anchor), 30);
  } else if (typeof options.restoreScrollTop === 'number' && canvasScroll) {
    canvasScroll.scrollTop = options.restoreScrollTop;
  } else if (hasBaselineDiff && state.blocks.some((b) => Boolean(b.diff))) {
    setTimeout(() => {
      const firstDiffCard = document.querySelector('.block-diff-card');
      firstDiffCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
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

export async function openDocument(targetPath, options = {}) {
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
    updateFilePickerLabel();
    showError(`Failed to open "${targetPath}":\n${err.message}`);
    return false;
  }
}

export function scheduleDebouncedSync(source = 'user', label = 'Edited prose') {
  setSyncStatus('saving', state.filePath ? 'Unsaved edits…' : 'Auditing draft…');
  if (runtime.syncDebounceTimer) clearTimeout(runtime.syncDebounceTimer);
  runtime.syncDebounceTimer = setTimeout(() => {
    runtime.syncDebounceTimer = null;
    syncDocumentToDisk(source, label);
  }, 1200);
}

export async function syncDocumentToDisk(source = 'user', label = 'Edited prose', options = {}) {
  if (state.blocks.length === 0 && !state.filePath) return;
  if (runtime.syncDebounceTimer) {
    clearTimeout(runtime.syncDebounceTimer);
    runtime.syncDebounceTimer = null;
  }
  if (runtime.isSyncing) {
    runtime.pendingSyncRequest = { source, label, options };
    return;
  }
  runtime.isSyncing = true;
  setSyncStatus('saving', state.filePath ? 'Syncing…' : 'Auditing…');
  try {
    recomputeBlockLineNumbers();
    const markdown = serializeBlocksToMarkdown(state.blocks);

    if (!state.filePath) {
      const res = await apiPost('/api/audit', {
        text: markdown,
        docType: state.docType,
        keyword: state.keyword,
        workspacePath: state.workspacePath || '',
      });
      if (!runtime.pendingSyncRequest) {
        state.audit = res.audit;
        state.metrics = res.metrics || state.metrics;
        recomputeBlockLineNumbers();
        state.spans = buildAmbientSpansFromAudit(res.audit);
        setSyncStatus('synced', 'Audited');
        updateHeaderTelemetry();
        if (!state.activeBlockId) {
          renderCanvas();
        }
      }
      return;
    }

    const baselineMarkdown = serializeBaselineBlocksToMarkdown(state.blocks);
    const res = await apiPost('/api/doc/sync', {
      path: state.filePath,
      workspacePath: state.workspacePath || '',
      conversationId: window.sidecar?.conversationId || '',
      content: markdown,
      baselineContent: baselineMarkdown,
      source,
      label,
      docType: state.docType,
      keyword: state.keyword,
    });

    state.mtimeMs = res.mtimeMs;
    if (typeof res.size === 'number') state.fileSize = res.size;
    state.lastDiskContent = typeof res.content === 'string' ? res.content : markdown;
    if (!runtime.pendingSyncRequest) {
      state.audit = res.audit;
      state.metrics = res.metrics || state.metrics;
      recomputeBlockLineNumbers();
      state.spans = buildAmbientSpansFromAudit(res.audit);

      const hasPendingDiffs = state.blocks.some((b) => Boolean(b.diff || b.tournament));
      setSyncStatus(
        hasPendingDiffs ? 'agent' : 'synced',
        hasPendingDiffs ? 'Review proposed edit' : 'Saved & Audited'
      );
      updateHeaderTelemetry();
      if (!state.activeBlockId) {
        renderCanvas();
      }
    }

    if (res.auditError) {
      showError(`Saved to disk, but audit returned an error:\n${res.auditError}`);
    }
  } catch (err) {
    setSyncStatus('idle', 'Sync Error');
    showError(`Sync failed: ${err.message}`);
  } finally {
    runtime.isSyncing = false;
    if (runtime.pendingSyncRequest) {
      const next = runtime.pendingSyncRequest;
      runtime.pendingSyncRequest = null;
      await syncDocumentToDisk(next.source, next.label, next.options);
    }
  }
}

export async function pollDiskNow() {
  if (
    !state.filePath ||
    state.activeBlockId ||
    runtime.isSyncing ||
    runtime.syncDebounceTimer ||
    runtime.isPollingDisk
  ) {
    return;
  }
  runtime.isPollingDisk = true;
  try {
    const hasPendingDiffs = state.blocks.some((b) => Boolean(b.diff));
    const currentMd = state.lastDiskContent || serializeBlocksToMarkdown(state.blocks);
    const res = await apiPost('/api/doc/poll', {
      path: state.filePath,
      workspacePath: state.workspacePath || '',
      conversationId: window.sidecar?.conversationId || '',
      knownMtimeMs: state.mtimeMs,
      currentContent: currentMd,
      hasPendingDiffs,
      docType: state.docType,
      keyword: state.keyword,
    });
    if (!state.filePath || state.activeBlockId || runtime.isSyncing || runtime.syncDebounceTimer) {
      return;
    }
    if (res && !res.changed && typeof res.mtimeMs === 'number') {
      state.mtimeMs = res.mtimeMs;
      if (typeof res.size === 'number') state.fileSize = res.size;
      return;
    }
    if (typeof res?.mtimeMs === 'number') state.mtimeMs = res.mtimeMs;
    if (typeof res?.size === 'number') state.fileSize = res.size;
    if (res?.auditError) {
      showError(`Live disk audit error:\n${res.auditError}`);
    }
    if (res?.changed && typeof res.content === 'string') {
      state.lastDiskContent = res.content;
      state.activeBlockId = null;
      const hadBaselineMismatch =
        !state.blocks.some((b) => Boolean(b.diff)) &&
        typeof res.baselineContent === 'string' &&
        res.baselineContent.replace(/\r\n/g, '\n') !== res.content.replace(/\r\n/g, '\n');
      if (hadBaselineMismatch) {
        state.blocks = parseDocumentIntoBlocks(res.baselineContent);
        recomputeBlockLineNumbers();
      }
      if (state.blocks.length > 0) {
        reconcileExternalDiskUpdate(res.content, res.audit, res.metrics, {
          fromDisk: true,
          source: '✨ Proposed Agent Edit',
        });
        if (hadBaselineMismatch && !state.blocks.some((b) => Boolean(b.diff))) {
          await syncDocumentToDisk('user', 'Normalized baseline');
        }
      } else {
        state.blocks = parseDocumentIntoBlocks(res.content);
        recomputeBlockLineNumbers();
        state.audit = res.audit;
        state.metrics = res.metrics || state.metrics;
        state.spans = buildAmbientSpansFromAudit(res.audit);
        if (state.studioMode === 'raw') {
          const rawEditor = document.getElementById('raw-markdown-editor');
          if (rawEditor) {
            rawEditor.value = res.content;
          }
        }
        recordHistorySnapshot('Synced external disk update');
        setSyncStatus('synced', 'Synced from disk');
        updateHeaderTelemetry();
        renderCanvas();
      }
    }
  } catch (err) {
    showError(`Live file poll failed: ${err.message}`);
  } finally {
    runtime.isPollingDisk = false;
  }
}

export function startLiveDiskPolling() {
  if (runtime.pollIntervalId) clearInterval(runtime.pollIntervalId);
  runtime.pollIntervalId = setInterval(() => {
    pollDiskNow();
  }, 1000);
}
