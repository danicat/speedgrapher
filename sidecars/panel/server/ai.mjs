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

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { getSettingsDir, jsonError, PLUGIN_ROOT } from './paths.mjs';

const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const DEFAULT_THINKING_LEVEL = 'LOW';
const DEFAULT_VERTEX_LOCATION = 'global';
const DEFAULT_VERTEX_PROJECT = '';

const OAUTH_TIMEOUT_MS = 10_000;
const MODEL_CALL_TIMEOUT_MS = 25_000;

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

export function loadAiSettings() {
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

export function handleGetSettings() {
  const settings = loadAiSettings();
  return formatAiSettingsSummary(settings);
}

export function handleSaveSettings(data) {
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
}

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

  let tokenRes;
  try {
    tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: adc.client_id,
        client_secret: adc.client_secret,
        refresh_token: adc.refresh_token,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`Google Cloud OAuth2 token refresh timed out after ${OAUTH_TIMEOUT_MS / 1000}s.`);
    }
    throw new Error(`Google Cloud OAuth2 token refresh failed: ${err.message}`);
  }

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

  const providerLabel =
    settings.authMode === 'apikey'
      ? `Gemini API (${modelId})`
      : `Vertex AI (${modelId} @ ${settings.project}/${location})`;

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(
        `${providerLabel} request timed out after ${MODEL_CALL_TIMEOUT_MS / 1000}s. Try again or lower the thinking level in Settings (⚙️).`
      );
    }
    throw new Error(`${providerLabel} network request failed: ${err.message}`);
  }

  const rawBody = await res.text();
  if (!res.ok) {
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

function buildCompactDocumentContextWindow(fullDocument, targetBlocks) {
  const trimmed = String(fullDocument || '').trim();
  if (!trimmed || trimmed.length <= 5000) {
    return trimmed;
  }
  const lines = trimmed.split('\n');
  const firstTarget = targetBlocks[0];
  const startLine = Math.max(1, (firstTarget?.startLine || 1) - 25);
  const lastTarget = targetBlocks[targetBlocks.length - 1];
  const endLine = Math.min(lines.length, (lastTarget?.endLine || lines.length) + 25);
  const headings = lines.filter((l) => /^#{1,3}\s+/.test(l)).slice(0, 20).join('\n');
  const windowText = lines.slice(startLine - 1, endLine).join('\n');
  return [
    headings ? `Document Outline:\n${headings}` : '',
    `Surrounding Context (Lines ${startLine}–${endLine}):\n${windowText}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function handleAiRewrite(data) {
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
      const contextWindow = buildCompactDocumentContextWindow(fullDocument, targetBlocks);
      if (contextWindow) {
        promptSections.push(
          `### Document Context (for continuity and voice consistency only — only return proposals for the targetBlocks above):\n\`\`\`markdown\n${contextWindow}\n\`\`\``
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
            .replace(/<!--\s*review(?:\((?:[^")]|"(?:\\.|[^"\\])*")*\))?:[\s\S]*?-->/gi, '')
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

export async function handleTournament(data) {
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
}
