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
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import {
  ALLOWED_MD_EXTENSIONS,
  allowedSessionDirs,
  allowedSessionFiles,
  buildSubprocessEnv,
  getBaselinesDir,
  getBinaryPath,
  getSessionArtifactDir,
  isPathInsideDir,
  jsonError,
  normalizeTargetPath,
  resolveActiveWorkspaceAndSession,
  validateAllowedMarkdownPath,
} from './paths.mjs';

const AUDIT_SUBPROCESS_TIMEOUT_MS = 15_000;
const VALID_VALE_RULE_ACTIONS = new Set(['list', 'set_rule', 'reset_rule', 'add_vocab', 'remove_vocab']);

function getBaselineFilePath(canonicalPath) {
  const hash = createHash('sha256').update(canonicalPath).digest('hex').slice(0, 32);
  return join(getBaselinesDir(), `${hash}.json`);
}

export function readBaselineForPath(canonicalPath) {
  try {
    const file = getBaselineFilePath(canonicalPath);
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && typeof parsed.baselineContent === 'string') {
      return parsed.baselineContent;
    }
  } catch (err) {
    console.warn(`[speedgrapher] Failed to read baseline for "${canonicalPath}": ${err.message}`);
  }
  return null;
}

export function writeBaselineForPath(canonicalPath, baselineContent) {
  if (typeof baselineContent !== 'string') return;
  try {
    const file = getBaselineFilePath(canonicalPath);
    writeFileSync(
      file,
      JSON.stringify(
        {
          path: canonicalPath,
          baselineContent,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      { encoding: 'utf8', mode: 0o600 }
    );
  } catch (err) {
    console.warn(`[speedgrapher] Failed to write baseline for "${canonicalPath}": ${err.message}`);
  }
}

export function executeSpeedgrapherAudit({ filePath, text, keyword, docType, workspaceDir }) {
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
      timeout: AUDIT_SUBPROCESS_TIMEOUT_MS,
    });
  } catch (err) {
    if (err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM') {
      throw new Error(`Speedgrapher audit timed out after ${AUDIT_SUBPROCESS_TIMEOUT_MS / 1000}s on "${filePath || 'draft'}".`);
    }
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

export function extractPillMetrics(rawText, audit) {
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

export function openAndAuditDocument(data) {
  const rawInputPath = typeof data?.path === 'string' ? data.path : '';
  if (!rawInputPath.trim()) {
    return jsonError('Missing required "path" parameter to open document.', 400);
  }

  const workspacePath = typeof data?.workspacePath === 'string' ? data.workspacePath : '';
  const conversationId = typeof data?.conversationId === 'string' ? data.conversationId : '';
  const baseDocPath = typeof data?.baseDocPath === 'string' ? data.baseDocPath : '';

  let info;
  try {
    info = resolveActiveWorkspaceAndSession(conversationId, workspacePath);
  } catch (err) {
    return jsonError(`Failed to resolve active workspace: ${err.message}`, 400);
  }
  const resolvedWorkspace = info.workspaceDir || workspacePath || '';

  let targetPath = '';
  try {
    targetPath = normalizeTargetPath(rawInputPath, baseDocPath, resolvedWorkspace);
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

    const canonicalExisting = realpathSync(targetPath);
    allowedSessionFiles.add(canonicalExisting);

    let canonicalPath;
    try {
      canonicalPath = validateAllowedMarkdownPath(targetPath, resolvedWorkspace, info.conversationId);
    } catch (err) {
      return jsonError(err.message, err.statusCode || 400);
    }

    const content = readFileSync(canonicalPath, 'utf8');
    let baselineContent = readBaselineForPath(canonicalPath);
    if (typeof baselineContent !== 'string') {
      baselineContent = content;
      writeBaselineForPath(canonicalPath, content);
    }
    const requestedDocType = typeof data?.docType === 'string' && data.docType.trim() ? data.docType.trim() : 'auto';
    const requestedKeyword = typeof data?.keyword === 'string' ? data.keyword.trim() : '';

    const audit = executeSpeedgrapherAudit({
      filePath: canonicalPath,
      text: content,
      keyword: requestedKeyword,
      docType: requestedDocType,
      workspaceDir: resolvedWorkspace,
    });
    const metrics = extractPillMetrics(content, audit);

    return {
      path: canonicalPath,
      content,
      baselineContent,
      mtimeMs: st.mtimeMs,
      size: st.size,
      docType: requestedDocType,
      keyword: requestedKeyword,
      workspacePath: resolvedWorkspace,
      conversationId: info.conversationId,
      audit,
      metrics,
    };
  } catch (err) {
    return jsonError(err.message, err.statusCode || 500);
  }
}

export function createAndOpenDocument(data) {
  const rawFilename = typeof data?.filename === 'string' ? data.filename.trim() : '';
  const rawInputPath = typeof data?.path === 'string' ? data.path.trim() : '';
  const rawDir = typeof data?.dir === 'string' ? data.dir.trim() : '';
  const workspacePath = typeof data?.workspacePath === 'string' ? data.workspacePath : '';
  const conversationId = typeof data?.conversationId === 'string' ? data.conversationId : '';
  const baseDocPath = typeof data?.baseDocPath === 'string' ? data.baseDocPath : '';

  if (!rawFilename && !rawInputPath) {
    return jsonError('Missing required "filename" or "path" parameter to create document.', 400);
  }

  let info;
  try {
    info = resolveActiveWorkspaceAndSession(conversationId, workspacePath);
  } catch (err) {
    return jsonError(`Failed to resolve active workspace: ${err.message}`, 400);
  }
  const resolvedWorkspace = info.workspaceDir || workspacePath || '';

  let baseDir = '';
  if (rawDir) {
    try {
      baseDir = normalizeTargetPath(rawDir, baseDocPath, resolvedWorkspace);
    } catch (err) {
      return jsonError(`Invalid directory path "${rawDir}": ${err.message}`, 400);
    }
  } else if (baseDocPath) {
    try {
      const normBase = normalizeTargetPath(baseDocPath, '', resolvedWorkspace);
      baseDir = existsSync(normBase) && statSync(normBase).isDirectory() ? normBase : dirname(normBase);
    } catch {}
  }
  if (!baseDir) {
    if (resolvedWorkspace && existsSync(resolvedWorkspace)) {
      baseDir = resolvedWorkspace;
    } else if (info.sessionDir && existsSync(info.sessionDir)) {
      baseDir = info.sessionDir;
    } else {
      return jsonError('Cannot determine target directory for new file; specify a valid directory.', 400);
    }
  }

  let targetPath = '';
  const inputRelOrAbs = rawFilename || rawInputPath;
  if (inputRelOrAbs.includes('\0')) {
    return jsonError('Invalid filename: null byte detected.', 400);
  }
  const segments = inputRelOrAbs.split(/[/\\]+/).filter(Boolean);
  if (segments.length === 0 || segments.some((seg) => seg === '..' || seg === '.')) {
    return jsonError(`Invalid filename "${inputRelOrAbs}": relative traversal segments ("." or "..") are not allowed.`, 400);
  }

  try {
    if (isAbsolute(inputRelOrAbs) || inputRelOrAbs.startsWith('~/') || inputRelOrAbs.startsWith('file://')) {
      targetPath = normalizeTargetPath(inputRelOrAbs, baseDir, resolvedWorkspace);
    } else {
      targetPath = resolve(baseDir, inputRelOrAbs);
    }
  } catch (err) {
    return jsonError(`Invalid file path "${inputRelOrAbs}": ${err.message}`, 400);
  }

  const currentExt = extname(targetPath).toLowerCase();
  if (!currentExt) {
    targetPath = `${targetPath}.md`;
  } else if (!ALLOWED_MD_EXTENSIONS.has(currentExt)) {
    return jsonError(
      `Unsupported file extension "${currentExt}" for "${targetPath}". Only .md and .markdown files are allowed.`,
      400
    );
  }

  if (existsSync(targetPath)) {
    return jsonError(`File already exists on disk: ${targetPath}`, 409);
  }

  // Verify the deepest existing ancestor directory is inside an allowed root before creating directories
  let existingAncestor = dirname(targetPath);
  while (existingAncestor && !existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) break;
    existingAncestor = parent;
  }
  if (!existingAncestor || !existsSync(existingAncestor) || !statSync(existingAncestor).isDirectory()) {
    return jsonError(`Parent directory does not exist on disk: ${dirname(targetPath)}`, 400);
  }

  const canonicalAncestor = realpathSync(existingAncestor);
  const sessionArtifactDir = info.sessionDir || getSessionArtifactDir(info.conversationId);
  const ancestorAllowed =
    (resolvedWorkspace ? isPathInsideDir(canonicalAncestor, resolvedWorkspace) : false) ||
    (sessionArtifactDir ? isPathInsideDir(canonicalAncestor, sessionArtifactDir) : false) ||
    Array.from(allowedSessionDirs).some((dir) => isPathInsideDir(canonicalAncestor, dir));

  if (!ancestorAllowed) {
    return jsonError(
      `Access denied: "${targetPath}" is outside the active workspace and session artifact directory.`,
      403
    );
  }

  const initialContent = typeof data?.content === 'string' ? data.content : '';
  const requestedDocType = typeof data?.docType === 'string' && data.docType.trim() ? data.docType.trim() : 'auto';
  const requestedKeyword = typeof data?.keyword === 'string' ? data.keyword.trim() : '';

  try {
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, initialContent, 'utf8');
    const canonicalPath = realpathSync(targetPath);
    allowedSessionFiles.add(canonicalPath);
    writeBaselineForPath(canonicalPath, initialContent);
    const st = statSync(canonicalPath);

    const audit = executeSpeedgrapherAudit({
      filePath: canonicalPath,
      text: initialContent,
      keyword: requestedKeyword,
      docType: requestedDocType,
      workspaceDir: resolvedWorkspace,
    });
    const metrics = extractPillMetrics(initialContent, audit);

    return {
      path: canonicalPath,
      content: initialContent,
      baselineContent: initialContent,
      mtimeMs: st.mtimeMs,
      size: st.size,
      docType: requestedDocType,
      keyword: requestedKeyword,
      workspacePath: resolvedWorkspace,
      conversationId: info.conversationId,
      audit,
      metrics,
    };
  } catch (err) {
    return jsonError(err.message, err.statusCode || 500);
  }
}

