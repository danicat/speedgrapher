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

import { isSpanSliceValidForBlock } from './markdown.js';
import { escapeAttr, escapeHtml, pathBasename, state } from './state.js';

export const FRONTMATTER_STANDARD_KEYS = [
  'title',
  'summary',
  'description',
  'date',
  'lastmod',
  'author',
  'authors',
  'tags',
  'categories',
  'keywords',
  'slug',
  'draft',
  'weight',
  'license',
  'version',
];

export const FRONTMATTER_TAG_KEYS = new Set(['tags', 'keywords', 'categories']);

// ---------------------------------------------------------------------------
// 100% GFM Markdown Rendering (Images, Frontmatter, Alerts, Task Lists, Tables, Math)
// ---------------------------------------------------------------------------

export function resolveMarkdownImageUrl(rawSrc) {
  const src = String(rawSrc || '').trim();
  if (!src) return '';
  if (/^(https?:\/\/|data:image\/|blob:)/i.test(src)) {
    return src;
  }
  return `/api/image?path=${encodeURIComponent(src)}&doc=${encodeURIComponent(state.filePath || '')}&ws=${encodeURIComponent(state.workspacePath || '')}`;
}

export const resolveDocumentAssetUrl = resolveMarkdownImageUrl;
export const resolveLocalImageUrl = resolveMarkdownImageUrl;

export function formatMathAscii(rawMath) {
  return String(rawMath || '')
    .replace(/^\$\$\s*|\s*\$\$$/g, '')
    .replace(/^\$\s*|\s*\$$/g, '')
    .trim();
}

export function renderLatexMathToHtml(rawMath, displayMode = true) {
  const mathBody = formatMathAscii(rawMath);
  if (displayMode) {
    return `<div class="md-math-block">${escapeHtml(mathBody)}</div>`;
  }
  return `<span class="md-inline-math">${escapeHtml(mathBody)}</span>`;
}

export function renderPlainWithWordSpans(plainText, plainAbsOffset, wordSpans = []) {
  if (!plainText) return '';
  const sliceEnd = plainAbsOffset + plainText.length;
  const matching = (wordSpans || [])
    .map((sp) => ({
      ...sp,
      startOffset: sp.startOffset ?? sp.start ?? 0,
      endOffset: sp.endOffset ?? sp.end ?? 0,
      pillar: sp.pillar || sp.category || 'vale',
    }))
    .filter((sp) => sp.startOffset >= plainAbsOffset && sp.endOffset <= sliceEnd && sp.startOffset < sp.endOffset)
    .sort((a, b) => a.startOffset - b.startOffset || (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset));

  const chosen = [];
  let cursor = plainAbsOffset;
  for (const sp of matching) {
    if (sp.startOffset < cursor) continue;
    chosen.push(sp);
    cursor = sp.endOffset;
  }

  if (chosen.length === 0) {
    return escapeHtml(plainText);
  }

  let out = '';
  let relIdx = 0;
  for (const sp of chosen) {
    const relStart = sp.startOffset - plainAbsOffset;
    const relEnd = sp.endOffset - plainAbsOffset;
    if (relStart > relIdx) {
      out += escapeHtml(plainText.slice(relIdx, relStart));
    }
    const inner = escapeHtml(plainText.slice(relStart, relEnd));
    out += `<mark class="lens-span" data-span-id="${escapeAttr(sp.id)}" data-pillar="${escapeAttr(sp.pillar)}">${inner}</mark>`;
    relIdx = relEnd;
  }
  if (relIdx < plainText.length) {
    out += escapeHtml(plainText.slice(relIdx));
  }
  return out;
}

