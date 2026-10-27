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

import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Response } from 'sidecar_sdk';

export const PANEL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PLUGIN_ROOT = resolve(PANEL_DIR, '..', '..');
const BIN_NAME = process.platform === 'win32' ? 'speedgrapher.exe' : 'speedgrapher';
const LOCAL_BIN_PATH = join(PLUGIN_ROOT, 'bin', BIN_NAME);
const GOBIN_PATH = join(homedir(), 'go', 'bin', BIN_NAME);

export const SESSION_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
export const ALLOWED_MD_EXTENSIONS = new Set(['.md', '.markdown']);
export const allowedSessionFiles = new Set();

let registeredSidecarApp = null;

export function setSidecarApp(sidecarApp) {
  registeredSidecarApp = sidecarApp;
}

export function getSidecarApp() {
  return registeredSidecarApp;
}

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

export function getBinaryPath() {
  if (existsSync(LOCAL_BIN_PATH)) {
    return LOCAL_BIN_PATH;
  }
  if (existsSync(GOBIN_PATH)) {
    return GOBIN_PATH;
  }
  throw new Error(
    `Speedgrapher binary not found at "${LOCAL_BIN_PATH}" or "${GOBIN_PATH}". Run "make build" in "${PLUGIN_ROOT}" or "go install ./cmd/speedgrapher" to build the binary.`
  );
}

export function buildSubprocessEnv() {
  const currentPath = process.env.PATH || '';
  const goBinDir = join(homedir(), 'go', 'bin');
  const extraDirs =
    process.platform === 'win32'
      ? [goBinDir]
      : ['/opt/homebrew/bin', '/usr/local/bin', goBinDir];
  const parts = currentPath.split(delimiter).filter(Boolean);
  for (const dir of extraDirs) {
    if (!parts.includes(dir)) {
      parts.push(dir);
    }
  }
  return {
    ...process.env,
    PATH: parts.join(delimiter),
  };
}

export function jsonError(message, status = 500, details = undefined) {
  const payload = { error: message, statusCode: status };
  if (details !== undefined) {
    payload.details = details;
  }
  console.error(`[speedgrapher] API error (${status}): ${message}`);
  return new Response(JSON.stringify(payload), {
    status,
    contentType: 'application/json; charset=utf-8',
  });
}

export function getSettingsDir() {
  const dataDir = (process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR || '').trim();
  if (!dataDir) {
    throw new Error(
      'ANTIGRAVITY_EXECUTABLE_DATA_DIR environment variable is not set; refusing to fall back to plugin directory.'
    );
  }
  const settingsDir = join(resolve(dataDir), 'studio-state');
  mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
  return settingsDir;
}

export function findHugoRoot(startDir) {
  if (!startDir || typeof startDir !== 'string') return null;
  let curr = resolve(startDir);
  const hugoConfigs = ['hugo.toml', 'hugo.yaml', 'hugo.json', 'config.toml', 'config.yaml', 'config.json'];
  while (true) {
    for (const cfg of hugoConfigs) {
      const candidate = join(curr, cfg);
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return curr;
      }
    }
    const parent = dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return null;
}

function resolveHugoCandidateFile(candidatePath) {
  if (!candidatePath) return '';
  if (existsSync(candidatePath)) {
    try {
      const st = statSync(candidatePath);
      if (st.isFile()) return candidatePath;
      if (st.isDirectory()) {
        for (const idx of ['index.md', '_index.md', 'index.markdown', '_index.markdown']) {
          const idxFile = join(candidatePath, idx);
          if (existsSync(idxFile) && statSync(idxFile).isFile()) {
            return idxFile;
          }
        }
      }
    } catch {}
  }
  for (const ext of ['.md', '.markdown']) {
    if (!candidatePath.toLowerCase().endsWith(ext)) {
      const withExt = `${candidatePath}${ext}`;
      if (existsSync(withExt)) {
        try {
          if (statSync(withExt).isFile()) return withExt;
        } catch {}
      }
    }
  }
  return '';
}

