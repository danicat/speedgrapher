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

import { setSyncStatus, state } from './state.js';

export const DEFAULT_API_TIMEOUT_MS = 15_000;
export const AI_API_TIMEOUT_MS = 30_000;

const activeBlockAbortControllers = new Map();

export function registerBlockAbortController(key = '__doc__') {
  const prev = activeBlockAbortControllers.get(key);
  if (prev) {
    prev.abort(new DOMException('Superseded by new AI request', 'AbortError'));
  }
  const controller = new AbortController();
  activeBlockAbortControllers.set(key, controller);
  return controller;
}

export function linkBlockAbortController(key, controller) {
  if (key && controller) {
    activeBlockAbortControllers.set(key, controller);
  }
}

export function clearBlockAbortController(key = '__doc__', controller = null) {
  if (!controller || activeBlockAbortControllers.get(key) === controller) {
    activeBlockAbortControllers.delete(key);
  }
}

export function cancelBlockAiRequest(key = '__doc__', onAfterCancel = null) {
  const controller = activeBlockAbortControllers.get(key);
  if (controller) {
    controller.abort(new DOMException('Canceled by user', 'AbortError'));
    activeBlockAbortControllers.delete(key);
  }
  const docController = activeBlockAbortControllers.get('__doc__');
  if (docController) {
    docController.abort(new DOMException('Canceled by user', 'AbortError'));
    activeBlockAbortControllers.delete('__doc__');
  }

  for (const b of state.blocks) {
    if (key === '__doc__' || b.id === key || b.busy) {
      b.busy = false;
      b.busyLabel = '';
    }
  }
  setSyncStatus(state.filePath ? 'synced' : 'idle', 'Canceled');
  if (typeof onAfterCancel === 'function') {
    onAfterCancel();
  }
  return Boolean(controller || docController);
}

export async function apiPost(endpoint, payload, options = {}) {
  const isAiEndpoint = endpoint === '/api/ai/rewrite' || endpoint === '/api/tournament';
  const isDialogEndpoint = endpoint === '/api/dialog/open-file';
  const timeoutMs =
    typeof options.timeoutMs === 'number'
      ? options.timeoutMs
      : isDialogEndpoint
      ? 65_000
      : isAiEndpoint
      ? AI_API_TIMEOUT_MS
      : DEFAULT_API_TIMEOUT_MS;

  const timeoutController = new AbortController();
  let timedOut = false;
  const timerId = setTimeout(() => {
    timedOut = true;
    timeoutController.abort(new DOMException(`Request timed out after ${timeoutMs / 1000}s`, 'TimeoutError'));
  }, timeoutMs);

  const externalSignal = options.signal || null;
  const onExternalAbort = () => {
    timeoutController.abort(externalSignal.reason || new DOMException('Canceled by user', 'AbortError'));
  };
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timerId);
      throw new DOMException('Request canceled.', 'AbortError');
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  if (!window.sidecar?.fetch) {
    clearTimeout(timerId);
    throw new Error('Sidecar bridge (window.sidecar.fetch) is not initialized.');
  }

  let res;
  try {
    res = await window.sidecar.fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
      signal: timeoutController.signal,
    });
  } catch (err) {
    if (timedOut || err.name === 'TimeoutError') {
      throw new Error(
        `Request to ${endpoint} timed out after ${Math.round(timeoutMs / 1000)}s. Please try again or check Settings (⚙️).`
      );
    }
    if (err.name === 'AbortError' || externalSignal?.aborted) {
      const abortErr = new Error('AI request canceled.');
      abortErr.isCanceled = true;
      throw abortErr;
    }
    throw err;
  } finally {
    clearTimeout(timerId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }

  const rawText = await res.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (err) {
    throw new Error(
      `Invalid JSON response from ${endpoint} (HTTP ${res.status}): ${err.message}\nRaw body:\n${rawText.slice(0, 500)}`
    );
  }
  if (!res.ok || data.error) {
    throw new Error(data.error || `HTTP ${res.status} on ${endpoint}`);
  }
  return data;
}