export function renderInlineMarkdownTokens(segmentText, segmentAbsOffset = 0, wordSpans = []) {
  if (!segmentText) return '';
  const tokenRe =
    /(`+[^`\n]+`+|`{2,})|(!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"([^"]*)")?\))|(<img\b[^>]*>)|(\[((?:`+[^`\n]*`+|!\[[^\]\n]*\]\([^)\s]+(?:\s+"[^"]*")?\)|[^\[\]\n])+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"([^"]*)")?\))|(\$\$([^$\n]+)\$\$)|((?<!\$)\$(?!\$)([^$\n]+?)\$(?!\d))|(\*\*\*(?!\s)((?:(?!\*\*\*)[^\n])*?\S)\*\*\*)|(\*\*(?!\s)((?:(?!\*\*)[^\n])*?\S)\*\*)|(__(?!\s)((?:(?!__)[^\n])*?\S)__)|((?<!\*)\*(?![*\s])((?:(?!\*)[^\n])*?[^\s*])\*(?!\*))|((?<![_\w])_(?![_\s])((?:(?!_)[^\n])*?[^\s_])_(?![_\w]))|(~~(?!\s)((?:(?!~~)[^\n])*?\S)~~)|(<!--[\s\S]*?-->)/gi;

  let out = '';
  let lastIndex = 0;
  let m;

  while ((m = tokenRe.exec(segmentText)) !== null) {
    if (m.index > lastIndex) {
      const gap = segmentText.slice(lastIndex, m.index);
      out += renderPlainWithWordSpans(gap, segmentAbsOffset + lastIndex, wordSpans);
    }

    const tokStart = segmentAbsOffset + m.index;
    const full = m[0];

    if (m[1]) {
      const ticks = full.match(/^`+/)[0].length;
      const codeBody = full.length > ticks * 2 ? full.slice(ticks, full.length - ticks) : '';
      out += `<code class="inline-code">${escapeHtml(codeBody)}</code>`;
    } else if (m[2]) {
      const alt = m[3] || '';
      const rawSrc = m[4] || '';
      const title = m[5] || '';
      const resolvedUrl = resolveMarkdownImageUrl(rawSrc);
      out += `<span class="md-inline-image-wrap"><img class="md-inline-image" src="${escapeHtml(resolvedUrl)}" data-raw-src="${escapeHtml(rawSrc)}" alt="${escapeHtml(alt)}" title="${escapeHtml(title)}" loading="lazy" /><span class="md-image-error hidden" hidden>⚠ Image not found: <code>${escapeHtml(rawSrc)}</code></span></span>`;
    } else if (m[6]) {
      const srcMatch = full.match(/\bsrc=["']([^"']+)["']/i);
      const altMatch = full.match(/\balt=["']([^"']*)["']/i);
      const titleMatch = full.match(/\btitle=["']([^"']*)["']/i);
      const rawSrc = srcMatch ? srcMatch[1] : '';
      const alt = altMatch ? altMatch[1] : '';
      const title = titleMatch ? titleMatch[1] : '';
      const resolvedUrl = resolveMarkdownImageUrl(rawSrc);
      out += `<span class="md-inline-image-wrap"><img class="md-inline-image" src="${escapeHtml(resolvedUrl)}" data-raw-src="${escapeHtml(rawSrc)}" alt="${escapeHtml(alt)}" title="${escapeHtml(title)}" loading="lazy" /><span class="md-image-error hidden" hidden>⚠ Image not found: <code>${escapeHtml(rawSrc)}</code></span></span>`;
    } else if (m[7]) {
      const label = m[8];
      const url = String(m[9] || '').trim();
      const title = m[10] || '';
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      const labelHtml = renderInlineMarkdownTokens(label, tokStart + 1, wordSpans);
      if (/^\s*(javascript|data|vbscript):/i.test(url)) {
        out += labelHtml;
      } else if (/^(https?:\/\/|mailto:)/i.test(url)) {
        out += `<a class="inline-link" href="${escapeHtml(url)}"${titleAttr} target="_blank" rel="noopener noreferrer">${labelHtml}</a>`;
      } else {
        out += `<a class="inline-link local-doc-link" href="#" data-local-href="${escapeHtml(url)}"${titleAttr}>${labelHtml}</a>`;
      }
    } else if (m[11]) {
      out += renderLatexMathToHtml(m[12], false);
    } else if (m[13]) {
      out += renderLatexMathToHtml(m[14], false);
    } else if (m[15]) {
      const inner = m[16];
      out += `<strong><em>${renderInlineMarkdownTokens(inner, tokStart + 3, wordSpans)}</em></strong>`;
    } else if (m[17]) {
      const inner = m[18];
      out += `<strong>${renderInlineMarkdownTokens(inner, tokStart + 2, wordSpans)}</strong>`;
    } else if (m[19]) {
      const inner = m[20];
      out += `<strong>${renderInlineMarkdownTokens(inner, tokStart + 2, wordSpans)}</strong>`;
    } else if (m[21]) {
      const inner = m[22];
      out += `<em>${renderInlineMarkdownTokens(inner, tokStart + 1, wordSpans)}</em>`;
    } else if (m[23]) {
      const inner = m[24];
      out += `<em>${renderInlineMarkdownTokens(inner, tokStart + 1, wordSpans)}</em>`;
    } else if (m[25]) {
      const inner = m[26];
      out += `<del>${renderInlineMarkdownTokens(inner, tokStart + 2, wordSpans)}</del>`;
    } else if (m[27]) {
      // Hide inline HTML comments (<!-- ... -->) in rendered view
    } else {
      out += renderPlainWithWordSpans(full, tokStart, wordSpans);
    }

    lastIndex = m.index + full.length;
  }

  if (lastIndex < segmentText.length) {
    const tail = segmentText.slice(lastIndex);
    out += renderPlainWithWordSpans(tail, segmentAbsOffset + lastIndex, wordSpans);
  }

  return out;
}

export const renderInlineMarkdownSegment = (text) => renderInlineMarkdownTokens(text, 0, []);

export function renderRichSliceWithSpans(sliceText, sliceBaseOffset = 0, activeSpans = []) {
  if (!sliceText) return '';
  const sliceEnd = sliceBaseOffset + sliceText.length;
  const normalizedSpans = (activeSpans || []).map((s) => ({
    ...s,
    startOffset: s.startOffset ?? s.start ?? 0,
    endOffset: s.endOffset ?? s.end ?? 0,
    pillar: s.pillar || s.category || 'vale',
  }));
  const wordSpans = normalizedSpans.filter((s) => !s.isSentenceSpan);
  const sentenceSpans = normalizedSpans
    .filter((s) => s.isSentenceSpan && s.endOffset > sliceBaseOffset && s.startOffset < sliceEnd)
    .map((s) => ({
      ...s,
      clampedStart: Math.max(sliceBaseOffset, s.startOffset),
      clampedEnd: Math.min(sliceEnd, s.endOffset),
    }))
    .filter((s) => s.clampedEnd > s.clampedStart)
    .sort((a, b) => a.clampedStart - b.clampedStart);

  if (sentenceSpans.length === 0) {
    return renderInlineMarkdownTokens(sliceText, sliceBaseOffset, wordSpans);
  }

  const chosenSentences = [];
  let cursor = sliceBaseOffset;
  for (const sp of sentenceSpans) {
    if (sp.clampedStart < cursor) continue;
    chosenSentences.push(sp);
    cursor = sp.clampedEnd;
  }

  let out = '';
  let relIdx = 0;
  for (const sp of chosenSentences) {
    const relStart = sp.clampedStart - sliceBaseOffset;
    const relEnd = sp.clampedEnd - sliceBaseOffset;
    if (relStart > relIdx) {
      out += renderInlineMarkdownTokens(sliceText.slice(relIdx, relStart), sliceBaseOffset + relIdx, wordSpans);
    }
    const innerHtml = renderInlineMarkdownTokens(sliceText.slice(relStart, relEnd), sp.clampedStart, wordSpans);
    out += `<mark class="lens-span" data-span-id="${escapeAttr(sp.id)}" data-pillar="${escapeAttr(sp.pillar)}">${innerHtml}</mark>`;
    relIdx = relEnd;
  }
  if (relIdx < sliceText.length) {
    out += renderInlineMarkdownTokens(sliceText.slice(relIdx), sliceBaseOffset + relIdx, wordSpans);
  }
  return out;
}

// Full YAML & TOML Frontmatter Parser (supports block scalars > / |, arrays, nested maps, and lists of objects)
export function parseFrontmatterData(rawFrontmatter) {
  const lines = String(rawFrontmatter || '').replace(/\r\n/g, '\n').split('\n');
  if (lines.length < 2) return { format: 'yaml', data: {} };
  const isToml = lines[0].trim() === '+++';
  const bodyLines = lines.slice(1, lines[lines.length - 1].trim() === (isToml ? '+++' : '---') ? -1 : lines.length);
  const data = {};

  if (isToml) {
    for (const line of bodyLines) {
      const m = line.match(/^\s*([a-zA-Z0-9_.-]+)\s*=\s*(.+)$/);
      if (!m) continue;
      const key = m[1];
      const val = m[2].trim();
      if (val.startsWith('[') && val.endsWith(']')) {
        data[key] = val
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
      } else {
        data[key] = val.replace(/^["']|["']$/g, '');
      }
    }
    return { format: 'toml', data };
  }

  let i = 0;
  while (i < bodyLines.length) {
    const line = bodyLines[i];
    if (!line.trim() || line.trim().startsWith('#')) {
      i++;
      continue;
    }
    const topMatch = line.match(/^([a-zA-Z0-9_.-]+)\s*:\s*(.*)$/);
    if (!topMatch) {
      i++;
      continue;
    }
    const key = topMatch[1];
    const rest = topMatch[2].trim();

    // Block scalar (> or |)
    if (/^[>|][-+]?$/.test(rest)) {
      const foldNewlines = rest.startsWith('>');
      const scalarLines = [];
      i++;
      while (i < bodyLines.length && (/^\s+\S/.test(bodyLines[i]) || bodyLines[i].trim() === '')) {
        scalarLines.push(bodyLines[i].replace(/^\s{2}/, '').trimEnd());
        i++;
      }
      data[key] = foldNewlines
        ? scalarLines.map((l) => l.trim()).filter(Boolean).join(' ')
        : scalarLines.join('\n').trim();
      continue;
    }

    // Inline array [a, b, c]
    if (rest.startsWith('[') && rest.endsWith(']')) {
      data[key] = rest
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
      i++;
      continue;
    }

    // Multi-line list (including nested list of objects like `media:`) or nested map
    if (rest === '') {
      const listItems = [];
      const mapEntries = {};
      let currentListObj = null;
      let lastSubKey = null;
      i++;
      while (i < bodyLines.length && (/^\s+\S/.test(bodyLines[i]) || bodyLines[i].trim() === '')) {
        const sub = bodyLines[i];
        const trimmedSub = sub.trim();
        if (!trimmedSub || trimmedSub.startsWith('#')) {
          i++;
          continue;
        }
        const listMatch = sub.match(/^\s*-\s*(.*)$/);
        const mapMatch = sub.match(/^\s+([a-zA-Z0-9_.-]+)\s*:\s*(.*)$/);
        if (listMatch) {
          const itemRest = listMatch[1].trim();
          const itemKvMatch = itemRest.match(/^([a-zA-Z0-9_.-]+)\s*:\s*(.*)$/);
          if (itemKvMatch) {
            const firstKey = itemKvMatch[1].trim();
            const rawVal = itemKvMatch[2].trim().replace(/^["']|["']$/g, '');
            currentListObj = {
              [firstKey]: /^[>|][-+]?$/.test(rawVal) ? '' : rawVal,
            };
            lastSubKey = firstKey;
            listItems.push(currentListObj);
          } else if (itemRest === '' || /^[>|][-+]?$/.test(itemRest)) {
            currentListObj = null;
            lastSubKey = null;
            listItems.push('');
          } else {
            currentListObj = null;
            lastSubKey = null;
            listItems.push(itemRest.replace(/^["']|["']$/g, ''));
          }
        } else if (mapMatch) {
          const subKey = mapMatch[1].trim();
          const rawSubVal = mapMatch[2].trim().replace(/^["']|["']$/g, '');
          const subVal = /^[>|][-+]?$/.test(rawSubVal) ? '' : rawSubVal;
          lastSubKey = subKey;
          if (currentListObj !== null) {
            currentListObj[subKey] = subVal;
          } else if (listItems.length > 0) {
            const lastIdx = listItems.length - 1;
            const prev = listItems[lastIdx];
            if (prev === '') {
              currentListObj = { [subKey]: subVal };
              listItems[lastIdx] = currentListObj;
            } else {
              currentListObj = { value: String(prev), [subKey]: subVal };
              listItems[lastIdx] = currentListObj;
            }
          } else {
            mapEntries[subKey] = subVal;
          }
        } else {
          // Wrapped continuation line inside a list item or nested map value
          const contText = trimmedSub.replace(/^["']|["']$/g, '');
          if (currentListObj !== null && lastSubKey) {
            currentListObj[lastSubKey] = currentListObj[lastSubKey]
              ? `${currentListObj[lastSubKey]} ${contText}`
              : contText;
          } else if (listItems.length > 0) {
            const lastIdx = listItems.length - 1;
            listItems[lastIdx] = listItems[lastIdx] ? `${listItems[lastIdx]} ${contText}` : contText;
          } else if (lastSubKey && lastSubKey in mapEntries) {
            mapEntries[lastSubKey] = mapEntries[lastSubKey]
              ? `${mapEntries[lastSubKey]} ${contText}`
              : contText;
          }
        }
        i++;
      }
      if (listItems.length > 0) {
        data[key] = listItems.map((item) => {
          if (item && typeof item === 'object') {
            return { ...item };
          }
          return String(item);
        });
      } else if (Object.keys(mapEntries).length > 0) {
        data[key] = mapEntries;
      } else {
        data[key] = '';
      }
      continue;
    }

    data[key] = rest.replace(/^["']|["']$/g, '');
    i++;
  }

  return { format: 'yaml', data };
}

export function renderFrontmatterFieldValue(key, val) {
  const normalizedKey = String(key || '').toLowerCase();
  if (FRONTMATTER_TAG_KEYS.has(normalizedKey)) {
    const tagItems = Array.isArray(val)
      ? val.map((item) => String(item ?? '').trim()).filter(Boolean)
      : typeof val === 'string' && val
        ? val
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : [];
    if (tagItems.length === 0) return '';
    return `<div class="md-fm-tags">${tagItems.map((t) => `<span class="md-fm-tag-pill">${escapeHtml(t)}</span>`).join('')}</div>`;
  }

  if (Array.isArray(val)) {
    const hasObjects = val.some((item) => item && typeof item === 'object');
    if (hasObjects) {
      return `<div class="md-fm-obj-list">${val
        .map((item) => {
          if (item && typeof item === 'object') {
            return `<div class="md-fm-obj-item">${Object.entries(item)
              .map(
                ([ik, iv]) =>
                  `<div class="md-fm-obj-row"><span class="md-fm-obj-key">${escapeHtml(ik)}</span><span class="md-fm-obj-val">${escapeHtml(String(iv ?? ''))}</span></div>`
              )
              .join('')}</div>`;
          }
          return `<div class="md-fm-obj-item"><div class="md-fm-obj-row"><span class="md-fm-obj-val">${escapeHtml(String(item ?? ''))}</span></div></div>`;
        })
        .join('')}</div>`;
    }
    return `<ul class="md-fm-list">${val.map((item) => `<li>${escapeHtml(String(item ?? ''))}</li>`).join('')}</ul>`;
  }

  if (val && typeof val === 'object') {
    return `<div class="md-fm-obj-item">${Object.entries(val)
      .map(
        ([ik, iv]) =>
          `<div class="md-fm-obj-row"><span class="md-fm-obj-key">${escapeHtml(ik)}</span><span class="md-fm-obj-val">${escapeHtml(String(iv ?? ''))}</span></div>`
      )
      .join('')}</div>`;
  }

  return escapeHtml(String(val ?? ''));
}

export function renderFrontmatterBlockCard(block) {
  const { format, data } = parseFrontmatterData(block?.raw || '');
  const isSkillDoc =
    (state.filePath && state.filePath.endsWith('SKILL.md')) ||
    Boolean(data.name && data.description && (data.license || data.metadata));

  if (isSkillDoc) {
    const metaObj = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
    const version = data.version || metaObj.version || '';
    const license = data.license || metaObj.license || '';
    const rawTags = metaObj.tags || data.tags || '';
    const tagList = Array.isArray(rawTags)
      ? rawTags
      : String(rawTags)
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);

    return `
      <div class="md-frontmatter-card">
        <div class="md-fm-header-row">
          <span class="md-fm-head">Agent Skill Frontmatter (SKILL.md)</span>
          <div class="md-fm-badges">
            ${version ? `<span class="md-fm-badge">v${escapeHtml(version)}</span>` : ''}
            ${license ? `<span class="md-fm-badge status-good">${escapeHtml(license)}</span>` : ''}
          </div>
        </div>
        <div class="md-fm-grid">
          <div class="md-fm-key">name</div>
          <div class="md-fm-val"><code>${escapeHtml(data.name || '')}</code></div>
          <div class="md-fm-key">description</div>
          <div class="md-fm-val">${escapeHtml(data.description || '')}</div>
          ${metaObj.author ? `<div class="md-fm-key">author</div><div class="md-fm-val">${escapeHtml(metaObj.author)}</div>` : ''}
          ${metaObj.category ? `<div class="md-fm-key">category</div><div class="md-fm-val">${escapeHtml(metaObj.category)}</div>` : ''}
          ${
            tagList.length > 0
              ? `<div class="md-fm-key">tags</div><div class="md-fm-val"><div class="md-fm-tags">${tagList
                  .map((t) => `<span class="md-fm-tag-pill">${escapeHtml(t)}</span>`)
                  .join('')}</div></div>`
              : ''
          }
        </div>
      </div>
    `;
  }

  // Hugo / Technical Article / Social Post Frontmatter Card
  const titleStr = String(data.title || '');
  const summaryStr = String(data.summary || '');
  const descStr = String(data.description || '');
  const isDraft =
    data.draft !== undefined
      ? String(data.draft || '').toLowerCase() === 'true'
      : String(data.status || '').toLowerCase() === 'draft';
  const hasDraftBadge = data.draft !== undefined || data.status !== undefined;
  const draftBadgeText =
    data.draft !== undefined
      ? isDraft
        ? 'DRAFT'
        : 'PUBLISHED'
      : String(data.status || '').toUpperCase();

  const tags = Array.isArray(data.tags)
    ? data.tags
    : typeof data.tags === 'string' && data.tags
      ? data.tags.split(',').map((t) => t.trim())
      : [];

  const sumOk = summaryStr.length >= 80 && summaryStr.length <= 180;
  const descOk = descStr.length >= 120 && descStr.length <= 160;

  const extraRows = [];
  for (const [k, v] of Object.entries(data)) {
    if (['title', 'summary', 'description', 'draft', 'tags'].includes(k)) continue;
    const valHtml = renderFrontmatterFieldValue(k, v);
    extraRows.push(`<div class="md-fm-key">${escapeHtml(k)}</div><div class="md-fm-val">${valHtml}</div>`);
  }

  return `
    <div class="md-frontmatter-card">
      <div class="md-fm-header-row">
        <span class="md-fm-head">${format === 'toml' ? 'TOML (+++)' : 'YAML (---)'} Frontmatter</span>
        <div class="md-fm-badges">
          ${hasDraftBadge ? `<span class="md-fm-badge ${isDraft ? 'status-warn' : 'status-good'}">${escapeHtml(draftBadgeText)}</span>` : ''}
          ${titleStr ? `<span class="md-fm-badge">${titleStr.length}c title</span>` : ''}
        </div>
      </div>
      <div class="md-fm-grid">
        ${titleStr ? `<div class="md-fm-key">title</div><div class="md-fm-val"><strong>${escapeHtml(titleStr)}</strong></div>` : ''}
        ${
          summaryStr
            ? `<div class="md-fm-key">summary <span class="md-fm-badge ${sumOk ? 'status-good' : 'status-warn'}">${summaryStr.length}c</span></div><div class="md-fm-val">${escapeHtml(summaryStr)}</div>`
            : ''
        }
        ${
          descStr
            ? `<div class="md-fm-key">description <span class="md-fm-badge ${descOk ? 'status-good' : 'status-warn'}">${descStr.length}c</span></div><div class="md-fm-val">${escapeHtml(descStr)}</div>`
            : ''
        }
        ${extraRows.join('')}
        ${
          tags.length > 0
            ? `<div class="md-fm-key">tags</div><div class="md-fm-val"><div class="md-fm-tags">${tags
                .map((t) => `<span class="md-fm-tag-pill">${escapeHtml(t)}</span>`)
                .join('')}</div></div>`
            : ''
        }
      </div>
    </div>
  `;
}

export function renderMarkdownTable(block, activeSpans = []) {
  const rawLines = (block?.raw || '').split('\n');
  const nonEmpty = rawLines.map((line, idx) => ({ line, idx })).filter((item) => item.line.trim() !== '');
  if (nonEmpty.length < 2) return `<pre class="md-code-pre">${escapeHtml(block?.raw || '')}</pre>`;

  const lineStartOffsets = [];
  let acc = 0;
  for (const l of rawLines) {
    lineStartOffsets.push(acc);
    acc += l.length + 1;
  }

  const parseCellsWithOffsets = (lineStr, lineAbsStart) => {
    const findNextCellPipe = (str, fromIdx) => {
      let i = fromIdx;
      while (i < str.length) {
        const ch = str[i];
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === '`') {
          let tickLen = 1;
          while (i + tickLen < str.length && str[i + tickLen] === '`') tickLen++;
          const closeFence = '`'.repeat(tickLen);
          const closeIdx = str.indexOf(closeFence, i + tickLen);
          if (closeIdx >= 0) {
            i = closeIdx + tickLen;
            continue;
          }
        }
        if (ch === '|') {
          return i;
        }
        i++;
      }
      return -1;
    };

    const cells = [];
    let start = 0;
    if (lineStr.trimStart().startsWith('|')) {
      start = lineStr.indexOf('|') + 1;
    }
    let cur = start;
    while (cur <= lineStr.length) {
      const nextPipe = findNextCellPipe(lineStr, cur);
      if (nextPipe < 0) {
        const tail = lineStr.slice(cur);
        if (tail.trim()) {
          const lead = (tail.match(/^\s*/) || [''])[0].length;
          cells.push({
            text: tail.trim().replace(/\\\|/g, '|'),
            absOffset: lineAbsStart + cur + lead,
          });
        }
        break;
      }
      const rawCell = lineStr.slice(cur, nextPipe);
      const lead = (rawCell.match(/^\s*/) || [''])[0].length;
      cells.push({
        text: rawCell.trim().replace(/\\\|/g, '|'),
        absOffset: lineAbsStart + cur + lead,
      });
      cur = nextPipe + 1;
    }
    return cells;
  };

  const alignCells = parseCellsWithOffsets(nonEmpty[1].line, lineStartOffsets[nonEmpty[1].idx]);
  const alignments = alignCells.map((c) => {
    const t = c.text;
    if (t.startsWith(':') && t.endsWith(':')) return 'center';
    if (t.endsWith(':')) return 'right';
    return 'left';
  });

  const headerCells = parseCellsWithOffsets(nonEmpty[0].line, lineStartOffsets[nonEmpty[0].idx]);
  const thead = `<thead><tr>${headerCells
    .map((c, colIdx) => {
      const align = alignments[colIdx] || 'left';
      return `<th style="text-align:${align};">${renderRichSliceWithSpans(c.text, c.absOffset, activeSpans)}</th>`;
    })
    .join('')}</tr></thead>`;

  const bodyRowsHtml = nonEmpty.slice(2).map((rowItem) => {
    const rowCells = parseCellsWithOffsets(rowItem.line, lineStartOffsets[rowItem.idx]);
    return `<tr>${rowCells
      .map((c, colIdx) => {
        const align = alignments[colIdx] || 'left';
        return `<td style="text-align:${align};">${renderRichSliceWithSpans(c.text, c.absOffset, activeSpans)}</td>`;
      })
      .join('')}</tr>`;
  });

  return `<div class="md-table-wrap"><table class="md-table">${thead}<tbody>${bodyRowsHtml.join('')}</tbody></table></div>`;
}