export function syncAndAuditDocument(data) {
  const rawInputPath = typeof data?.path === 'string' ? data.path : '';
  const workspacePath = typeof data?.workspacePath === 'string' ? data.workspacePath : '';
  const conversationId = typeof data?.conversationId === 'string' ? data.conversationId : '';

  let info;
  try {
    info = resolveActiveWorkspaceAndSession(conversationId, workspacePath);
  } catch (err) {
    return jsonError(`Failed to resolve active workspace: ${err.message}`, 400);
  }
  const resolvedWorkspace = info.workspaceDir || workspacePath || '';

  let targetPath;
  try {
    targetPath = normalizeTargetPath(rawInputPath, '', resolvedWorkspace);
  } catch (err) {
    return jsonError(`Invalid file path "${rawInputPath}": ${err.message}`, 400);
  }
  if (!targetPath) {
    return jsonError('Missing or invalid "path" parameter.', 400);
  }

  let canonicalPath;
  try {
    canonicalPath = validateAllowedMarkdownPath(targetPath, resolvedWorkspace, info.conversationId);
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
    const baselineToSave =
      typeof data?.baselineContent === 'string' ? data.baselineContent : content;
    writeBaselineForPath(canonicalPath, baselineToSave);
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

export function pollDocument(data) {
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
    const proposedContent = readFileSync(canonicalPath, 'utf8');
    const normalizedDisk = proposedContent.replace(/\r\n/g, '\n');
    const baselineContent = readBaselineForPath(canonicalPath);
    const hasPendingDiffs = Boolean(data?.hasPendingDiffs);
    const hasUnreconciledBaseline =
      !hasPendingDiffs &&
      typeof baselineContent === 'string' &&
      baselineContent.replace(/\r\n/g, '\n') !== normalizedDisk;

    const knownMtimeMs = typeof data?.knownMtimeMs === 'number' ? data.knownMtimeMs : 0;
    if (
      !hasUnreconciledBaseline &&
      typeof knownMtimeMs === 'number' &&
      knownMtimeMs > 0 &&
      Math.abs(st.mtimeMs - knownMtimeMs) < 1
    ) {
      return {
        changed: false,
        filePath: canonicalPath,
        path: canonicalPath,
        mtimeMs: st.mtimeMs,
        size: st.size,
      };
    }

    const hasCurrentContent = typeof data?.currentContent === 'string';
    if (hasCurrentContent && !hasUnreconciledBaseline) {
      const normalizedMem = data.currentContent.replace(/\r\n/g, '\n');
      if (normalizedDisk === normalizedMem) {
        return {
          changed: false,
          filePath: canonicalPath,
          path: canonicalPath,
          mtimeMs: st.mtimeMs,
          size: st.size,
        };
      }
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
      size: st.size,
      content: proposedContent,
      baselineContent: typeof baselineContent === 'string' ? baselineContent : undefined,
      audit,
      metrics,
    };
  } catch (err) {
    return jsonError(`Failed to poll file "${canonicalPath}": ${err.message}`, 500);
  }
}

export function handleAudit(data) {
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
  const hasText = typeof data?.text === 'string';
  const text = hasText ? data.text : '';
  const keyword = typeof data?.keyword === 'string' ? data.keyword.trim() : '';
  const docType = typeof data?.docType === 'string' && data.docType.trim() ? data.docType.trim() : 'auto';

  if (!hasText && !filePath) {
    return jsonError('Audit requires either "text" or a valid file "path".', 400);
  }

  try {
    const auditText = !filePath && text === '' ? '\n' : text;
    const audit = executeSpeedgrapherAudit({ filePath, text: auditText, keyword, docType, workspaceDir });
    const metrics = extractPillMetrics(text, audit);
    return { audit, metrics };
  } catch (err) {
    return jsonError(err.message, 500);
  }
}

export function handleValeRules(data) {
  const action = typeof data?.action === 'string' && data.action.trim() ? data.action.trim() : 'list';
  if (!VALID_VALE_RULE_ACTIONS.has(action)) {
    return jsonError(
      `Invalid Vale rules action "${action}". Expected one of: list, set_rule, add_vocab, remove_vocab.`,
      400
    );
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

  let targetPath = '';
  if (data?.path && typeof data.path === 'string' && data.path.trim()) {
    try {
      targetPath = normalizeTargetPath(data.path, '', workspaceDir);
    } catch (err) {
      return jsonError(`Invalid file path "${data.path}": ${err.message}`, 400);
    }
  }

  const ruleId = typeof data?.rule_id === 'string' ? data.rule_id.trim() : '';
  const level = typeof data?.level === 'string' && data.level.trim() ? data.level.trim() : '';
  const term = typeof data?.term === 'string' ? data.term.trim() : '';
  const scope = typeof data?.scope === 'string' && data.scope.trim() ? data.scope.trim().toLowerCase() : '';
  const enabled = typeof data?.enabled === 'boolean' ? data.enabled : undefined;
  const caseInsensitive = typeof data?.case_insensitive === 'boolean' ? data.case_insensitive : undefined;

  if ((action === 'set_rule' || action === 'reset_rule') && !ruleId) {
    return jsonError(`Missing required "rule_id" parameter for "${action}" action.`, 400);
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
  } else {
    workingDir = process.cwd();
  }

  try {
    const binPath = getBinaryPath();
    const payload = {
      action,
      scope: scope || undefined,
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
        timeout: AUDIT_SUBPROCESS_TIMEOUT_MS,
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
