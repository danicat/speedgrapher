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
} from './canvas.js';

export function updateFilePickerLabel() {
  const openBtn = document.getElementById('btn-open-file');
  const labelEl = document.getElementById('active-file-label');
  const closeBtn = document.getElementById('btn-close-file');

  if (labelEl) {
    if (state.filePath) {
      labelEl.textContent = pathBasename(state.filePath);
    } else if (state.blocks.length > 0) {
      labelEl.textContent = 'Unsaved Draft (Open .md…)';
    } else {
      labelEl.textContent = 'Open .md file…';
    }
  }

  if (openBtn) {
    openBtn.classList.toggle('has-file', Boolean(state.filePath));
    openBtn.setAttribute('data-tooltip', 'Open file');
  }

  if (closeBtn) {
    setHidden(closeBtn, !state.filePath && state.blocks.length === 0);
  }
}

export function closeFileBrowserPopover() {
  fileBrowserState.open = false;
  setHidden('file-browser-popover', true);
  const openBtn = document.getElementById('btn-open-file');
  if (openBtn) {
    openBtn.setAttribute('aria-expanded', 'false');
    openBtn.classList.remove('active');
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
  fileBrowserState.filterText = '';
  fileBrowserState.selectedIndex = 0;

  setHidden('file-browser-popover', false);
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
    return;
  }

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

export async function openSystemFileDialog() {
  const openBtn = document.getElementById('btn-open-file');
  try {
    if (openBtn) openBtn.disabled = true;
    clearError();
    const startDir =
      fileBrowserState.currentDir ||
      (state.filePath ? pathDirname(state.filePath) : state.workspacePath || '');
    const res = await apiPost('/api/dialog/open-file', {
      startDir,
      currentFilePath: state.filePath || '',
      workspaceUri: state.workspacePath || '',
      conversationId: window.sidecar?.conversationId || '',
    });
    if (res.canceled || !res.path) {
      return false;
    }
    await navigateToLinkedDocument(res.path);
    return true;
  } catch (err) {
    showError(`Failed to open system file dialog: ${err.message}`);
    return false;
  } finally {
    if (openBtn) openBtn.disabled = false;
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
  updateFilePickerLabel();
  updateDocNavButtons();

  const kwInput = document.getElementById('keyword-input');
  if (kwInput) kwInput.value = state.keyword;

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
    if (typeof res.size === 'number') state.fileSize = res.size;
    state.lastDiskContent = typeof res.content === 'string' ? res.content : markdown;
    if (!runtime.pendingSyncRequest) {
      state.audit = res.audit;
      state.metrics = res.metrics || state.metrics;
      recomputeBlockLineNumbers();
      state.spans = buildAmbientSpansFromAudit(res.audit);

      setSyncStatus('synced', 'Saved & Audited');
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
    const currentMd = state.lastDiskContent || serializeBlocksToMarkdown(state.blocks);
    const res = await apiPost('/api/doc/poll', {
      path: state.filePath,
      workspacePath: state.workspacePath || '',
      conversationId: window.sidecar?.conversationId || '',
      knownMtimeMs: state.mtimeMs,
      currentContent: currentMd,
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
