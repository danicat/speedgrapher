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

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Response, SidecarApp } from 'sidecar_sdk';

import {
  handleAiRewrite,
  handleGetSettings,
  handleSaveSettings,
  handleTournament,
} from './server/ai.mjs';
import {
  createAndOpenDocument,
  handleAudit,
  handleValeRules,
  openAndAuditDocument,
  pollDocument,
  syncAndAuditDocument,
} from './server/audit.mjs';
import {
  handleGetFiles,
  handleGetImage,
  handleListDirectory,
  PLUGIN_ROOT,
  setSidecarApp,
} from './server/paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const app = new SidecarApp();
setSidecarApp(app);

function readLocal(relPath) {
  return readFileSync(join(HERE, relPath), 'utf8');
}

function stripModuleSyntax(source) {
  return source
    .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+(?=(?:async\s+)?function\b|const\b|let\b)/gm, '');
}

const FRONTEND_MODULES = [
  'state.js',
  'api.js',
  'markdown.js',
  'diagnostics.js',
  'renderer.js',
  'canvas.js',
  'comments.js',
  'ai.js',
  'popovers.js',
  'sync.js',
];

function buildAppBundle() {
  const chunks = FRONTEND_MODULES.map((modName) => {
    const raw = readLocal(`modules/${modName}`);
    return `// === modules/${modName} ===\n${stripModuleSyntax(raw)}`;
  });
  chunks.push(`// === app.js ===\n${stripModuleSyntax(readLocal('app.js'))}`);
  return `'use strict';\n(() => {\n${chunks.join('\n\n')}\n})();\n`;
}

// ---------------------------------------------------------------------------
// Static Frontend Assets
// ---------------------------------------------------------------------------

app.page('/', () =>
  new Response(readLocal('index.html'), {
    contentType: 'text/html; charset=utf-8',
    headers: { 'Cache-Control': 'no-store' },
  })
);

app.page('/app.js', () =>
  new Response(buildAppBundle(), {
    contentType: 'application/javascript; charset=utf-8',
    headers: { 'Cache-Control': 'no-store' },
  })
);

app.api(
  '/styles.css',
  () =>
    new Response(readLocal('styles.css'), {
      contentType: 'text/css; charset=utf-8',
      headers: { 'Cache-Control': 'no-store' },
    }),
  'GET'
);

app.api(
  '/assets/logo.svg',
  () => {
    const logoPath = join(PLUGIN_ROOT, 'assets', 'logo.svg');
    return new Response(readFileSync(logoPath, 'utf8'), {
      contentType: 'image/svg+xml',
      headers: { 'Cache-Control': 'no-cache' },
    });
  },
  'GET'
);

// ---------------------------------------------------------------------------
// API Endpoints
// ---------------------------------------------------------------------------

app.api('/api/image', handleGetImage, 'GET');
app.api('/api/files', handleGetFiles, 'POST');
app.api('/api/fs/list-dir', handleListDirectory, 'POST');

app.api('/api/doc/open', openAndAuditDocument, 'POST');
app.api('/api/doc/create', createAndOpenDocument, 'POST');
app.api('/api/doc/sync', syncAndAuditDocument, 'POST');
app.api('/api/doc/poll', pollDocument, 'POST');
app.api('/api/audit', handleAudit, 'POST');
app.api('/api/vale/rules', handleValeRules, 'POST');

app.api('/api/settings/get', handleGetSettings, 'POST');
app.api('/api/settings', handleSaveSettings, 'POST');
app.api('/api/ai/rewrite', handleAiRewrite, 'POST');
app.api('/api/tournament', handleTournament, 'POST');

await app.run();
