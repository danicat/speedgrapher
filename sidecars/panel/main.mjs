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
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Response, SidecarApp } from 'sidecar_sdk';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(HERE, '..', '..');
const BIN_NAME = process.platform === 'win32' ? 'speedgrapher.exe' : 'speedgrapher';
const LOCAL_BIN_PATH = join(PLUGIN_ROOT, 'bin', BIN_NAME);
const GOBIN_PATH = join(homedir(), 'go', 'bin', BIN_NAME);

const SESSION_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const ALLOWED_MD_EXTENSIONS = new Set(['.md', '.markdown']);
const allowedSessionFiles = new Set();

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

function getBinaryPath() {
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

function buildSubprocessEnv() {
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

const app = new SidecarApp();

function jsonError(message, status = 500, details = undefined) {
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

function readLocal(name) {
  const target = join(HERE, name);
  return readFileSync(target, 'utf8');
}

function getSettingsDir() {
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

function normalizeTargetPath(rawPath, baseDocPath = '', workspaceDir = '') {
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
  // Strip any #anchor or ?query fragment from Markdown links
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
  // If path is relative (not starting with / or Windows drive), resolve against baseDocPath directory or workspaceDir
  const isAbsoluteUnixOrWin = trimmed.startsWith('/') || isAbsolute(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed);
  if (!isAbsoluteUnixOrWin) {
    if (baseDocPath && typeof baseDocPath === 'string' && baseDocPath.trim()) {
      const normalizedBase = normalizeTargetPath(baseDocPath);
      const baseDir =
        existsSync(normalizedBase) && statSync(normalizedBase).isDirectory()
          ? normalizedBase
          : dirname(normalizedBase);
      const candidateFromDoc = resolve(baseDir, trimmed);
      if (existsSync(candidateFromDoc) || !workspaceDir) {
        return candidateFromDoc;
      }
    }
    if (workspaceDir && typeof workspaceDir === 'string' && workspaceDir.trim()) {
      const normalizedWs = normalizeTargetPath(workspaceDir);
      return resolve(normalizedWs, trimmed);
    }
  }
  return resolve(trimmed);
}

// ---------------------------------------------------------------------------
// Strict Workspace & Active Conversation Discovery (Zero PLUGIN_ROOT Fallback)
// ---------------------------------------------------------------------------

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

function getSessionArtifactDir(requestedConversationId = '') {
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

function resolveActiveWorkspaceAndSession(requestedConversationId = '', requestedDirOrUri = '') {
  const cleanConvId =
    typeof requestedConversationId === 'string' && SESSION_ID_RE.test(requestedConversationId.trim())
      ? requestedConversationId.trim()
      : (process.env.ANTIGRAVITY_CONVERSATION_ID || '').trim();

  const sessionDir = getSessionArtifactDir(cleanConvId);
  let transcriptPath = null;
  if (sessionDir) {
    const tp = join(sessionDir, '.system_generated', 'logs', 'transcript.jsonl');
    if (existsSync(tp)) {
      transcriptPath = tp;
    }
  }

  // Strictly resolve workspace from:
  // 1. Explicit workspaceUri / directory passed by the host/client
  // 2. Active conversation transcript (when conversationId is explicitly known)
  // 3. process.env.WORKSPACE_ROOT (when set by host)
  // Never fall back to PLUGIN_ROOT or unrelated historical sessions.
  let workspaceDir = null;
  if (requestedDirOrUri && typeof requestedDirOrUri === 'string' && requestedDirOrUri.trim()) {
    const normalized = normalizeTargetPath(requestedDirOrUri);
    if (!existsSync(normalized)) {
      throw new Error(`Workspace directory does not exist on disk: ${normalized}`);
    }
    const st = statSync(normalized);
    workspaceDir = st.isDirectory() ? normalized : dirname(normalized);
  }

  if (!workspaceDir && transcriptPath) {
    workspaceDir = extractWorkspaceFromTranscript(transcriptPath);
  }

  if (!workspaceDir && process.env.WORKSPACE_ROOT && existsSync(process.env.WORKSPACE_ROOT)) {
    workspaceDir = resolve(process.env.WORKSPACE_ROOT);
  }

  return {
    conversationId: cleanConvId,
    workspaceDir,
    sessionDir,
  };
}

function isPathInsideDir(targetCanonicalPath, dirPath) {
  if (!dirPath || typeof dirPath !== 'string' || !existsSync(dirPath)) {
    return false;
  }
  const canonicalRoot = realpathSync(dirPath);
  const rel = relative(canonicalRoot, targetCanonicalPath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function validateAllowedMarkdownPath(targetPath, workspaceDir = '', conversationId = '') {
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

// ---------------------------------------------------------------------------
// Static Frontend Routes (re-read on each GET request for live reload)
// ---------------------------------------------------------------------------

const serveIndex = () =>
  new Response(readLocal('index.html'), {
    contentType: 'text/html; charset=utf-8',
    headers: { 'Cache-Control': 'no-store' },
  });

const serveAppJs = () =>
  new Response(readLocal('app.js'), {
    contentType: 'application/javascript; charset=utf-8',
    headers: { 'Cache-Control': 'no-store' },
  });

const serveStylesCss = () =>
  new Response(readLocal('styles.css'), {
    contentType: 'text/css; charset=utf-8',
    headers: { 'Cache-Control': 'no-store' },
  });

app.page('/', serveIndex);
app.page('/app.js', serveAppJs);
app.api('/styles.css', serveStylesCss, 'GET');
app.api('/assets/logo.svg', () => {
  const logoPath = join(PLUGIN_ROOT, 'assets', 'logo.svg');
  return new Response(readFileSync(logoPath, 'utf8'), {
    contentType: 'image/svg+xml',
    headers: { 'Cache-Control': 'no-cache' },
  });
}, 'GET');

// ---------------------------------------------------------------------------
// Local Workspace Image Streaming Endpoint (GET /api/image)
// ---------------------------------------------------------------------------

function findHugoRoot(startDir) {
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

function handleGetImage(reqOrData, maybeReq) {
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

app.api('/api/image', handleGetImage, 'GET');

// ---------------------------------------------------------------------------
// Markdown File Discovery (Active Workspace + Active Session Artifacts Only)
// ---------------------------------------------------------------------------

function scanMarkdownFiles(rootDir, currentDir, results, source = 'workspace', maxDepth = 6, depth = 0) {
  if (depth > maxDepth || !existsSync(currentDir)) return;
  const entries = readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.name.startsWith('.') ||
      entry.name === 'node_modules' ||
      entry.name === 'vendor' ||
      entry.name === 'dist' ||
      entry.name === 'tempmediaStorage'
    ) {
      continue;
    }
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      scanMarkdownFiles(rootDir, fullPath, results, source, maxDepth, depth + 1);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (ALLOWED_MD_EXTENSIONS.has(ext)) {
        const st = statSync(fullPath);
        const relPath = relative(rootDir, fullPath);
        results.push({
          path: fullPath,
          rel: source === 'artifact' ? `[Artifact] ${relPath}` : relPath,
          name: entry.name,
          source,
          mtimeMs: st.mtimeMs,
          size: st.size,
        });
      }
    }
  }
}

function handleGetFiles(data) {
  const requestedDir = typeof data?.workspaceUri === 'string' ? data.workspaceUri : '';
  const requestedConvId = typeof data?.conversationId === 'string' ? data.conversationId : '';

  let info;
  try {
    info = resolveActiveWorkspaceAndSession(requestedConvId, requestedDir);
  } catch (err) {
    return jsonError(`Failed to resolve workspace directory: ${err.message}`, 400);
  }

  try {
    const files = [];
    const seenPaths = new Set();

    if (info.workspaceDir && existsSync(info.workspaceDir)) {
      const wsFiles = [];
      scanMarkdownFiles(info.workspaceDir, info.workspaceDir, wsFiles, 'workspace', 6, 0);
      wsFiles.sort((a, b) => a.rel.localeCompare(b.rel));
      for (const f of wsFiles) {
        if (!seenPaths.has(f.path)) {
          seenPaths.add(f.path);
          files.push(f);
        }
      }
    }

    if (info.sessionDir && existsSync(info.sessionDir)) {
      const artFiles = [];
      scanMarkdownFiles(info.sessionDir, info.sessionDir, artFiles, 'artifact', 2, 0);
      artFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const f of artFiles) {
        if (!seenPaths.has(f.path)) {
          seenPaths.add(f.path);
          files.push(f);
        }
      }
    }

    return {
      workspacePath: info.workspaceDir || '',
      sessionDir: info.sessionDir || '',
      conversationId: info.conversationId || '',
      files,
    };
  } catch (err) {
    return jsonError(`Failed to scan Markdown files: ${err.message}`, 500);
  }
}

app.api('/api/files', handleGetFiles, 'POST');

// ---------------------------------------------------------------------------
// Deterministic Speedgrapher Audit Execution & Enriched Pill Metrics
// ---------------------------------------------------------------------------

function executeSpeedgrapherAudit({ filePath, text, keyword, docType, workspaceDir }) {
  const binPath = getBinaryPath();

  let workingDir = '';
  if (filePath) {
    const parentDir = dirname(filePath);
    if (!existsSync(parentDir)) {
      throw new Error(`Parent directory does not exist for audit target: ${parentDir}`);
    }
    workingDir = parentDir;
  } else if (workspaceDir && existsSync(workspaceDir)) {
    workingDir = workspaceDir;
  } else {
    const activeInfo = resolveActiveWorkspaceAndSession();
    workingDir = activeInfo.workspaceDir || process.cwd();
  }

  const payload = JSON.stringify({
    path: filePath || '',
    text: typeof text === 'string' ? text : '',
    keyword: typeof keyword === 'string' ? keyword.trim() : '',
    doc_type: typeof docType === 'string' && docType.trim() ? docType.trim() : 'auto',
  });

  let stdout;
  try {
    stdout = execFileSync(binPath, ['audit', payload], {
      cwd: workingDir,
      env: buildSubprocessEnv(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    const stderrText = err.stderr ? String(err.stderr).trim() : '';
    const stdoutText = err.stdout ? String(err.stdout).trim() : '';
    const diagnostic = [
      `Command "${binPath} audit" failed (exit code ${err.status ?? 'unknown'}): ${err.message}`,
      stderrText ? `stderr:\n${stderrText}` : '',
      stdoutText ? `stdout:\n${stdoutText}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    throw new Error(diagnostic);
  }

  try {
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to parse JSON output from "${binPath} audit": ${err.message}\nRaw output:\n${stdout}`);
  }
}

function extractPillMetrics(rawText, audit) {
  if (!audit || typeof audit !== 'object') {
    throw new Error('extractPillMetrics requires a valid audit result object.');
  }

  const normalizedText = typeof rawText === 'string' ? rawText.replace(/\r\n/g, '\n') : '';
  const words = normalizedText.trim() ? normalizedText.trim().split(/\s+/).length : 0;

  let valeAlerts = [];
  if (typeof audit.vale?.output === 'string' && audit.vale.output.trim()) {
    let parsed;
    try {
      parsed = JSON.parse(audit.vale.output);
    } catch (err) {
      throw new Error(`Failed to parse Vale JSON output: ${err.message}\nRaw Vale output:\n${audit.vale.output}`);
    }
    if (Array.isArray(parsed)) {
      valeAlerts = parsed;
    } else if (parsed && typeof parsed === 'object') {
      for (const list of Object.values(parsed)) {
        if (Array.isArray(list)) valeAlerts.push(...list);
      }
    }
  }

  const slopScore =
    typeof audit.slop?.overall_slop_score === 'number'
      ? Math.round(audit.slop.overall_slop_score)
      : null;

  const seoObj = audit.seo || null;
  const seoScore = typeof seoObj?.score === 'number' ? Math.round(seoObj.score) : null;
  const geoScore = typeof seoObj?.geo_score === 'number' ? Math.round(seoObj.geo_score) : null;

  const jargonCount =
    typeof audit.jargon_count === 'number'
      ? audit.jargon_count
      : Array.isArray(audit.slop?.findings)
      ? audit.slop.findings.filter((f) => f.category === 'lexical').length
      : 0;

  return {
    fog: typeof audit.fog?.fog_index === 'number' ? Number(audit.fog.fog_index.toFixed(1)) : null,
    slop: slopScore,
    vale: valeAlerts.length,
    seo: seoScore,
    geo: geoScore,
    words,
    jargonCount,
    unexpandedAcronyms: Array.isArray(audit.unexpanded_acronyms) ? audit.unexpanded_acronyms : [],
    blockHealth: Array.isArray(audit.blocks) ? audit.blocks : [],
    spans: Array.isArray(audit.spans) ? audit.spans : [],
  };
}

// ---------------------------------------------------------------------------
// Document Open, Sync, Poll & Ad-Hoc Audit Endpoints
// ---------------------------------------------------------------------------

function openAndAuditDocument(data) {
  const rawInputPath = typeof data?.path === 'string' ? data.path : '';
  if (!rawInputPath.trim()) {
    return jsonError('Missing required "path" parameter to open document.', 400);
  }

  const workspacePath = typeof data?.workspacePath === 'string' ? data.workspacePath : '';
  const conversationId = typeof data?.conversationId === 'string' ? data.conversationId : '';
  const baseDocPath = typeof data?.baseDocPath === 'string' ? data.baseDocPath : '';

  let targetPath = '';
  try {
    targetPath = normalizeTargetPath(rawInputPath, baseDocPath, workspacePath);
  } catch (err) {
    return jsonError(`Invalid file path "${rawInputPath}": ${err.message}`, 400);
  }

  if (!existsSync(targetPath)) {
    return jsonError(`File not found on disk: ${targetPath}`, 404);
  }

  try {
    let st = statSync(targetPath);
    if (st.isDirectory()) {
      const indexCandidates = ['SKILL.md', 'README.md', 'index.md', '_index.md'];
      let resolvedEntry = '';
      for (const name of indexCandidates) {
        const cand = join(targetPath, name);
        if (existsSync(cand) && statSync(cand).isFile()) {
          resolvedEntry = cand;
          break;
        }
      }
      if (!resolvedEntry) {
        return jsonError(
          `Directory "${targetPath}" does not contain a default Markdown entrypoint (SKILL.md, README.md, or index.md).`,
          400
        );
      }
      targetPath = resolvedEntry;
      st = statSync(targetPath);
    }
    if (!st.isFile()) {
      return jsonError(`Path is not a regular file: ${targetPath}`, 400);
    }

    const ext = extname(targetPath).toLowerCase();
    if (!ALLOWED_MD_EXTENSIONS.has(ext)) {
      return jsonError(
        `Unsupported file extension "${ext || '(none)'}" for "${targetPath}". Only .md and .markdown files are allowed.`,
        400
      );
    }

    // Deep-linked or explicitly opened existing .md/.markdown files are registered in the session allowlist
    const canonicalExisting = realpathSync(targetPath);
    allowedSessionFiles.add(canonicalExisting);

    let canonicalPath;
    try {
      canonicalPath = validateAllowedMarkdownPath(targetPath, workspacePath, conversationId);
    } catch (err) {
      return jsonError(err.message, err.statusCode || 400);
    }

    const content = readFileSync(canonicalPath, 'utf8');
    const requestedDocType = typeof data?.docType === 'string' && data.docType.trim() ? data.docType.trim() : 'auto';
    const requestedKeyword = typeof data?.keyword === 'string' ? data.keyword.trim() : '';

    const audit = executeSpeedgrapherAudit({
      filePath: canonicalPath,
      text: content,
      keyword: requestedKeyword,
      docType: requestedDocType,
      workspaceDir: workspacePath,
    });
    const metrics = extractPillMetrics(content, audit);

    return {
      path: canonicalPath,
      content,
      mtimeMs: st.mtimeMs,
      size: st.size,
      docType: requestedDocType,
      keyword: requestedKeyword,
      audit,
      metrics,
    };
  } catch (err) {
    return jsonError(err.message, err.statusCode || 500);
  }
}

app.api('/api/doc/open', openAndAuditDocument, 'POST');

function syncAndAuditDocument(data) {
  const rawInputPath = typeof data?.path === 'string' ? data.path : '';
  const workspacePath = typeof data?.workspacePath === 'string' ? data.workspacePath : '';
  const conversationId = typeof data?.conversationId === 'string' ? data.conversationId : '';

  let targetPath;
  try {
    targetPath = normalizeTargetPath(rawInputPath, '', workspacePath);
  } catch (err) {
    return jsonError(`Invalid file path "${rawInputPath}": ${err.message}`, 400);
  }
  if (!targetPath) {
    return jsonError('Missing or invalid "path" parameter.', 400);
  }

  let canonicalPath;
  try {
    canonicalPath = validateAllowedMarkdownPath(targetPath, workspacePath, conversationId);
  } catch (err) {
    return jsonError(err.message, err.statusCode || 400);
  }

  const content = data?.content;
  if (typeof content !== 'string') {
    return jsonError('Missing or invalid "content" parameter (expected string).', 400);
  }

  const docType = typeof data?.docType === 'string' && data.docType.trim() ? data.docType.trim() : 'auto';
  const keyword = typeof data?.keyword === 'string' ? data.keyword.trim() : '';

  try {
    if (data?.writeToDisk !== false) {
      mkdirSync(dirname(canonicalPath), { recursive: true });
      writeFileSync(canonicalPath, content, 'utf8');
      allowedSessionFiles.add(realpathSync(canonicalPath));
    }
    const st = existsSync(canonicalPath)
      ? statSync(canonicalPath)
      : { mtimeMs: Date.now(), size: Buffer.byteLength(content, 'utf8') };

    const audit = executeSpeedgrapherAudit({
      filePath: canonicalPath,
      text: content,
      keyword,
      docType,
      workspaceDir: workspacePath,
    });
    const metrics = extractPillMetrics(content, audit);

    return {
      path: canonicalPath,
      mtimeMs: st.mtimeMs,
      savedAt: new Date().toISOString(),
      audit,
      metrics,
    };
  } catch (err) {
    return jsonError(err.message, err.statusCode || 500);
  }
}

app.api('/api/doc/sync', syncAndAuditDocument, 'POST');

app.api('/api/doc/poll', (data) => {
  const rawInputPath = typeof data?.path === 'string' ? data.path : '';
  const workspacePath = typeof data?.workspacePath === 'string' ? data.workspacePath : '';
  const conversationId = typeof data?.conversationId === 'string' ? data.conversationId : '';

  let targetPath;
  try {
    targetPath = normalizeTargetPath(rawInputPath, '', workspacePath);
  } catch (err) {
    return jsonError(`Invalid file path "${rawInputPath}": ${err.message}`, 400);
  }
  if (!targetPath) {
    return jsonError('Missing or invalid "path" parameter.', 400);
  }

  let canonicalPath;
  try {
    canonicalPath = validateAllowedMarkdownPath(targetPath, workspacePath, conversationId);
  } catch (err) {
    return jsonError(err.message, err.statusCode || 400);
  }

  if (!existsSync(canonicalPath)) {
    return { changed: false };
  }

  try {
    const st = statSync(canonicalPath);
    const knownMtimeMs = typeof data?.knownMtimeMs === 'number' ? data.knownMtimeMs : 0;
    if (knownMtimeMs > 0 && Math.abs(st.mtimeMs - knownMtimeMs) < 1) {
      return { changed: false, mtimeMs: st.mtimeMs };
    }

    const proposedContent = readFileSync(canonicalPath, 'utf8');
    if (typeof data?.currentContent === 'string' && proposedContent === data.currentContent) {
      return { changed: false, mtimeMs: st.mtimeMs };
    }

    const docType = typeof data?.docType === 'string' && data.docType.trim() ? data.docType.trim() : 'auto';
    const keyword = typeof data?.keyword === 'string' ? data.keyword.trim() : '';

    const audit = executeSpeedgrapherAudit({
      filePath: canonicalPath,
      text: proposedContent,
      keyword,
      docType,
      workspaceDir: workspacePath,
    });
    const metrics = extractPillMetrics(proposedContent, audit);

    return {
      changed: true,
      path: canonicalPath,
      mtimeMs: st.mtimeMs,
      content: proposedContent,
      audit,
      metrics,
    };
  } catch (err) {
    return jsonError(`Failed to poll file "${canonicalPath}": ${err.message}`, 500);
  }
});

app.api('/api/audit', (data) => {
  const rawInputPath = typeof data?.path === 'string' ? data.path : '';
  const workspaceDir = typeof data?.workspacePath === 'string' ? data.workspacePath.trim() : '';

  let filePath = '';
  if (rawInputPath.trim()) {
    try {
      filePath = normalizeTargetPath(rawInputPath, '', workspaceDir);
    } catch (err) {
      return jsonError(`Invalid file path "${rawInputPath}": ${err.message}`, 400);
    }
  }
  const text = typeof data?.text === 'string' ? data.text : '';
  const keyword = typeof data?.keyword === 'string' ? data.keyword.trim() : '';
  const docType = typeof data?.docType === 'string' && data.docType.trim() ? data.docType.trim() : 'auto';

  if (!text && !filePath) {
    return jsonError('Audit requires either non-empty "text" or a valid file "path".', 400);
  }

  try {
    const audit = executeSpeedgrapherAudit({ filePath, text, keyword, docType, workspaceDir });
    const metrics = extractPillMetrics(text, audit);
    return { audit, metrics };
  } catch (err) {
    return jsonError(err.message, 500);
  }
});

// ---------------------------------------------------------------------------
// Vale Rule & Vocabulary Management Endpoint (POST /api/vale/rules)
// ---------------------------------------------------------------------------

const VALID_VALE_RULE_ACTIONS = new Set(['list', 'set_rule', 'add_vocab', 'remove_vocab']);

function handleValeRules(data) {
  const action = typeof data?.action === 'string' && data.action.trim() ? data.action.trim() : 'list';
  if (!VALID_VALE_RULE_ACTIONS.has(action)) {
    return jsonError(
      `Invalid Vale rules action "${action}". Expected one of: list, set_rule, add_vocab, remove_vocab.`,
      400
    );
  }

  let targetPath = '';
  if (data?.path && typeof data.path === 'string' && data.path.trim()) {
    try {
      targetPath = normalizeTargetPath(data.path);
    } catch (err) {
      return jsonError(`Invalid file path "${data.path}": ${err.message}`, 400);
    }
  }

  let workspaceDir = '';
  try {
    const info = resolveActiveWorkspaceAndSession(
      typeof data?.conversationId === 'string' ? data.conversationId : '',
      typeof data?.workspacePath === 'string' ? data.workspacePath : ''
    );
    workspaceDir = info.workspaceDir || '';
  } catch (err) {
    return jsonError(`Invalid workspace path: ${err.message}`, 400);
  }

  const ruleId = typeof data?.rule_id === 'string' ? data.rule_id.trim() : '';
  const level = typeof data?.level === 'string' && data.level.trim() ? data.level.trim() : '';
  const term = typeof data?.term === 'string' ? data.term.trim() : '';
  const enabled = typeof data?.enabled === 'boolean' ? data.enabled : undefined;
  const caseInsensitive = typeof data?.case_insensitive === 'boolean' ? data.case_insensitive : undefined;

  if (action === 'set_rule' && !ruleId) {
    return jsonError('Missing required "rule_id" parameter for "set_rule" action.', 400);
  }
  if ((action === 'add_vocab' || action === 'remove_vocab') && !term) {
    return jsonError(`Missing required "term" parameter for "${action}" action.`, 400);
  }

  let workingDir = '';
  if (targetPath) {
    if (existsSync(targetPath) && statSync(targetPath).isDirectory()) {
      workingDir = targetPath;
    } else if (existsSync(dirname(targetPath))) {
      workingDir = dirname(targetPath);
    } else {
      return jsonError(`Parent directory does not exist for Vale rules path: ${dirname(targetPath)}`, 400);
    }
  } else if (workspaceDir && existsSync(workspaceDir)) {
    workingDir = workspaceDir;
  }

  if (!workingDir) {
    return jsonError(
      `Vale rules action "${action}" requires a valid document "path" or active "workspacePath"; refusing to fall back to plugin directory.`,
      400
    );
  }

  try {
    const binPath = getBinaryPath();
    const payload = {
      action,
      path: targetPath || workingDir,
      rule_id: ruleId || undefined,
      enabled,
      level: level || undefined,
      term: term || undefined,
      case_insensitive: caseInsensitive,
    };

    let stdout;
    try {
      stdout = execFileSync(binPath, ['call', 'vale_rules', JSON.stringify(payload)], {
        cwd: workingDir,
        env: buildSubprocessEnv(),
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      });
    } catch (err) {
      const stderrText = err.stderr ? String(err.stderr).trim() : '';
      const stdoutText = err.stdout ? String(err.stdout).trim() : '';
      const diagnostic = [
        `Command "${binPath} call vale_rules" failed (exit code ${err.status ?? 'unknown'}): ${err.message}`,
        stderrText ? `stderr:\n${stderrText}` : '',
        stdoutText ? `stdout:\n${stdoutText}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      return jsonError(diagnostic, 500);
    }

    try {
      return JSON.parse(stdout);
    } catch (err) {
      return jsonError(
        `Failed to parse JSON output from "${binPath} call vale_rules": ${err.message}\nRaw output:\n${stdout}`,
        500
      );
    }
  } catch (err) {
    return jsonError(err.message, 500);
  }
}

app.api('/api/vale/rules', handleValeRules, 'POST');

// ---------------------------------------------------------------------------
// AI Settings Configuration (Gemini API Key or Vertex AI Project + Region)
// & Client-Driven Gemini Rewrite / 3-Angle Variant Tournament
// ---------------------------------------------------------------------------

const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const DEFAULT_THINKING_LEVEL = 'LOW';
const DEFAULT_VERTEX_LOCATION = 'global';
const DEFAULT_VERTEX_PROJECT = '';

const VALID_THINKING_LEVELS = new Set(['LOW', 'MEDIUM', 'HIGH']);
const ALLOWED_REWRITE_SKILLS = new Set(['readability', 'draft', 'publish']);
const VERTEX_LOCATION_RE = /^(global|[a-z]+-[a-z]+[0-9]+)$/;
const GCP_PROJECT_ID_RE = /^[a-z][a-z0-9.:-]{4,61}[a-z0-9]$/;
const GEMINI_MODEL_ID_RE = /^[a-zA-Z0-9._-]+$/;

let cachedAdcToken = null;

function getAiSettingsPath() {
  return join(getSettingsDir(), 'ai-settings.json');
}

function resolveAdcFilePath() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.GOOGLE_APPLICATION_CREDENTIALS.trim()) {
    return resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS.trim());
  }
  if (process.platform === 'win32' && process.env.APPDATA) {
    return join(process.env.APPDATA, 'gcloud', 'application_default_credentials.json');
  }
  return join(homedir(), '.config', 'gcloud', 'application_default_credentials.json');
}

function normalizeThinkingLevel(raw) {
  const val = String(raw || '').trim().toUpperCase();
  if (VALID_THINKING_LEVELS.has(val)) {
    return val;
  }
  return DEFAULT_THINKING_LEVEL;
}

function loadAiSettings() {
  const settingsPath = getAiSettingsPath();
  let stored = {};
  if (existsSync(settingsPath)) {
    try {
      stored = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch (err) {
      throw new Error(`Failed to parse AI settings file (${settingsPath}): ${err.message}`);
    }
  }

  const envApiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  const envProject = (process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || '').trim();
  const envLocation = (process.env.GOOGLE_CLOUD_LOCATION || '').trim();
  const envModel = (process.env.SPEEDGRAPHER_GEMINI_MODEL || '').trim();
  const envThinking = (process.env.SPEEDGRAPHER_THINKING_LEVEL || '').trim();

  const apiKey = typeof stored.apiKey === 'string' ? stored.apiKey.trim() : envApiKey;
  const project =
    typeof stored.project === 'string' && stored.project.trim()
      ? stored.project.trim()
      : envProject || DEFAULT_VERTEX_PROJECT;
  const location =
    typeof stored.location === 'string' && stored.location.trim()
      ? stored.location.trim()
      : envLocation || DEFAULT_VERTEX_LOCATION;
  const model =
    typeof stored.model === 'string' && stored.model.trim()
      ? stored.model.trim()
      : envModel || DEFAULT_GEMINI_MODEL;
  const thinkingLevel = normalizeThinkingLevel(stored.thinkingLevel || envThinking || DEFAULT_THINKING_LEVEL);

  let authMode = stored.authMode;
  if (authMode !== 'apikey' && authMode !== 'vertex') {
    authMode = apiKey && !project ? 'apikey' : 'vertex';
  }

  return {
    authMode,
    apiKey,
    project,
    location,
    model,
    thinkingLevel,
  };
}

function saveAiSettings(nextSettings) {
  const settingsPath = getAiSettingsPath();
  writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2), { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(settingsPath, 0o600);
  } catch (err) {
    if (process.platform !== 'win32') {
      throw err;
    }
  }
}

function formatAiSettingsSummary(settings) {
  const adcPath = resolveAdcFilePath();
  const adcAvailable = existsSync(adcPath);
  const hasApiKey = Boolean(settings.apiKey);
  const apiKeyMask = hasApiKey
    ? `••••${settings.apiKey.slice(-Math.min(4, settings.apiKey.length))}`
    : '';
  const configured = settings.authMode === 'apikey'
    ? hasApiKey
    : Boolean(settings.project) && adcAvailable;

  return {
    configured,
    authMode: settings.authMode,
    project: settings.project || '',
    location: settings.location || DEFAULT_VERTEX_LOCATION,
    model: settings.model || DEFAULT_GEMINI_MODEL,
    thinkingLevel: normalizeThinkingLevel(settings.thinkingLevel),
    hasApiKey,
    apiKeyMask,
    adcAvailable,
    adcPath,
  };
}

app.api('/api/settings/get', () => {
  const settings = loadAiSettings();
  return formatAiSettingsSummary(settings);
}, 'POST');

app.api('/api/settings', (data) => {
  const current = loadAiSettings();
  const authMode = data?.authMode === 'apikey' ? 'apikey' : 'vertex';
  const project = typeof data?.project === 'string' ? data.project.trim() : current.project;
  const location = (typeof data?.location === 'string' && data.location.trim())
    ? data.location.trim()
    : (current.location || DEFAULT_VERTEX_LOCATION);
  const model = (typeof data?.model === 'string' && data.model.trim())
    ? data.model.trim()
    : (current.model || DEFAULT_GEMINI_MODEL);
  const thinkingLevel = normalizeThinkingLevel(data?.thinkingLevel || current.thinkingLevel || DEFAULT_THINKING_LEVEL);

  let apiKey = current.apiKey;
  if (data?.clearApiKey === true) {
    apiKey = '';
  } else if (typeof data?.apiKey === 'string' && data.apiKey.trim()) {
    apiKey = data.apiKey.trim();
  }

  if (authMode === 'apikey' && !apiKey) {
    return jsonError('Please enter a valid Gemini API Key to enable API Key mode.', 400);
  }
  if (authMode === 'vertex' && !project) {
    return jsonError('Please enter a GCP Project ID (and Region, e.g. "global") to enable Vertex AI mode.', 400);
  }
  if (!VERTEX_LOCATION_RE.test(location)) {
    return jsonError(
      `Invalid Vertex AI location "${location}". Expected "global" or a valid GCP region such as "us-central1".`,
      400
    );
  }
  if ((authMode === 'vertex' || project) && !GCP_PROJECT_ID_RE.test(project)) {
    return jsonError(`Invalid GCP Project ID "${project}".`, 400);
  }
  if (!GEMINI_MODEL_ID_RE.test(model)) {
    return jsonError(`Invalid Gemini model identifier "${model}".`, 400);
  }

  const updated = {
    authMode,
    apiKey,
    project,
    location,
    model,
    thinkingLevel,
  };
  saveAiSettings(updated);
  return formatAiSettingsSummary(updated);
}, 'POST');

async function getVertexAccessToken() {
  if (cachedAdcToken && Date.now() < cachedAdcToken.expiresAtMs - 60_000) {
    return cachedAdcToken.accessToken;
  }

  const adcPath = resolveAdcFilePath();
  if (!existsSync(adcPath)) {
    throw new Error(
      `Google Cloud Application Default Credentials (ADC) not found at "${adcPath}". Run "gcloud auth application-default login" or switch to Gemini API Key in Settings.`
    );
  }

  let adc;
  try {
    adc = JSON.parse(readFileSync(adcPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse ADC credentials file at "${adcPath}": ${err.message}`);
  }

  if (!adc.client_id || !adc.client_secret || !adc.refresh_token) {
    throw new Error(
      `ADC file at "${adcPath}" is missing required OAuth2 authorized_user fields (client_id, client_secret, refresh_token).`
    );
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: adc.client_id,
      client_secret: adc.client_secret,
      refresh_token: adc.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  const rawTokenBody = await tokenRes.text();
  let tokenData;
  try {
    tokenData = JSON.parse(rawTokenBody);
  } catch (err) {
    throw new Error(`Failed to parse OAuth2 token response (HTTP ${tokenRes.status}): ${err.message}`);
  }

  if (!tokenRes.ok || !tokenData.access_token) {
    const errDesc = tokenData.error_description || tokenData.error || `HTTP ${tokenRes.status}`;
    throw new Error(`Failed to exchange ADC refresh token for Vertex AI access token: ${errDesc}`);
  }

  const expiresInSec = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 3600;
  cachedAdcToken = {
    accessToken: tokenData.access_token,
    expiresAtMs: Date.now() + expiresInSec * 1000,
  };
  return cachedAdcToken.accessToken;
}

function validateConfiguredAiEndpointSettings(settings) {
  const summary = formatAiSettingsSummary(settings);
  if (!summary.configured) {
    const err = new Error(
      'AI features are not configured yet. Click the Settings (⚙️) icon in the top toolbar to configure either your Gemini API Key or your Vertex AI Project ID + Region.'
    );
    err.statusCode = 400;
    err.details = { code: 'AI_NOT_CONFIGURED' };
    throw err;
  }

  const modelId = settings.model || DEFAULT_GEMINI_MODEL;
  if (!GEMINI_MODEL_ID_RE.test(modelId)) {
    const err = new Error(`Invalid Gemini model identifier "${modelId}".`);
    err.statusCode = 400;
    throw err;
  }

  const loc = settings.location || DEFAULT_VERTEX_LOCATION;
  if (settings.authMode === 'vertex') {
    if (!VERTEX_LOCATION_RE.test(loc)) {
      const err = new Error(
        `Invalid Vertex AI location "${loc}". Expected "global" or a valid GCP region such as "us-central1".`
      );
      err.statusCode = 400;
      throw err;
    }
    if (!settings.project || !GCP_PROJECT_ID_RE.test(settings.project)) {
      const err = new Error(`Invalid GCP Project ID "${settings.project || ''}".`);
      err.statusCode = 400;
      throw err;
    }
  }

  return {
    modelId,
    thinkingLevel: normalizeThinkingLevel(settings.thinkingLevel),
    location: loc,
  };
}

async function callConfiguredGeminiJson({
  settings,
  modelId,
  thinkingLevel,
  location,
  systemInstruction,
  userPrompt,
  responseSchema,
  temperature = 0.4,
}) {
  const requestBody = {
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature,
      thinkingConfig: {
        thinkingLevel,
      },
      responseMimeType: 'application/json',
      responseSchema,
    },
  };

  let endpoint;
  let headers;

  if (settings.authMode === 'apikey') {
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
    headers = {
      'x-goog-api-key': settings.apiKey,
      'Content-Type': 'application/json',
    };
  } else {
    const accessToken = await getVertexAccessToken();
    const apiHost =
      location === 'global'
        ? 'https://aiplatform.googleapis.com'
        : `https://${location}-aiplatform.googleapis.com`;
    endpoint = `${apiHost}/v1beta1/projects/${encodeURIComponent(settings.project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(modelId)}:generateContent`;
    headers = {
      Authorization: `Bearer ${accessToken}`,
      'x-goog-user-project': settings.project,
      'Content-Type': 'application/json',
    };
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });

  const rawBody = await res.text();
  if (!res.ok) {
    const providerLabel =
      settings.authMode === 'apikey'
        ? `Gemini API (${modelId})`
        : `Vertex AI (${modelId} @ ${settings.project}/${location})`;
    throw new Error(`${providerLabel} returned HTTP ${res.status}: ${rawBody.slice(0, 600)}`);
  }

  let apiResp;
  try {
    apiResp = JSON.parse(rawBody);
  } catch (err) {
    throw new Error(`Failed to parse Gemini response JSON: ${err.message}`);
  }

  const parts = apiResp?.candidates?.[0]?.content?.parts || [];
  const textPart = [...parts].reverse().find((p) => !p.thought && typeof p.text === 'string' && p.text.trim());
  if (!textPart) {
    throw new Error(
      `Gemini (${modelId}) returned no text output part. Finish reason: ${apiResp?.candidates?.[0]?.finishReason || 'unknown'}`
    );
  }

  try {
    return JSON.parse(textPart.text);
  } catch (err) {
    throw new Error(`Failed to parse structured JSON from ${modelId}: ${err.message}\nRaw output:\n${textPart.text}`);
  }
}

function loadSkillGuideMarkdown(rawSkill) {
  const normalized = typeof rawSkill === 'string' ? rawSkill.trim().toLowerCase() : '';
  const skillName = ALLOWED_REWRITE_SKILLS.has(normalized) ? normalized : 'readability';
  const skillPath = join(PLUGIN_ROOT, 'skills', skillName, 'SKILL.md');
  if (!existsSync(skillPath)) {
    throw new Error(`Speedgrapher skill file not found on disk: ${skillPath}`);
  }
  return {
    skillName,
    skillMarkdown: readFileSync(skillPath, 'utf8'),
  };
}

async function handleAiRewrite(data) {
  const settings = loadAiSettings();
  let validated;
  try {
    validated = validateConfiguredAiEndpointSettings(settings);
  } catch (err) {
    return jsonError(err.message, err.statusCode || 400, err.details);
  }

  const { modelId, thinkingLevel, location } = validated;
  const fullDocument = typeof data?.fullDocument === 'string' ? data.fullDocument : '';
  const instruction = typeof data?.instruction === 'string' ? data.instruction.trim() : '';
  const telemetryContext = typeof data?.telemetryContext === 'string' ? data.telemetryContext.trim() : '';
  const targetBlocks = Array.isArray(data?.targetBlocks) ? data.targetBlocks : [];

  if (!instruction && targetBlocks.length === 0 && !fullDocument.trim()) {
    return jsonError('Missing rewrite instruction or document content for /api/ai/rewrite.', 400);
  }

  try {
    const { skillName, skillMarkdown } = loadSkillGuideMarkdown(data?.skill);

    if (targetBlocks.length > 0) {
      const systemInstruction = [
        'You are a principal technical editor in Speedgrapher.',
        `Apply the "${skillName}" Speedgrapher editorial skill guidelines below to rewrite the requested target Markdown blocks.`,
        'Rules:',
        '- Return a proposal entry for each requested target block ID.',
        '- Preserve the Markdown structure of each block (headings keep their # prefix, lists keep bullet/numbered items, inline `code` and [links](url) remain intact).',
        '- Resolve all inline review notes and diagnostic findings attached to the block.',
        '- Never include `<!-- review: ... -->` HTML comments in `newRaw`.',
        '- Do not invent unverified facts or metrics that are not present in the source document or review instructions.',
        '',
        `### Speedgrapher "${skillName}" Skill Reference:`,
        skillMarkdown,
      ].join('\n');

      const promptSections = [
        `### Editorial Instruction:\n${instruction || 'Rewrite the target blocks to resolve all attached review comments and diagnostic findings.'}`,
      ];
      if (telemetryContext) {
        promptSections.push(`### Diagnostic Telemetry & Findings Context:\n${telemetryContext}`);
      }
      promptSections.push(
        `### Target Blocks to Rewrite:\n\`\`\`json\n${JSON.stringify(targetBlocks, null, 2)}\n\`\`\``
      );
      if (fullDocument.trim()) {
        promptSections.push(
          `### Full Document Context (for continuity and voice consistency only — only return proposals for the targetBlocks above):\n\`\`\`markdown\n${fullDocument}\n\`\`\``
        );
      }

      const responseSchema = {
        type: 'OBJECT',
        required: ['proposals'],
        properties: {
          proposals: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              required: ['id', 'newRaw', 'summary'],
              properties: {
                id: { type: 'STRING' },
                newRaw: {
                  type: 'STRING',
                  description: 'Rewritten Markdown for this exact block (without HTML review comments).',
                },
                summary: {
                  type: 'STRING',
                  description: 'Concise 6-12 word explanation of what improved.',
                },
              },
            },
          },
        },
      };

      const parsed = await callConfiguredGeminiJson({
        settings,
        modelId,
        thinkingLevel,
        location,
        systemInstruction,
        userPrompt: promptSections.join('\n\n'),
        responseSchema,
        temperature: 0.4,
      });

      if (!Array.isArray(parsed?.proposals) || parsed.proposals.length === 0) {
        throw new Error('Gemini response did not contain a valid "proposals" array.');
      }

      return {
        model: modelId,
        authMode: settings.authMode,
        proposals: parsed.proposals.map((p) => ({
          id: String(p.id || '').trim(),
          newRaw: String(p.newRaw || '')
            .replace(/<!--\s*review:[\s\S]*?-->/gi, '')
            .trim(),
          summary: String(p.summary || '').trim(),
        })),
      };
    }

    const systemInstruction = [
      'You are a principal technical editor in Speedgrapher.',
      `Apply the "${skillName}" Speedgrapher editorial skill guidelines below to update the full Markdown document.`,
      'Rules:',
      '- Preserve valid YAML frontmatter (when present or requested), code blocks, inline `code`, and `[links](url)`.',
      '- Remove any resolved `<!-- review: ... -->` HTML comment tags from the returned Markdown.',
      '- Do not invent unverified facts or metrics that are not present in the source document or instruction.',
      '',
      `### Speedgrapher "${skillName}" Skill Reference:`,
      skillMarkdown,
    ].join('\n');

    const promptSections = [
      `### Editorial Instruction:\n${instruction || 'Improve the document according to the skill guidelines and diagnostic findings.'}`,
    ];
    if (telemetryContext) {
      promptSections.push(`### Diagnostic Telemetry & Findings Context:\n${telemetryContext}`);
    }
    promptSections.push(`### Full Markdown Document:\n\`\`\`markdown\n${fullDocument}\n\`\`\``);

    const responseSchema = {
      type: 'OBJECT',
      required: ['fullMarkdown', 'summary'],
      properties: {
        fullMarkdown: {
          type: 'STRING',
          description: 'Complete updated Markdown document.',
        },
        summary: {
          type: 'STRING',
          description: 'Concise 6-12 word summary of changes.',
        },
      },
    };

    const parsed = await callConfiguredGeminiJson({
      settings,
      modelId,
      thinkingLevel,
      location,
      systemInstruction,
      userPrompt: promptSections.join('\n\n'),
      responseSchema,
      temperature: 0.4,
    });

    if (typeof parsed?.fullMarkdown !== 'string' || !parsed.fullMarkdown.trim()) {
      throw new Error('Gemini response did not contain a non-empty "fullMarkdown" string.');
    }

    return {
      model: modelId,
      authMode: settings.authMode,
      fullMarkdown: parsed.fullMarkdown,
      summary: String(parsed.summary || '').trim(),
    };
  } catch (err) {
    return jsonError(err.message, 500);
  }
}

app.api('/api/ai/rewrite', handleAiRewrite, 'POST');

function splitPassageIntoUnits(rawText) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return [];
  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && lines.every((l) => /^([-*+]|\d+\.|>)\s+/.test(l))) {
    return lines;
  }
  const matches = trimmed.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  return matches ? matches.map((s) => s.trim()).filter(Boolean) : [trimmed];
}

app.api('/api/tournament', async (data) => {
  const passage = typeof data?.passage === 'string' ? data.passage.trim() : '';
  if (!passage) {
    return jsonError('Missing or empty "passage" parameter for Variant Tournament.', 400);
  }

  const settings = loadAiSettings();
  let validated;
  try {
    validated = validateConfiguredAiEndpointSettings(settings);
  } catch (err) {
    return jsonError(err.message, err.statusCode || 400, err.details);
  }

  const { modelId, thinkingLevel, location } = validated;
  const blockType = typeof data?.blockType === 'string' && data.blockType.trim() ? data.blockType.trim() : 'paragraph';
  const keyword = typeof data?.keyword === 'string' ? data.keyword.trim() : '';
  const surroundingContext = typeof data?.surroundingContext === 'string' ? data.surroundingContext.trim() : '';

  try {
    const systemInstruction = [
      'You are a principal technical editor in Speedgrapher.',
      'Your task is to generate a 3-Angle Variant Tournament for a target Markdown block.',
      'Rewrite the target passage into 3 genuinely distinct, high-craft editorial proposals so the author can compare them side-by-side or cherry-pick individual sentences:',
      '1. Angle A ("Angle A: Direct & Deslopified"): Strip all AI writing tropes, inflated vocabulary (utilize, leverage, paradigm, delve, seamless, robust, landscape), filler throat-clearing, and passive voice. Use concrete active verbs and crisp engineering prose.',
      '2. Angle B ("Angle B: Conclusion-First (Pyramid)"): Apply the Inverted Pyramid. Front-load the most important conclusion, takeaway, or concrete metric in the opening sentence, followed by supporting mechanics.',
      '3. Angle C ("Angle C: High-Contrast Cadence"): Vary sentence lengths deliberately—pair short, punchy declarative statements with detailed technical explanations for natural human rhythm.',
      'Rules:',
      '- Preserve the Markdown structure of the block (e.g., if it is a heading, keep the # prefix; if a list, keep bullet items; keep inline `code` and [links](url) intact).',
      '- Never shuffle words mechanically or repeat the original text verbatim; write genuine, thoughtful editorial alternatives.',
      '- Do not invent unverified facts or metrics that are not present in the passage.',
    ].join('\n');

    const promptSections = [
      `Block Type: ${blockType}${keyword ? ` | Target Keyword: ${keyword}` : ''}`,
      `### Target Passage to Rewrite:\n\`\`\`markdown\n${passage}\n\`\`\``,
    ];
    if (surroundingContext) {
      promptSections.push(`### Surrounding Document Context (for continuity only—do not rewrite this):\n\`\`\`markdown\n${surroundingContext}\n\`\`\``);
    }

    const responseSchema = {
      type: 'OBJECT',
      properties: {
        angles: {
          type: 'ARRAY',
          description: 'Exactly 3 distinct editorial rewrite angles (Angle A, Angle B, Angle C).',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING', description: 'angle-a, angle-b, or angle-c' },
              label: { type: 'STRING', description: 'Angle title (e.g. Angle A: Direct & Deslopified)' },
              rationale: { type: 'STRING', description: 'Short 1-sentence editorial note explaining what this angle optimizes' },
              raw: { type: 'STRING', description: 'The complete rewritten Markdown block for this angle' },
              sentences: {
                type: 'ARRAY',
                description: 'The rewritten passage split into individual sentences (or list items) so the user can cherry-pick sentences across angles.',
                items: { type: 'STRING' },
              },
            },
            required: ['id', 'label', 'rationale', 'raw', 'sentences'],
          },
        },
      },
      required: ['angles'],
    };

    const parsedOutput = await callConfiguredGeminiJson({
      settings,
      modelId,
      thinkingLevel,
      location,
      systemInstruction,
      userPrompt: promptSections.join('\n\n'),
      responseSchema,
      temperature: 0.65,
    });

    if (!Array.isArray(parsedOutput?.angles) || parsedOutput.angles.length === 0) {
      throw new Error('Gemini response did not contain a valid "angles" array.');
    }

    const normalizedAngles = parsedOutput.angles.slice(0, 3).map((angle, idx) => {
      const raw = String(angle.raw || '').trim();
      const sentences = Array.isArray(angle.sentences) && angle.sentences.length > 0
        ? angle.sentences.map((s) => String(s || '').trim()).filter(Boolean)
        : splitPassageIntoUnits(raw);
      return {
        id: angle.id || `angle-${idx}`,
        label: angle.label || `Angle ${String.fromCharCode(65 + idx)}`,
        rationale: String(angle.rationale || '').trim(),
        raw,
        sentences: sentences.length > 0 ? sentences : [raw],
      };
    });

    return {
      model: modelId,
      thinkingLevel,
      authMode: settings.authMode,
      project: settings.authMode === 'vertex' ? settings.project : undefined,
      location: settings.authMode === 'vertex' ? location : undefined,
      angles: normalizedAngles,
    };
  } catch (err) {
    return jsonError(err.message, 500);
  }
});

await app.run();