export function normalizeTargetPath(rawPath, baseDocPath = '', workspaceDir = '') {
  if (!rawPath || typeof rawPath !== 'string') {
    return '';
  }
  let trimmed = rawPath.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.includes('\0')) {
    throw new Error('Invalid file path: null byte detected.');
  }
  const hugoRefMatch = trimmed.match(/^\{\{[<%]?\s*(?:ref|relref)\s+["']?([^"'\s>}]+)["']?[\s\S]*?\}\}$/i);
  if (hugoRefMatch && hugoRefMatch[1]) {
    trimmed = hugoRefMatch[1].trim();
  }
  trimmed = trimmed.split('#')[0].split('?')[0].trim();
  if (/%[0-9A-Fa-f]{2}/.test(trimmed)) {
    try {
      trimmed = decodeURIComponent(trimmed);
    } catch {}
  }
  trimmed = trimmed.split('#')[0].split('?')[0].trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.includes('\0')) {
    throw new Error('Invalid file path: null byte detected.');
  }
  const home = homedir();
  if (trimmed === '~') {
    return home;
  }
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return resolve(home, trimmed.slice(2));
  }
  if (trimmed.startsWith('file://')) {
    return resolve(fileURLToPath(trimmed));
  }

  let baseDir = '';
  if (baseDocPath && typeof baseDocPath === 'string' && baseDocPath.trim()) {
    const normalizedBase = normalizeTargetPath(baseDocPath);
    baseDir =
      existsSync(normalizedBase) && statSync(normalizedBase).isDirectory()
        ? normalizedBase
        : dirname(normalizedBase);
  }
  const normalizedWs =
    workspaceDir && typeof workspaceDir === 'string' && workspaceDir.trim()
      ? normalizeTargetPath(workspaceDir)
      : '';

  if (trimmed.startsWith('/') && !existsSync(trimmed) && (baseDir || normalizedWs)) {
    const relFromRoot = trimmed.replace(/^\/+/, '');
    const hugoRoot = findHugoRoot(baseDir || normalizedWs);
    const searchRoots = [
      hugoRoot ? join(hugoRoot, 'content') : '',
      hugoRoot || '',
      normalizedWs,
      baseDir,
    ].filter(Boolean);
    for (const root of searchRoots) {
      const hit = resolveHugoCandidateFile(resolve(root, relFromRoot));
      if (hit) return hit;
    }
  }

  const isAbsoluteUnixOrWin = trimmed.startsWith('/') || isAbsolute(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed);
  if (!isAbsoluteUnixOrWin) {
    if (baseDir) {
      const candidateFromDoc = resolve(baseDir, trimmed);
      const hitFromDoc = resolveHugoCandidateFile(candidateFromDoc);
      if (hitFromDoc) return hitFromDoc;

      const hugoRoot = findHugoRoot(baseDir);
      if (hugoRoot) {
        const hitFromHugoContent = resolveHugoCandidateFile(resolve(hugoRoot, 'content', trimmed));
        if (hitFromHugoContent) return hitFromHugoContent;
      }

      if (existsSync(candidateFromDoc) || !normalizedWs) {
        return candidateFromDoc;
      }
    }
    if (normalizedWs) {
      const candidateFromWs = resolve(normalizedWs, trimmed);
      const hitFromWs = resolveHugoCandidateFile(candidateFromWs);
      if (hitFromWs) return hitFromWs;
      return candidateFromWs;
    }
  }
  return resolve(trimmed);
}

function getAppDataDir() {
  if (process.env.ANTIGRAVITY_APP_DATA_DIR) {
    const configured = process.env.ANTIGRAVITY_APP_DATA_DIR.trim();
    if (existsSync(configured)) {
      return resolve(configured);
    }
  }
  const defaultDir = join(homedir(), '.gemini', 'antigravity');
  if (existsSync(defaultDir)) {
    return defaultDir;
  }
  return null;
}