export function renderBlockWithAmbientSpans(block) {
  if (block.type === 'hr') {
    return '<hr />';
  }

  if (block.type === 'frontmatter') {
    return renderFrontmatterBlockCard(block);
  }

  if (block.type === 'code') {
    const lines = block.raw.split('\n');
    const firstLine = lines[0] || '';
    const langMatch = firstLine.match(/^(?:`{3,}|~{3,})\s*(\S*)/);
    const lang = langMatch && langMatch[1] ? langMatch[1] : 'code';
    const hasClosingFence = lines.length > 1 && /^(?:`{3,}|~{3,})\s*$/.test(lines[lines.length - 1]);
    const codeBody = lines.slice(1, hasClosingFence ? -1 : lines.length).join('\n');
    return `
      <div class="md-code-block">
        <div class="md-code-header">
          <span class="md-code-lang">${escapeHtml(lang)}</span>
          ${state.studioMode === 'editor' ? '<span style="opacity: 0.75;">Click to edit Markdown</span>' : ''}
        </div>
        <pre class="md-code-pre"><code>${escapeHtml(codeBody)}</code></pre>
      </div>
    `;
  }

  if (block.type === 'math') {
    return renderLatexMathToHtml(block.raw, true);
  }

  if (block.type === 'image') {
    const trimmed = block.raw.trim();
    let alt = '';
    let rawSrc = '';
    let title = '';
    const mdImg = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/);
    if (mdImg) {
      alt = mdImg[1] || '';
      rawSrc = mdImg[2] || '';
      title = mdImg[3] || '';
    } else {
      const srcM = trimmed.match(/\bsrc=["']([^"']+)["']/i);
      const altM = trimmed.match(/\balt=["']([^"']*)["']/i);
      const titleM = trimmed.match(/\btitle=["']([^"']*)["']/i);
      rawSrc = srcM ? srcM[1] : '';
      alt = altM ? altM[1] : '';
      title = titleM ? titleM[1] : '';
    }
    const resolvedUrl = resolveMarkdownImageUrl(rawSrc);
    const altBadge = alt
      ? `<span>alt: ${escapeHtml(alt)}</span>`
      : `<span style="color: var(--col-warn);">⚠ Missing image alt text</span>`;
    return `
      <figure class="md-image-figure">
        <img class="md-image" src="${escapeHtml(resolvedUrl)}" data-raw-src="${escapeHtml(rawSrc)}" alt="${escapeHtml(alt)}" title="${escapeHtml(title)}" loading="lazy" />
        <div class="md-image-error hidden" hidden>⚠ Image not found: <code>${escapeHtml(rawSrc)}</code></div>
        <figcaption class="md-image-caption">
          ${altBadge}
          <code style="font-size: 10px;">${escapeHtml(rawSrc)}</code>
        </figcaption>
      </figure>
    `;
  }

  // In Reader Mode, zero diagnostic clutter; in Editor & Reviewer Modes, show active lens spans
  const showSpans = state.studioMode === 'editor' || state.studioMode === 'reviewer';
  const activeSpans = showSpans
    ? state.spans
        .filter((s) => {
          const pillar = s.pillar || s.category;
          if (s.blockId !== block.id || !state.activeLenses.has(pillar)) return false;
          const start = s.startOffset ?? s.start ?? 0;
          const end = s.endOffset ?? s.end ?? 0;
          return isSpanSliceValidForBlock(block.raw, start, end, s.match || s.matchedText);
        })
        .map((s) => ({
          ...s,
          pillar: s.pillar || s.category,
          startOffset: s.startOffset ?? s.start ?? 0,
          endOffset: s.endOffset ?? s.end ?? 0,
        }))
    : [];

  if (block.type === 'table') {
    return renderMarkdownTable(block, activeSpans);
  }

  if (block.type === 'heading') {
    const prefixMatch = block.raw.match(/^(#{1,6}\s+)/);
    const prefixLen = prefixMatch ? prefixMatch[1].length : 0;
    return renderRichSliceWithSpans(block.raw.slice(prefixLen), prefixLen, activeSpans);
  }

  if (block.type === 'list') {
    const lines = block.raw.split('\n');
    const isOrdered = /^\s*\d+\.\s+/.test(lines[0] || '');
    const tag = isOrdered ? 'ol' : 'ul';
    const itemsHtml = [];
    let lineOffset = 0;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const taskMatch = line.match(/^(\s*(?:[-*+]|\d+\.)\s+\[([ xX])\]\s+)(.*)$/);
      const stdMatch = !taskMatch ? line.match(/^(\s*(?:[-*+]|\d+\.)\s+)(.*)$/) : null;

      if (taskMatch) {
        const markerLen = taskMatch[1].length;
        const checked = taskMatch[2].toLowerCase() === 'x';
        const body = taskMatch[3];
        const indentPx = Math.floor(((line.match(/^\s*/) || [''])[0].length) / 2) * 16;
        itemsHtml.push(
          `<li class="md-list-item md-task-item" style="${indentPx ? `margin-left:${indentPx - 18}px;` : ''}"><input type="checkbox" class="md-task-checkbox" data-line-idx="${lineIdx}" ${
            checked ? 'checked' : ''
          } /><span>${renderRichSliceWithSpans(body, lineOffset + markerLen, activeSpans)}</span></li>`
        );
      } else if (stdMatch) {
        const markerLen = stdMatch[1].length;
        const body = stdMatch[2];
        const indentPx = Math.floor(((line.match(/^\s*/) || [''])[0].length) / 2) * 16;
        itemsHtml.push(
          `<li class="md-list-item" style="${indentPx ? `margin-left:${indentPx}px;` : ''}">${renderRichSliceWithSpans(
            body,
            lineOffset + markerLen,
            activeSpans
          )}</li>`
        );
      } else if (line.trim()) {
        const leadSpaces = (line.match(/^\s*/) || [''])[0].length;
        const body = line.slice(leadSpaces);
        const renderedBody = renderRichSliceWithSpans(body, lineOffset + leadSpaces, activeSpans);
        if (renderedBody.trim()) {
          if (itemsHtml.length > 0) {
            itemsHtml[itemsHtml.length - 1] = itemsHtml[itemsHtml.length - 1].replace(
              /<\/li>$/,
              ` ${renderedBody}</li>`
            );
          } else {
            itemsHtml.push(`<li class="md-list-item">${renderedBody}</li>`);
          }
        }
      }
      lineOffset += line.length + 1;
    }

    return `<${tag} class="md-list">${itemsHtml.join('')}</${tag}>`;
  }

  if (block.type === 'blockquote') {
    const lines = block.raw.split('\n');
    const firstStrip = (lines[0] || '').replace(/^\s*>\s?/, '');
    const alertHeaderMatch = firstStrip.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i);

    if (alertHeaderMatch) {
      const kind = alertHeaderMatch[1].toUpperCase();
      const firstRest = alertHeaderMatch[2];
      const bodyParts = [];
      let lineOffset = 0;

      for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];
        const m = line.match(/^(\s*>\s?)(.*)$/);
        const prefixLen = m ? m[1].length : 0;
        const body = m ? m[2] : line;
        if (idx === 0) {
          if (firstRest.trim()) {
            const restOffset = lineOffset + prefixLen + (body.length - firstRest.length);
            bodyParts.push(renderRichSliceWithSpans(firstRest, restOffset, activeSpans));
          }
        } else if (body.trim()) {
          bodyParts.push(renderRichSliceWithSpans(body, lineOffset + prefixLen, activeSpans));
        }
        lineOffset += line.length + 1;
      }

      return `
        <div class="md-alert md-alert-${kind.toLowerCase()}">
          <div class="md-alert-head">${escapeHtml(kind)}</div>
          <div>${bodyParts.join('<br />')}</div>
        </div>
      `;
    }

    const renderedLines = [];
    let lineOffset = 0;
    for (const line of lines) {
      const m = line.match(/^(\s*>\s?)(.*)$/);
      const prefixLen = m ? m[1].length : 0;
      const body = m ? m[2] : line;
      renderedLines.push(renderRichSliceWithSpans(body, lineOffset + prefixLen, activeSpans));
      lineOffset += line.length + 1;
    }
    return renderedLines.join('<br />');
  }

  const lines = block.raw.split('\n');
  if (lines.length === 1) {
    return renderRichSliceWithSpans(block.raw, 0, activeSpans);
  }
  const parts = [];
  let lineOffset = 0;
  for (const line of lines) {
    parts.push(renderRichSliceWithSpans(line, lineOffset, activeSpans));
    lineOffset += line.length + 1;
  }
  return parts.join(' ');
}

export function autoResizeBlockTextarea(textareaEl) {
  if (!textareaEl) return;
  textareaEl.style.height = 'auto';
  textareaEl.style.height = `${Math.max(44, textareaEl.scrollHeight)}px`;
}