export function getSessionArtifactDir(requestedConversationId = '') {
  const cleanConvId =
    typeof requestedConversationId === 'string' && SESSION_ID_RE.test(requestedConversationId.trim())
      ? requestedConversationId.trim()
      : (process.env.ANTIGRAVITY_CONVERSATION_ID || '').trim();
  const appDataDir = getAppDataDir();
  if (appDataDir && cleanConvId && SESSION_ID_RE.test(cleanConvId)) {
    const candidateSessionDir = join(appDataDir, 'brain', cleanConvId);
    if (existsSync(candidateSessionDir) && statSync(candidateSessionDir).isDirectory()) {
      return candidateSessionDir;
    }
  }
  return null;
}

function extractWorkspaceFromTranscript(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return null;
  }
  const st = statSync(transcriptPath);
  if (!st.isFile() || st.size === 0) return null;

  const fd = openSync(transcriptPath, 'r');
  try {
    const headLen = Math.min(49152, st.size);
    const headBuf = Buffer.alloc(headLen);
    readSync(fd, headBuf, 0, headLen, 0);
    let sample = headBuf.toString('utf8');

    if (st.size > headLen) {
      const tailLen = Math.min(49152, st.size - headLen);
      const tailBuf = Buffer.alloc(tailLen);
      readSync(fd, tailBuf, 0, tailLen, st.size - tailLen);
      sample = `${sample}\n${tailBuf.toString('utf8')}`;
    }

    const activeWsMatch = sample.match(/Active Workspaces:\s*(?:\\n|\r?\n)-\s*([^\r\n"]+)/);
    if (activeWsMatch?.[1]) {
      const candidate = activeWsMatch[1]
        .split(/(?<!\\)\\[rn]/)[0]
        .replace(/\\\\/g, '\\')
        .trim();
      if (existsSync(candidate) && statSync(candidate).isDirectory()) {
        return candidate;
      }
    }

    const cwdMatch = sample.match(/Command Working Directory:\s*([^\r\n"]+)/);
    if (cwdMatch?.[1]) {
      const candidate = cwdMatch[1]
        .split(/(?<!\\)\\[rn]/)[0]
        .replace(/\\\\/g, '\\')
        .trim();
      if (existsSync(candidate) && statSync(candidate).isDirectory()) {
        return candidate;
      }
    }

    const uriMatch = sample.match(/workspaceUris\\?":\s*\[\s*\\?"(file:\/\/[^"\\]+)\\?"/);
    if (uriMatch?.[1]) {
      const candidate = fileURLToPath(uriMatch[1]);
      if (existsSync(candidate) && statSync(candidate).isDirectory()) {
        return candidate;
      }
    }
  } finally {
    closeSync(fd);
  }
  return null;
}

export function discoverActiveConversationId() {
  const appDataDir = getAppDataDir();
  if (!appDataDir) return null;
  const brainDir = join(appDataDir, 'brain');
  if (!existsSync(brainDir)) return null;

  try {
    const entries = readdirSync(brainDir, { withFileTypes: true });
    const candidates = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || !SESSION_ID_RE.test(entry.name)) {
        continue;
      }
      const dirPath = join(brainDir, entry.name);
      const transcriptPath = join(dirPath, '.system_generated', 'logs', 'transcript.jsonl');
      try {
        const target = existsSync(transcriptPath) ? transcriptPath : dirPath;
        const st = statSync(target);
        candidates.push({ id: entry.name, mtimeMs: st.mtimeMs });
      } catch {
        // ignore unreadable
      }
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0]?.id || null;
  } catch {
    return null;
  }
}

export function resolveActiveWorkspaceAndSession(requestedConversationId = '', requestedDirOrUri = '') {
  let cleanConvId =
    typeof requestedConversationId === 'string' && SESSION_ID_RE.test(requestedConversationId.trim())
      ? requestedConversationId.trim()
      : (process.env.ANTIGRAVITY_CONVERSATION_ID || '').trim();

  if (!cleanConvId) {
    cleanConvId = discoverActiveConversationId() || '';
  }

  const sessionDir = cleanConvId ? getSessionArtifactDir(cleanConvId) : null;
  let transcriptPath = null;
  if (sessionDir) {
    const tp = join(sessionDir, '.system_generated', 'logs', 'transcript.jsonl');
    if (existsSync(tp)) {
      transcriptPath = tp;
    }
  }

  let workspaceDir = null;
  if (requestedDirOrUri && typeof requestedDirOrUri === 'string' && requestedDirOrUri.trim()) {
    const normalized = normalizeTargetPath(requestedDirOrUri);
    if (!existsSync(normalized)) {
      throw new Error(`Workspace directory does not exist on disk: ${normalized}`);
    }
    const st = statSync(normalized);
    workspaceDir = st.isDirectory() ? normalized : dirname(normalized);
  }

  // 1. Try querying workspace metadata directly from registered SidecarApp (Antigravity Language Server bridge)
  if (!workspaceDir && cleanConvId && registeredSidecarApp && typeof registeredSidecarApp.getConversationMetadata === 'function') {
    try {
      const raw = registeredSidecarApp.getConversationMetadata(cleanConvId);
      const metadata =
        raw?.response?.conversationMetadata?.metadata ||
        raw?.response?.conversation_metadata?.metadata ||
        raw?.metadata;
      const wsUris = Array.isArray(metadata?.workspaceUris) ? metadata.workspaceUris : [];
      const workspaces = Array.isArray(metadata?.workspaces) ? metadata.workspaces : [];
      const primaryUri = wsUris[0] || workspaces[0]?.workspaceFolderAbsoluteUri;
      if (primaryUri && typeof primaryUri === 'string' && primaryUri.startsWith('file://')) {
        const candidate = fileURLToPath(primaryUri);
        if (existsSync(candidate) && statSync(candidate).isDirectory()) {
          workspaceDir = candidate;
        }
      }
    } catch (err) {
      console.warn(`[speedgrapher] Failed to query conversation metadata for "${cleanConvId}": ${err.message}`);
    }
  }

  // 2. Try extracting from transcript
  if (!workspaceDir && transcriptPath) {
    workspaceDir = extractWorkspaceFromTranscript(transcriptPath);
  }

  // 3. Try WORKSPACE_ROOT env
  if (!workspaceDir && process.env.WORKSPACE_ROOT && existsSync(process.env.WORKSPACE_ROOT)) {
    workspaceDir = resolve(process.env.WORKSPACE_ROOT);
  }

  return {
    conversationId: cleanConvId,
    workspaceDir,
    sessionDir,
  };
}

export function isPathInsideDir(targetCanonicalPath, dirPath) {
  if (!dirPath || typeof dirPath !== 'string' || !existsSync(dirPath)) {
    return false;
  }
  const canonicalRoot = realpathSync(dirPath);
  const rel = relative(canonicalRoot, targetCanonicalPath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function validateAllowedMarkdownPath(targetPath, workspaceDir = '', conversationId = '') {
  if (!targetPath || typeof targetPath !== 'string' || !targetPath.trim()) {
    const err = new Error('Missing required Markdown file path.');
    err.statusCode = 400;
    throw err;
  }

  const ext = extname(targetPath).toLowerCase();
  if (!ALLOWED_MD_EXTENSIONS.has(ext)) {
    const err = new Error(
      `Unsupported file extension "${ext || '(none)'}" for "${targetPath}". Only .md and .markdown files are allowed.`
    );
    err.statusCode = 400;
    throw err;
  }

  let canonicalPath;
  if (existsSync(targetPath)) {
    canonicalPath = realpathSync(targetPath);
  } else {
    const parentDir = dirname(targetPath);
    if (!existsSync(parentDir)) {
      const err = new Error(`Parent directory does not exist on disk: ${parentDir}`);
      err.statusCode = 400;
      throw err;
    }
    canonicalPath = join(realpathSync(parentDir), basename(targetPath));
  }

  const info = resolveActiveWorkspaceAndSession(conversationId, workspaceDir);
  const sessionArtifactDir = info.sessionDir || getSessionArtifactDir(conversationId);

  const inWorkspace = info.workspaceDir ? isPathInsideDir(canonicalPath, info.workspaceDir) : false;
  const inSession = sessionArtifactDir ? isPathInsideDir(canonicalPath, sessionArtifactDir) : false;
  const inAllowedSessionFiles = allowedSessionFiles.has(canonicalPath);

  if (!inWorkspace && !inSession && !inAllowedSessionFiles) {
    const err = new Error(
      `Access denied: "${canonicalPath}" is outside the active workspace and session artifact directory.`
    );
    err.statusCode = 403;
    throw err;
  }

  return canonicalPath;
}

function parseImageQueryParams(reqOrData, maybeReq) {
  let rawPath = '';
  let rawDoc = '';
  let rawWs = '';

  const urlCandidate =
    (typeof maybeReq?.url === 'string' && maybeReq.url.includes('?') ? maybeReq.url : '') ||
    (typeof reqOrData?.url === 'string' && reqOrData.url.includes('?') ? reqOrData.url : '');

  if (urlCandidate) {
    const parsed = new URL(urlCandidate, 'http://localhost');
    rawPath = parsed.searchParams.get('path') || '';
    rawDoc = parsed.searchParams.get('doc') || '';
    rawWs = parsed.searchParams.get('ws') || '';
  } else if (reqOrData?.query && typeof reqOrData.query === 'object') {
    rawPath = typeof reqOrData.query.path === 'string' ? reqOrData.query.path : '';
    rawDoc = typeof reqOrData.query.doc === 'string' ? reqOrData.query.doc : '';
    rawWs = typeof reqOrData.query.ws === 'string' ? reqOrData.query.ws : '';
  } else if (reqOrData && typeof reqOrData === 'object') {
    rawPath = typeof reqOrData.path === 'string' ? reqOrData.path : '';
    rawDoc = typeof reqOrData.doc === 'string' ? reqOrData.doc : '';
    rawWs = typeof reqOrData.ws === 'string' ? reqOrData.ws : '';
  }

  return { rawPath, rawDoc, rawWs };
}

export function handleGetImage(reqOrData, maybeReq) {
  const { rawPath, rawDoc, rawWs } = parseImageQueryParams(reqOrData, maybeReq);

  if (
    !rawPath ||
    typeof rawPath !== 'string' ||
    !rawPath.trim() ||
    rawPath.includes('\0') ||
    rawDoc.includes('\0') ||
    rawWs.includes('\0')
  ) {
    return jsonError('Missing or invalid image path.', 400);
  }

  let rawSrc = rawPath.trim();
  rawSrc = rawSrc.split('#')[0].split('?')[0].trim();
  if (/%[0-9A-Fa-f]{2}/.test(rawSrc)) {
    try {
      rawSrc = decodeURIComponent(rawSrc);
    } catch {}
  }
  rawSrc = rawSrc.split('#')[0].split('?')[0].trim();
  if (!rawSrc || rawSrc.includes('\0')) {
    return jsonError('Missing or invalid image path.', 400);
  }

  let docPath = '';
  let wsPath = '';
  try {
    if (rawDoc && rawDoc.trim()) {
      docPath = normalizeTargetPath(rawDoc);
    }
    if (rawWs && rawWs.trim()) {
      wsPath = normalizeTargetPath(rawWs);
    }
  } catch (err) {
    return jsonError(`Invalid document or workspace path: ${err.message}`, 400);
  }

  const docDir = docPath
    ? existsSync(docPath) && statSync(docPath).isDirectory()
      ? docPath
      : dirname(docPath)
    : '';
  const hugoRoot = docDir ? findHugoRoot(docDir) : wsPath ? findHugoRoot(wsPath) : null;

  let resolvedPath = '';
  if (rawSrc.startsWith('file://') || rawSrc === '~' || rawSrc.startsWith('~/') || rawSrc.startsWith('~\\')) {
    try {
      resolvedPath = normalizeTargetPath(rawSrc);
    } catch (err) {
      return jsonError(`Invalid image path: ${err.message}`, 400);
    }
  } else if (rawSrc.startsWith('/') || isAbsolute(rawSrc)) {
    const relFromRoot = rawSrc.replace(/^[/\\]+/, '');
    const hugoStaticCandidate = hugoRoot && rawSrc.startsWith('/') ? join(hugoRoot, 'static', relFromRoot) : '';
    const wsCandidate = wsPath && rawSrc.startsWith('/') ? join(wsPath, relFromRoot) : '';

    if (hugoStaticCandidate && existsSync(hugoStaticCandidate) && statSync(hugoStaticCandidate).isFile()) {
      resolvedPath = hugoStaticCandidate;
    } else if (wsCandidate && existsSync(wsCandidate) && statSync(wsCandidate).isFile()) {
      resolvedPath = wsCandidate;
    } else {
      resolvedPath = resolve(rawSrc);
    }
  } else {
    if (docDir) {
      resolvedPath = resolve(docDir, rawSrc);
    } else if (wsPath) {
      resolvedPath = resolve(wsPath, rawSrc);
    } else {
      return jsonError('Missing or invalid image path: relative image path requires "doc" or "ws" context.', 400);
    }
  }

  if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
    return jsonError(`Image file not found on disk: ${resolvedPath}`, 404);
  }

  let canonicalImagePath;
  try {
    canonicalImagePath = realpathSync(resolvedPath);
  } catch (err) {
    return jsonError(`Failed to resolve canonical image path: ${err.message}`, 400);
  }

  const allowedRoots = [docDir, hugoRoot, wsPath].filter(Boolean);
  const isAllowed = allowedRoots.some((root) => isPathInsideDir(canonicalImagePath, root));
  if (!isAllowed) {
    return jsonError(
      `Access denied: image "${canonicalImagePath}" is outside the active document directory, Hugo root, and workspace root.`,
      403
    );
  }

  const ext = extname(canonicalImagePath).toLowerCase();
  const mimeType = MIME_BY_EXT[ext];
  if (!mimeType) {
    return jsonError(`Unsupported image extension: ${ext}`, 415);
  }

  return new Response(readFileSync(canonicalImagePath), {
    status: 200,
    contentType: mimeType,
    headers: {
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function handleGetFiles(data) {
  const requestedDir = typeof data?.workspaceUri === 'string' ? data.workspaceUri : '';
  const requestedConvId = typeof data?.conversationId === 'string' ? data.conversationId : '';

  let info;
  try {
    info = resolveActiveWorkspaceAndSession(requestedConvId, requestedDir);
  } catch (err) {
    return jsonError(`Failed to resolve workspace directory: ${err.message}`, 400);
  }

  return {
    workspacePath: info.workspaceDir || '',
    sessionDir: info.sessionDir || '',
    conversationId: info.conversationId || '',
    files: [],
  };
}

export function handleListDirectory(data) {
  const requestedDir = typeof data?.workspaceUri === 'string' ? data.workspaceUri : '';
  const requestedConvId = typeof data?.conversationId === 'string' ? data.conversationId : '';
  const rawDir = typeof data?.dir === 'string' ? data.dir.trim() : '';
  const currentFilePath = typeof data?.currentFilePath === 'string' ? data.currentFilePath.trim() : '';

  let info;
  try {
    info = resolveActiveWorkspaceAndSession(requestedConvId, requestedDir);
  } catch (err) {
    return jsonError(`Failed to resolve workspace directory: ${err.message}`, 400);
  }

  const home = homedir();
  let targetDir = '';

  if (rawDir) {
    try {
      const norm = normalizeTargetPath(rawDir, currentFilePath, info.workspaceDir || '');
      if (!existsSync(norm)) {
        return jsonError(`Directory does not exist on disk: ${norm}`, 404);
      }
      const st = statSync(norm);
      if (st.isFile()) {
        const ext = extname(norm).toLowerCase();
        if (ALLOWED_MD_EXTENSIONS.has(ext)) {
          const canonicalFile = realpathSync(norm);
          allowedSessionFiles.add(canonicalFile);
          return {
            isFile: true,
            filePath: canonicalFile,
            currentDir: dirname(canonicalFile),
          };
        }
        targetDir = dirname(norm);
      } else if (st.isDirectory()) {
        targetDir = norm;
      }
    } catch (err) {
      return jsonError(`Invalid directory path "${rawDir}": ${err.message}`, 400);
    }
  }

  if (!targetDir && currentFilePath) {
    try {
      const normCurrent = normalizeTargetPath(currentFilePath, '', info.workspaceDir || '');
      const candidateDir =
        existsSync(normCurrent) && statSync(normCurrent).isDirectory() ? normCurrent : dirname(normCurrent);
      if (candidateDir && existsSync(candidateDir) && statSync(candidateDir).isDirectory()) {
        targetDir = candidateDir;
      }
    } catch {}
  }

  if (!targetDir) {
    if (info.workspaceDir && existsSync(info.workspaceDir) && statSync(info.workspaceDir).isDirectory()) {
      targetDir = info.workspaceDir;
    } else if (info.sessionDir && existsSync(info.sessionDir) && statSync(info.sessionDir).isDirectory()) {
      targetDir = info.sessionDir;
    } else {
      targetDir = home;
    }
  }

  let canonicalDir;
  try {
    canonicalDir = realpathSync(targetDir);
  } catch (err) {
    return jsonError(`Failed to resolve directory "${targetDir}": ${err.message}`, 400);
  }

  let dirents;
  try {
    dirents = readdirSync(canonicalDir, { withFileTypes: true });
  } catch (err) {
    return jsonError(`Failed to read directory "${canonicalDir}": ${err.message}`, 403);
  }

  const directories = [];
  const files = [];

  for (const d of dirents) {
    if (!d.name || d.name.startsWith('.') || d.name === 'node_modules') {
      continue;
    }
    const fullPath = join(canonicalDir, d.name);
    let isDir = d.isDirectory();
    let isFile = d.isFile();
    let mtimeMs = 0;

    if (d.isSymbolicLink()) {
      try {
        const st = statSync(fullPath);
        isDir = st.isDirectory();
        isFile = st.isFile();
        mtimeMs = st.mtimeMs;
      } catch {
        continue;
      }
    } else if (isFile) {
      try {
        mtimeMs = statSync(fullPath).mtimeMs;
      } catch {}
    }

    if (isDir) {
      directories.push({
        name: d.name,
        path: fullPath,
        type: 'dir',
      });
    } else if (isFile) {
      const ext = extname(d.name).toLowerCase();
      if (ALLOWED_MD_EXTENSIONS.has(ext)) {
        allowedSessionFiles.add(fullPath);
        files.push({
          name: d.name,
          path: fullPath,
          type: 'file',
          mtimeMs,
        });
      }
    }
  }

  directories.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const priorityNames = new Set(['readme.md', 'skill.md', 'index.md', '_index.md']);
  files.sort((a, b) => {
    const aPri = priorityNames.has(a.name.toLowerCase()) ? 0 : 1;
    const bPri = priorityNames.has(b.name.toLowerCase()) ? 0 : 1;
    if (aPri !== bPri) return aPri - bPri;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  const parentDir = dirname(canonicalDir) !== canonicalDir ? dirname(canonicalDir) : '';

  return {
    isFile: false,
    currentDir: canonicalDir,
    parentDir,
    homeDir: home,
    workspaceDir: info.workspaceDir || '',
    sessionDir: info.sessionDir || '',
    directories,
    files,
  };
}

export function handleOpenFileDialog(data) {
  const requestedDir = typeof data?.workspaceUri === 'string' ? data.workspaceUri : '';
  const requestedConvId = typeof data?.conversationId === 'string' ? data.conversationId : '';
  const currentFilePath =
    (typeof data?.currentFilePath === 'string' && data.currentFilePath.trim()) ||
    (typeof data?.startDir === 'string' && data.startDir.trim()) ||
    '';

  let info;
  try {
    info = resolveActiveWorkspaceAndSession(requestedConvId, requestedDir);
  } catch (err) {
    return jsonError(`Failed to resolve workspace directory: ${err.message}`, 400);
  }

  let defaultDir = homedir();
  if (currentFilePath) {
    try {
      const normCurrent = normalizeTargetPath(currentFilePath, '', info.workspaceDir || '');
      const candidateDir =
        existsSync(normCurrent) && statSync(normCurrent).isDirectory() ? normCurrent : dirname(normCurrent);
      if (candidateDir && existsSync(candidateDir) && statSync(candidateDir).isDirectory()) {
        defaultDir = candidateDir;
      }
    } catch {}
  } else if (info.workspaceDir && existsSync(info.workspaceDir) && statSync(info.workspaceDir).isDirectory()) {
    defaultDir = info.workspaceDir;
  } else if (info.sessionDir && existsSync(info.sessionDir) && statSync(info.sessionDir).isDirectory()) {
    defaultDir = info.sessionDir;
  }

  let chosenPath = '';
  try {
    if (process.platform === 'darwin') {
      const script = [
        'on run argv',
        '  set defaultDir to item 1 of argv',
        '  activate',
        '  set chosenFile to choose file of type {"md", "markdown", "dyn.ah62d4rv4ge8043a", "net.daringfireball.markdown", "public.plain-text"} with prompt "Select a Markdown file (.md) to open in Speedgrapher:" default location (POSIX file defaultDir)',
        '  return POSIX path of chosenFile',
        'end run',
      ].join('\n');
      chosenPath = execFileSync('osascript', ['-e', script, defaultDir], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
      }).trim();
    } else if (process.platform === 'win32') {
      const psScript = [
        'Add-Type -AssemblyName System.Windows.Forms;',
        '$dlg = New-Object System.Windows.Forms.OpenFileDialog;',
        '$dlg.Title = "Select a Markdown file (.md) to open in Speedgrapher";',
        `$dlg.InitialDirectory = ${JSON.stringify(defaultDir)};`,
        '$dlg.Filter = "Markdown files (*.md;*.markdown)|*.md;*.markdown";',
        'if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dlg.FileName }',
      ].join(' ');
      chosenPath = execFileSync('powershell', ['-NoProfile', '-Sta', '-Command', psScript], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
      }).trim();
      if (!chosenPath) {
        return { canceled: true, path: '' };
      }
    } else {
      chosenPath = execFileSync(
        'zenity',
        [
          '--file-selection',
          '--title=Select a Markdown file (.md) to open in Speedgrapher',
          `--filename=${join(defaultDir, '/')}`,
          '--file-filter=Markdown files (*.md, *.markdown) | *.md *.markdown',
        ],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 60_000,
        }
      ).trim();
    }
  } catch (err) {
    const stderrText = String(err.stderr || err.message || '');
    if (
      err.status === 1 &&
      (process.platform === 'linux' || /User canceled|-128/i.test(stderrText))
    ) {
      return { canceled: true, path: '' };
    }
    return jsonError(`System file dialog failed: ${stderrText || err.message}`, 500);
  }

  if (!chosenPath) {
    return { canceled: true, path: '' };
  }

  if (!existsSync(chosenPath) || !statSync(chosenPath).isFile()) {
    return jsonError(`Selected file does not exist on disk: ${chosenPath}`, 404);
  }

  const ext = extname(chosenPath).toLowerCase();
  if (!ALLOWED_MD_EXTENSIONS.has(ext)) {
    return jsonError(
      `Unsupported file extension "${ext || '(none)'}" for "${chosenPath}". Only .md and .markdown files are allowed.`,
      400
    );
  }

  const canonicalPath = realpathSync(chosenPath);
  allowedSessionFiles.add(canonicalPath);

  return {
    canceled: false,
    path: canonicalPath,
  };
}
