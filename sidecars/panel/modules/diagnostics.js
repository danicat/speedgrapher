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

import { findBlockForLine, isSpanSliceValidForBlock, splitIntoSentences } from './markdown.js';
import { state } from './state.js';

export const EDITORIAL_RULE_EXPLANATIONS = {
  'write-good.E-Prime':
    "E-Prime flags 'to be' verbs (is, are, was, were, be, been) because they can mask passive voice or weak linking clauses. If 'is/are' states a direct fact or definition, keep it as-is or click 'Mute write-good.E-Prime' to silence this rule.",
  'write-good.Passive':
    'Passive voice hides who or what performs the action. Prefer naming the concrete actor (you, the client, the server) and using an active verb.',
  'write-good.Weasel':
    'Weasel words ("various", "many", "extremely", "vast") sound emphatic but carry no measurable fact. Replace with a specific metric or delete the modifier.',
  'write-good.TooWordy':
    'Wordy phrases add reading friction without adding meaning. Replace with the shorter plain-English equivalent.',
  'write-good.So':
    'Starting a sentence with "So" as a conversational conjunction weakens technical prose. State the consequence directly or use "Therefore".',
  'write-good.ThereIs':
    'Starting a clause with "There is" or "There are" delays the real subject. Lead with the concrete noun and an active verb instead.',
  'write-good.Cliches':
    'Overused idioms and clichés reduce clarity for international and technical readers. Describe the literal mechanism directly.',
  'write-good.Illusions':
    'Adjacent repeated words ("the the", "is is") are usually accidental typos.',
  'Google.Contractions':
    "The Google Developer Documentation Style Guide recommends everyday contractions ('isn't', 'don't', 'can't', 'won't') so technical guides read naturally and conversationally.",
  'Google.Semicolons':
    'Semicolons join independent clauses into longer compound sentences. Split into two separate sentences or use a conjunction to lower cognitive load.',
  'Google.We':
    "First-person plural ('we', 'our', 'let's') can be ambiguous in documentation (does 'we' mean the author, the product team, or the reader?). Address the reader as 'you' or make the system the subject — or mute Google.We for personal blog posts.",
  'Google.Parens':
    'Parenthetical asides interrupt sentence flow. If the detail is important, work it into the sentence; if it is tangential, cut it.',
  'Google.Passive':
    'Google style favors active voice where the actor performs the verb, making operational responsibility clear.',
  'Google.WordList':
    "Google's developer word list flags jargon, non-inclusive terms, or inconsistent compound spellings in favor of plain, standardized terminology.",
  'Google.Headings':
    'Google style uses sentence case for headings (capitalize only the first word and proper nouns/acronyms) for faster scanning.',
  'Google.Exclamation':
    'Exclamation marks can sound promotional or alarmist in technical writing. Let concrete results and metrics carry the emphasis.',
  'Google.Future':
    'Present tense ("the API returns") is clearer and more direct than future tense ("the API will return") when describing deterministic system behavior.',
  'Google.Will':
    'Avoid "will" when describing how software currently works. Present tense ("returns", "writes", "validates") is shorter and more authoritative.',
  'Google.Latin':
    'Latin abbreviations ("e.g.", "i.e.", "etc.", "via") can confuse non-native English readers and screen readers. Use "for example", "that is", or "through".',
  'Google.Acronyms':
    'Spell out unfamiliar acronyms on first use so readers outside your immediate domain can follow along, or add project acronyms to Vocab.',
  'Google.Spelling':
    'Unrecognized word or technical identifier. Wrap code identifiers in backticks (`code`) or add valid project terms to your Vocabulary.',
  'Vale.Spelling':
    'Unrecognized word or technical identifier. Wrap code identifiers in backticks (`code`) or add valid project terms to your Vocabulary.',
  'Vale.Terms':
    'Preferred terminology casing or spelling mismatch according to the active vocabulary rules.',
  'Vale.Repetition':
    'Adjacent repeated word detected. Remove the duplicate token.',
  'proselint.Very':
    'Intensifiers like "very" and "really" weaken the adjective they modify. Choose a precise word or back the claim with a metric.',
  'proselint.Hyperbole':
    'Hyperbolic claims erode engineering credibility. State verifiable facts and trade-offs.',
  'proselint.Hedging':
    'Hedging phrases ("I think", "it seems", "arguably") weaken technical authority. State the conclusion directly or specify the exact condition.',
  'proselint.CorporateSpeak':
    'Corporate buzzwords obscure who does what. Replace with plain, concrete verbs and nouns.',
  'proselint.Jargon':
    'Status-signaling jargon increases cognitive friction without adding technical precision.',
  'proselint.Typography.Symbols':
    'Typographic symbol alert: use standard typography or ASCII equivalents consistently.',
  'Slop.Lexical':
    'High-frequency synthetic AI vocabulary and corporate status-signaling jargon ("delve", "leverage", "utilize", "paradigm", "seamless", "robust") erode engineering credibility. Replace with plain, concrete verbs and nouns (HBR Jargon Framework).',
  'Slop.Structural':
    'Formulaic AI sentence frames ("Not only X, but also Y", "It is worth noting that", "In today\'s fast-paced...") signal synthetic generation. State the technical point directly.',
  'Slop.Filler':
    'Throat-clearing transition phrases ("In order to", "It is important to remember that", "Essentially") pad word count before the real point begins. Delete the preamble.',
  'Slop.Passive':
    'Clustered passive constructions sap momentum and obscure system causality. Convert to active subject-verb-object sentences.',
  'Slop.Rhythm':
    'Uniform sentence lengths create a robotic, monotonous cadence. Mix short, punchy declarative sentences with longer technical explanations.',
  'Fog.LongSentence':
    'Sentences over 30 words force readers to hold too many clauses in working memory, spiking the Gunning Fog index (> 15). Split into two sentences at the conjunction or relative clause.',
  'Fog.Polysyllabic':
    'Dense stacks of 3+ syllable words and nominalizations ("implementation", "orchestration", "utilization") drive up reading grade level. Replace noun stacks with active verbs.',
  'HBR.Acronym':
    'Undefined acronyms force readers outside your immediate sub-specialty to guess or bounce (HBR Jargon Study). Spell out the full term on first use followed by the acronym in parentheses.',
};

export function toSentenceCaseHeading(rawHeading) {
  const m = String(rawHeading || '').match(/^(#{1,6}\s+)(.+)$/);
  if (!m) return rawHeading;
  const prefix = m[1];
  const words = m[2].split(/(\s+)/);
  const ACRONYMS = new Set([
    'API', 'SDK', 'CLI', 'MCP', 'SEO', 'GEO', 'HTML', 'CSS', 'JSON', 'YAML', 'TOML', 'URL', 'UI', 'AI', 'LLM',
    'WASM', 'CPU', 'GPU', 'RAM', 'SQL', 'HTTP', 'REST', 'GDD', 'AST', 'IDE', 'OSS', 'GFM', 'Go', 'Google',
    'Antigravity', 'Speedgrapher', 'Hugo', 'Vale', 'Ebitengine', 'Markdown', 'Vertex', 'Gemini',
  ]);
  let firstWordSeen = false;
  const converted = words
    .map((tok) => {
      if (/^\s+$/.test(tok)) return tok;
      if (tok.startsWith('`') && tok.endsWith('`')) return tok;
      const clean = tok.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
      if (ACRONYMS.has(clean)) return tok;
      if (!firstWordSeen) {
        firstWordSeen = true;
        return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
      }
      return tok.toLowerCase();
    })
    .join('');
  return `${prefix}${converted}`;
}

export function lookupInstantReplacement(matchText, ruleName = '', suggestion = '', blockRaw = '', action = null) {
  if (ruleName === 'Google.Headings' && blockRaw.startsWith('#')) {
    const fixed = toSentenceCaseHeading(blockRaw);
    if (fixed !== blockRaw) {
      return { target: blockRaw, replacement: fixed, isWholeBlock: true };
    }
  }
  if (ruleName === 'Google.EmDash' && String(matchText || '').includes('—')) {
    return { target: matchText, replacement: '—', isWholeBlock: false };
  }

  const actionName = action?.Name || '';
  const actionParams = action?.Params || null;
  if (
    actionName === 'replace' &&
    Array.isArray(actionParams) &&
    typeof actionParams[0] === 'string' &&
    actionParams[0].length > 0
  ) {
    const rep = actionParams[0];
    const isCap = matchText && matchText.charAt(0) >= 'A' && matchText.charAt(0) <= 'Z';
    const casedRep = isCap && rep.length > 0 ? rep.charAt(0).toUpperCase() + rep.slice(1) : rep;
    return { target: matchText, replacement: casedRep, isWholeBlock: false };
  }

  const quoted = String(suggestion || '').match(
    /(?:use|try(?:\s+using)?|prefer|replace\s+with)\s+(?:"([^"]+)"|'(.+?)'(?=\s+instead\b|[.,;!?)]|\s|$))/i
  );
  const rawRep = quoted ? (quoted[1] ?? quoted[2] ?? '') : '';
  if (rawRep) {
    const isCap = matchText && matchText.charAt(0) >= 'A' && matchText.charAt(0) <= 'Z';
    const casedRep = isCap && rawRep.length > 0 ? rawRep.charAt(0).toUpperCase() + rawRep.slice(1) : rawRep;
    return { target: matchText, replacement: casedRep, isWholeBlock: false };
  }

  return null;
}

export function getEditorialRuleExplanation(pillar, ruleId, category = '') {
  const cleanId = String(ruleId || category || '').trim();
  if (EDITORIAL_RULE_EXPLANATIONS[cleanId]) {
    return EDITORIAL_RULE_EXPLANATIONS[cleanId];
  }

  const loadedRule = Array.isArray(state.valeRulesData?.rules)
    ? state.valeRulesData.rules.find((r) => r.id === cleanId)
    : null;
  if (loadedRule?.description && loadedRule.description !== cleanId) {
    return loadedRule.description;
  }

  for (const [key, text] of Object.entries(EDITORIAL_RULE_EXPLANATIONS)) {
    if (cleanId && cleanId.toLowerCase().includes(key.toLowerCase())) {
      return text;
    }
  }

  if (pillar === 'slop') {
    const cat = String(category || cleanId).toLowerCase();
    if (cat.includes('lexical')) {
      return 'High-frequency LLM vocabulary ("delve", "tapestry", "leverage", "utilize", "robust", "seamless") signals synthetic prose. Replace with a plain, concrete verb or noun.';
    }
    if (cat.includes('structural')) {
      return 'Formulaic rhetorical framing ("It\'s not X — it\'s Y", "Here\'s the kicker", dramatic countdowns) is a strong AI-writing tell. State the technical point directly.';
    }
    if (cat.includes('filler')) {
      return 'Throat-clearing transitions ("It is worth noting that", "In order to") pad word count before the real point begins. Cut the preamble.';
    }
    if (cat.includes('passive')) {
      return 'Passive construction obscures which component or actor performs the operation. Name the subject and use an active verb.';
    }
    return 'Synthetic phrasing pattern detected by the 5-dimension Slop analyzer. Rewrite with direct, concrete engineering prose.';
  }

  if (pillar === 'fog') {
    if (category === 'long_sentence' || cleanId === 'Long Sentence' || cleanId === 'Fog.LongSentence') {
      return 'Sentences over 30 words push the Gunning Fog index above 15, forcing readers to hold multiple clauses in working memory. Split at a conjunction or turn a subordinate clause into its own sentence.';
    }
    return 'Polysyllabic words (3+ syllables) and nominalizations ("implementation", "orchestration", "utilization") increase Gunning Fog score. Prefer shorter active verbs where possible.';
  }

  if (cleanId.startsWith('Google.')) {
    return "Google Developer Documentation Style Guide rule favoring clear, direct, second-person technical prose. You can mute this rule if it does not fit your article's voice.";
  }
  if (cleanId.startsWith('write-good.')) {
    return 'Write-Good readability lint rule targeting passive voice, wordiness, or weak verbs. Mute this rule if the phrasing is intentional.';
  }
  if (cleanId.startsWith('proselint.')) {
    return 'Proselint editorial rule flagging redundancy, hedging, or cliché phrasing.';
  }
  return 'Static style and grammar check from Vale (Google Developer Style Guide, write-good, and proselint).';
}

export function isVocabEligibleRule(spanOrRule) {
  if (!spanOrRule) return false;
  if (typeof spanOrRule === 'string') {
    const r = spanOrRule.toLowerCase();
    return (
      r.includes('spelling') ||
      r.includes('wordlist') ||
      r.includes('vocab') ||
      r.includes('acronyms') ||
      r.includes('casing') ||
      r.includes('jargon') ||
      r.includes('vale') ||
      r.includes('google') ||
      r.includes('write-good') ||
      r.includes('proselint')
    );
  }
  if (!spanOrRule.match && !spanOrRule.matchedText) return false;
  const r = String(spanOrRule.ruleId || spanOrRule.rule || '').toLowerCase();
  return (
    r.includes('spelling') ||
    r.includes('wordlist') ||
    r.includes('vocab') ||
    r.includes('acronyms') ||
    r.includes('casing') ||
    r.includes('jargon') ||
    spanOrRule.pillar === 'vale' ||
    spanOrRule.category === 'vale'
  );
}

export function isOffsetInsideCodeOrUrl(raw, start, end) {
  const codeRe = /(`+[^`\n]+`+)/g;
  let m;
  while ((m = codeRe.exec(raw)) !== null) {
    const cStart = m.index;
    const cEnd = cStart + m[0].length;
    if (start < cEnd && end > cStart) return true;
  }
  const linkRe = /!?\[[^\]]*\]\(([^)\n]+)\)/g;
  while ((m = linkRe.exec(raw)) !== null) {
    const fullMatch = m[0];
    const parenIdx = fullMatch.indexOf('](');
    if (parenIdx >= 0) {
      const urlStart = m.index + parenIdx + 2;
      const urlEnd = m.index + fullMatch.length;
      if (start < urlEnd && end > urlStart) return true;
    }
  }
  return false;
}

export function locateAlertSpanInBlock(blockOrRaw, lineOrOffset, alertOrMatch, maybeSpanCols) {
  let raw = '';
  let relLine = -1;
  let matchStr = '';
  let spanCols = null;

  if (blockOrRaw && typeof blockOrRaw === 'object') {
    raw = String(blockOrRaw.raw ?? blockOrRaw.rawText ?? '');
    const lines = raw.split('\n');
    const startLine = typeof blockOrRaw.startLine === 'number' ? blockOrRaw.startLine : 1;
    const endLine =
      typeof blockOrRaw.endLine === 'number' ? blockOrRaw.endLine : startLine + lines.length - 1;
    if (typeof lineOrOffset === 'number' && lineOrOffset >= startLine && lineOrOffset <= endLine) {
      relLine = lineOrOffset - startLine;
    }
  } else if (typeof blockOrRaw === 'string') {
    raw = blockOrRaw;
    const lines = raw.split('\n');
    if (typeof lineOrOffset === 'number' && lineOrOffset >= 0 && lineOrOffset < lines.length) {
      relLine = lineOrOffset;
    }
  } else {
    return null;
  }

  if (alertOrMatch && typeof alertOrMatch === 'object' && !Array.isArray(alertOrMatch)) {
    matchStr = String(alertOrMatch.Match ?? alertOrMatch.match ?? '');
    spanCols = alertOrMatch.Span ?? alertOrMatch.span ?? maybeSpanCols ?? null;
  } else {
    matchStr = typeof alertOrMatch === 'string' ? alertOrMatch : '';
    spanCols = Array.isArray(maybeSpanCols) ? maybeSpanCols : null;
  }

  if (!raw) return null;

  const lines = raw.split('\n');
  const lineOffsets = [];
  let acc = 0;
  for (const l of lines) {
    lineOffsets.push(acc);
    acc += l.length + 1;
  }

  if (relLine >= 0 && relLine < lines.length && Array.isArray(spanCols) && spanCols.length === 2) {
    const lineText = lines[relLine] || '';
    const lineStart = lineOffsets[relLine];
    const colStart = Math.max(0, Number(spanCols[0]) - 1);
    const colEnd = Math.min(lineText.length, Number(spanCols[1]));
    if (colEnd > colStart) {
      const candidate = lineText.slice(colStart, colEnd);
      const prevChar = colStart > 0 ? lineText[colStart - 1] : '';
      const nextChar = colEnd < lineText.length ? lineText[colEnd] : '';
      const leftOk = !/^[a-zA-Z0-9_]/.test(candidate) || !/[a-zA-Z0-9_]/.test(prevChar);
      const rightOk = !/[a-zA-Z0-9_]$/.test(candidate) || !/[a-zA-Z0-9_]/.test(nextChar);
      if (leftOk && rightOk && (!matchStr || candidate.toLowerCase() === matchStr.toLowerCase())) {
        const absStart = lineStart + colStart;
        const absEnd = lineStart + colEnd;
        if (!isOffsetInsideCodeOrUrl(raw, absStart, absEnd)) {
          return {
            start: absStart,
            end: absEnd,
            startOffset: absStart,
            endOffset: absEnd,
            match: candidate,
            exactSub: candidate,
          };
        }
      }
    }
  }

  const cleanMatch = String(matchStr || '').includes('—') ? String(matchStr) : String(matchStr || '').trim();
  if (!cleanMatch) return null;

  const escaped = cleanMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const leftBound = /^[a-zA-Z0-9_]/.test(cleanMatch) ? '(?<![a-zA-Z0-9_])' : '';
  const rightBound = /[a-zA-Z0-9_]$/.test(cleanMatch) ? '(?![a-zA-Z0-9_])' : '';
  const re = new RegExp(`${leftBound}${escaped}${rightBound}`, 'gi');

  if (relLine >= 0 && relLine < lines.length) {
    const lineText = lines[relLine] || '';
    const lineStart = lineOffsets[relLine];
    let m;
    while ((m = re.exec(lineText)) !== null) {
      const absStart = lineStart + m.index;
      const absEnd = absStart + m[0].length;
      if (!isOffsetInsideCodeOrUrl(raw, absStart, absEnd)) {
        return {
          start: absStart,
          end: absEnd,
          startOffset: absStart,
          endOffset: absEnd,
          match: m[0],
          exactSub: m[0],
        };
      }
    }
  }

  re.lastIndex = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const absStart = m.index;
    const absEnd = absStart + m[0].length;
    if (!isOffsetInsideCodeOrUrl(raw, absStart, absEnd)) {
      return {
        start: absStart,
        end: absEnd,
        startOffset: absStart,
        endOffset: absEnd,
        match: m[0],
        exactSub: m[0],
      };
    }
  }

  return null;
}

export function countSyllablesInWord(word) {
  let w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  w = w.replace(/^y/, '');
  const vowelGroups = w.match(/[aeiouy]{1,2}/g);
  return vowelGroups ? Math.max(1, vowelGroups.length) : 1;
}

function isLensActive(pillar, allLenses = false) {
  if (allLenses) return true;
  if (state.lenses && typeof state.lenses === 'object' && pillar in state.lenses) {
    return Boolean(state.lenses[pillar]);
  }
  if (state.activeLenses instanceof Set) {
    return state.activeLenses.has(pillar);
  }
  return true;
}

function isLineInBlock(lineNum, block) {
  if (typeof lineNum !== 'number') return true;
  const start = typeof block.startLine === 'number' ? block.startLine : 1;
  const raw = String(block.raw ?? block.rawText ?? '');
  const end = typeof block.endLine === 'number' ? block.endLine : start + raw.split('\n').length - 1;
  return lineNum >= start && lineNum <= end;
}

export function computeInlineSpansForBlock(block, options = {}) {
  if (
    !block ||
    block.type === 'frontmatter' ||
    block.type === 'code' ||
    block.type === 'hr' ||
    block.type === 'math'
  ) {
    return [];
  }

  const allLenses = Boolean(options?.allLenses);
  const raw = String(block.raw ?? block.rawText ?? '');
  if (!raw.trim()) return [];

  if (Array.isArray(state.spans) && state.spans.length > 0 && block.id) {
    const existing = state.spans.filter(
      (s) => s.blockId === block.id && isLensActive(s.pillar || s.category, allLenses)
    );
    if (existing.length > 0) {
      return existing.map((s) => ({
        ...s,
        pillar: s.pillar || s.category,
        category: s.category || s.pillar,
        start: typeof s.start === 'number' ? s.start : s.startOffset,
        end: typeof s.end === 'number' ? s.end : s.endOffset,
        startOffset: typeof s.startOffset === 'number' ? s.startOffset : s.start,
        endOffset: typeof s.endOffset === 'number' ? s.endOffset : s.end,
      }));
    }
  }

  const spans = [];
  let seq = 1;
  const normBlock = {
    ...block,
    raw,
    startLine: typeof block.startLine === 'number' ? block.startLine : 1,
    endLine:
      typeof block.endLine === 'number'
        ? block.endLine
        : (typeof block.startLine === 'number' ? block.startLine : 1) + raw.split('\n').length - 1,
  };

  if (isLensActive('vale', allLenses)) {
    const valeList = Array.isArray(state.diagnostics?.vale) ? state.diagnostics.vale : [];
    for (const alert of valeList) {
      const lineNum = alert.Line ?? alert.line;
      if (typeof lineNum === 'number' && !isLineInBlock(lineNum, normBlock)) continue;
      const checkName = alert.Check || alert.check || alert.rule || 'Vale';
      const rawMatch = String(alert.Match ?? alert.match ?? '');
      const matchStr = checkName === 'Google.EmDash' ? rawMatch : rawMatch.trim();
      const spanCols = alert.Span || alert.span || null;
      let located = locateAlertSpanInBlock(normBlock, lineNum, matchStr, spanCols);
      if (!located && checkName === 'Google.Headings' && normBlock.type === 'heading') {
        located = {
          start: 0,
          end: raw.length,
          startOffset: 0,
          endOffset: raw.length,
          match: raw,
          exactSub: raw,
        };
      }
      if (!located) continue;
      const message = alert.Message || alert.message || checkName;
      const fix = lookupInstantReplacement(
        located.exactSub,
        checkName,
        message,
        raw,
        alert.Action || alert.action || null
      );
      spans.push({
        id: `sp-${seq++}`,
        blockId: normBlock.id,
        line: lineNum || normBlock.startLine,
        pillar: 'vale',
        category: 'vale',
        severity: String(alert.Severity || alert.severity || 'warning').toLowerCase() === 'error' ? 'error' : 'warn',
        start: located.startOffset,
        end: located.endOffset,
        startOffset: located.startOffset,
        endOffset: located.endOffset,
        match: located.exactSub,
        matchedText: located.exactSub,
        rule: checkName,
        ruleId: checkName,
        message,
        explanation: getEditorialRuleExplanation('vale', checkName),
        replacement: fix ? fix.replacement : (alert.replacement ?? null),
        isWholeBlockReplacement: Boolean(fix?.isWholeBlock),
        isSentenceSpan: Boolean(fix?.isWholeBlock),
      });
    }
  }

  if (isLensActive('slop', allLenses)) {
    const slopList = Array.isArray(state.diagnostics?.slop)
      ? state.diagnostics.slop
      : Array.isArray(state.audit?.slop?.findings)
      ? state.audit.slop.findings
      : [];
    for (const f of slopList) {
      const lineNum = f.Line ?? f.line;
      if (typeof lineNum === 'number' && !isLineInBlock(lineNum, normBlock)) continue;
      const matchStr = String(f.Match ?? f.match ?? '').trim();
      if (!matchStr) continue;
      const spanCols = f.Span || f.span || null;
      const located = locateAlertSpanInBlock(normBlock, lineNum, matchStr, spanCols);
      if (!located) continue;
      const ruleName = f.Category || f.category || f.rule || 'Slop';
      const rawSug = f.Suggestion ?? f.suggestion ?? f.replacement;
      let replacement = null;
      if (typeof rawSug === 'string') {
        const isCap = located.exactSub.charAt(0) >= 'A' && located.exactSub.charAt(0) <= 'Z';
        replacement =
          isCap && rawSug.length > 0 ? rawSug.charAt(0).toUpperCase() + rawSug.slice(1) : rawSug;
      }
      spans.push({
        id: `sp-${seq++}`,
        blockId: normBlock.id,
        line: lineNum || normBlock.startLine,
        pillar: 'slop',
        category: 'slop',
        severity: 'warn',
        start: located.startOffset,
        end: located.endOffset,
        startOffset: located.startOffset,
        endOffset: located.endOffset,
        match: located.exactSub,
        matchedText: located.exactSub,
        rule: ruleName,
        ruleId: ruleName,
        message: f.Message || f.message || `AI trope detected ("${located.exactSub}")`,
        explanation: getEditorialRuleExplanation('slop', ruleName, ruleName),
        replacement,
        isWholeBlockReplacement: false,
        isSentenceSpan: false,
      });
    }
  }

  if (isLensActive('fog', allLenses)) {
    const fogList = Array.isArray(state.diagnostics?.fog)
      ? state.diagnostics.fog
      : Array.isArray(state.audit?.fog?.findings)
      ? state.audit.fog.findings
      : [];
    for (const f of fogList) {
      const lineNum = f.Line ?? f.line;
      if (typeof lineNum === 'number' && !isLineInBlock(lineNum, normBlock)) continue;
      const matchStr = String(f.Match ?? f.match ?? '').trim();
      if (!matchStr) continue;
      const spanCols = f.Span || f.span || null;
      const located = locateAlertSpanInBlock(normBlock, lineNum, matchStr, spanCols);
      if (!located) continue;
      const cat = String(f.Category || f.category || 'complex_word').toLowerCase();
      const isSentence = cat === 'long_sentence';
      const ruleLabel = isSentence ? 'Long Sentence' : 'Complex Word';
      spans.push({
        id: `sp-${seq++}`,
        blockId: normBlock.id,
        line: lineNum || normBlock.startLine,
        pillar: 'fog',
        category: 'fog',
        severity: 'info',
        start: located.startOffset,
        end: located.endOffset,
        startOffset: located.startOffset,
        endOffset: located.endOffset,
        match: located.exactSub,
        matchedText: located.exactSub,
        rule: ruleLabel,
        ruleId: 'Readability.Fog',
        message: f.Message || f.message || `Readability finding: "${located.exactSub}"`,
        explanation: getEditorialRuleExplanation('fog', ruleLabel, cat),
        replacement: null,
        isWholeBlockReplacement: false,
        isSentenceSpan: isSentence,
      });
    }
  }

  return spans;
}

export function buildAmbientSpansFromAudit(audit) {
  const spans = [];
  if (!audit || state.blocks.length === 0) return spans;
  let spanSeq = 1;

  const slopFindings = Array.isArray(audit.slop?.findings) ? audit.slop.findings : [];
  for (const f of slopFindings) {
    const block = findBlockForLine(f.line);
    if (!block || block.type === 'frontmatter' || block.type === 'code' || block.type === 'math') continue;
    const matchStr = (f.match || '').trim();
    if (!matchStr) continue;
    const located = locateAlertSpanInBlock(block, f.line, matchStr, f.span);
    if (!located || !isSpanSliceValidForBlock(block.raw, located.startOffset, located.endOffset, matchStr)) continue;
    const { startOffset, endOffset, exactSub } = located;
    const ruleName = f.category || 'Slop';
    let replacement = null;
    if (typeof f.suggestion === 'string') {
      const isCap = exactSub.charAt(0) >= 'A' && exactSub.charAt(0) <= 'Z';
      replacement =
        isCap && f.suggestion.length > 0
          ? f.suggestion.charAt(0).toUpperCase() + f.suggestion.slice(1)
          : f.suggestion;
    }
    spans.push({
      id: `sp-${spanSeq++}`,
      blockId: block.id,
      line: f.line || block.startLine,
      pillar: 'slop',
      category: 'slop',
      severity: 'warn',
      start: startOffset,
      end: endOffset,
      startOffset,
      endOffset,
      match: exactSub,
      matchedText: exactSub,
      rule: ruleName,
      ruleId: ruleName,
      message: f.message || `AI trope detected ("${exactSub}")`,
      explanation: getEditorialRuleExplanation('slop', ruleName, f.category),
      replacement,
      isWholeBlockReplacement: false,
      isSentenceSpan: false,
    });
  }

  let valeAlerts = [];
  if (typeof audit.vale?.output === 'string' && audit.vale.output.trim()) {
    const parsed = JSON.parse(audit.vale.output);
    if (Array.isArray(parsed)) {
      valeAlerts = parsed;
    } else if (parsed && typeof parsed === 'object') {
      for (const arr of Object.values(parsed)) {
        if (Array.isArray(arr)) valeAlerts.push(...arr);
      }
    }
  }

  for (const alert of valeAlerts) {
    const lineNum = alert.Line || 1;
    const block = findBlockForLine(lineNum);
    if (!block || block.type === 'frontmatter' || block.type === 'code' || block.type === 'math') continue;
    const checkName = alert.Check || 'Vale';
    const rawMatchStr = String(alert.Match ?? '');
    const matchStr = checkName === 'Google.EmDash' ? rawMatchStr : rawMatchStr.trim();
    const message = alert.Message || checkName;
    const spanCols = alert.Span || null;
    const alertAction = alert.Action || null;

    let located = locateAlertSpanInBlock(block, lineNum, matchStr, spanCols);
    if (!located && checkName === 'Google.Headings' && block.type === 'heading') {
      located = {
        start: 0,
        end: block.raw.length,
        startOffset: 0,
        endOffset: block.raw.length,
        match: block.raw,
        exactSub: block.raw,
      };
    }
    if (!located) continue;

    const { startOffset, endOffset, exactSub } = located;
    const fix = lookupInstantReplacement(exactSub, checkName, message, block.raw, alertAction);
    spans.push({
      id: `sp-${spanSeq++}`,
      blockId: block.id,
      line: lineNum,
      pillar: 'vale',
      category: 'vale',
      severity: (alert.Severity || '').toLowerCase() === 'error' ? 'error' : 'warn',
      start: startOffset,
      end: endOffset,
      startOffset,
      endOffset,
      match: exactSub,
      matchedText: exactSub,
      rule: checkName,
      ruleId: checkName,
      message,
      explanation: getEditorialRuleExplanation('vale', checkName),
      replacement: fix ? fix.replacement : null,
      isWholeBlockReplacement: Boolean(fix?.isWholeBlock),
      isSentenceSpan: Boolean(fix?.isWholeBlock),
    });
  }

  const fogFindings = Array.isArray(audit.fog?.findings) ? audit.fog.findings : [];
  for (const f of fogFindings) {
    if (f.category !== 'long_sentence' && f.category !== 'complex_word') continue;
    const block = findBlockForLine(f.line);
    if (!block || block.type === 'frontmatter' || block.type === 'code' || block.type === 'math') continue;
    const matchStr = (f.match || '').trim();
    if (!matchStr) continue;
    const located = locateAlertSpanInBlock(block, f.line, matchStr, f.span);
    if (!located) continue;
    const { startOffset, endOffset, exactSub } = located;
    const isSentence = f.category === 'long_sentence';
    const ruleLabel = isSentence ? 'Long Sentence' : 'Complex Word';
    spans.push({
      id: `sp-${spanSeq++}`,
      blockId: block.id,
      line: f.line || block.startLine,
      pillar: 'fog',
      category: 'fog',
      severity: 'info',
      start: startOffset,
      end: endOffset,
      startOffset,
      endOffset,
      match: exactSub,
      matchedText: exactSub,
      rule: ruleLabel,
      ruleId: 'Readability.Fog',
      message: f.message || `Readability finding: "${exactSub}"`,
      explanation: getEditorialRuleExplanation('fog', ruleLabel, f.category),
      replacement: null,
      isWholeBlockReplacement: false,
      isSentenceSpan: isSentence,
    });
  }

  return spans;
}

export function computeBlockDiagnostics(block, blockIdx) {
  if (
    !block ||
    block.type === 'frontmatter' ||
    block.type === 'code' ||
    block.type === 'hr' ||
    block.type === 'image' ||
    block.type === 'math'
  ) {
    return null;
  }

  const rawText = String(block.raw ?? block.rawText ?? '');
  const stripped = rawText
    .replace(/`+[^`]*`+/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s*(?:\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])?\s*/gim, '')
    .replace(/^[-*+]\s+(?:\[[ xX]\]\s+)?/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/[*_~|]/g, ' ');

  const words = stripped
    .trim()
    .split(/\s+/)
    .filter((w) => /[a-zA-Z0-9]/.test(w));

  if (words.length === 0) {
    return null;
  }

  const sentenceMatches = stripped.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [stripped];
  let sentenceCount = Math.max(
    1,
    sentenceMatches.filter((s) => /[a-zA-Z0-9]/.test(s)).length
  );
  let wordCount = words.length;
  let complexWords = 0;
  for (const w of words) {
    const clean = w.replace(/[^a-zA-Z-]/g, '');
    if (!clean || clean.includes('-')) continue;
    if (countSyllablesInWord(clean) >= 3) {
      complexWords++;
    }
  }

  const rawFog = 0.4 * (wordCount / sentenceCount + 100 * (complexWords / wordCount));
  let fog = Math.round(rawFog * 10) / 10;

  // Check server block health telemetry (supports object keyed by startLine or array of block records)
  const rawBlockHealth = state.metrics?.blockHealth;
  let serverHealth = null;
  if (rawBlockHealth && typeof rawBlockHealth === 'object' && !Array.isArray(rawBlockHealth)) {
    serverHealth = rawBlockHealth[block.startLine] || null;
  } else {
    const blockHealthList = Array.isArray(state.audit?.blocks)
      ? state.audit.blocks
      : Array.isArray(rawBlockHealth)
      ? rawBlockHealth
      : [];
    serverHealth =
      blockHealthList.find(
        (b) =>
          typeof b?.start_line === 'number' &&
          typeof block.startLine === 'number' &&
          b.start_line <= (block.endLine ?? block.startLine) &&
          b.end_line >= block.startLine
      ) ||
      (typeof blockIdx === 'number' ? blockHealthList[blockIdx] : null) ||
      null;
  }

  const fogParagraphs = Array.isArray(state.audit?.fog?.paragraphs) ? state.audit.fog.paragraphs : [];
  const serverFogPara = fogParagraphs.find(
    (p) =>
      typeof p?.start_line === 'number' &&
      typeof block.startLine === 'number' &&
      p.start_line <= (block.endLine ?? block.startLine) &&
      p.end_line >= block.startLine
  );

  if (typeof serverHealth?.fog === 'number' && !Number.isNaN(serverHealth.fog)) {
    fog = Math.round(serverHealth.fog * 10) / 10;
  } else if (typeof serverHealth?.fog_index === 'number' && !Number.isNaN(serverHealth.fog_index) && serverHealth.fog_index > 0) {
    fog = Math.round(serverHealth.fog_index * 10) / 10;
  } else if (typeof serverFogPara?.fog_index === 'number' && !Number.isNaN(serverFogPara.fog_index) && serverFogPara.fog_index > 0) {
    fog = Math.round(serverFogPara.fog_index * 10) / 10;
  }

  if (typeof serverHealth?.word_count === 'number' && serverHealth.word_count > 0) {
    wordCount = serverHealth.word_count;
  } else if (typeof serverHealth?.words === 'number' && serverHealth.words > 0) {
    wordCount = serverHealth.words;
  } else if (typeof serverFogPara?.total_words === 'number' && serverFogPara.total_words > 0) {
    wordCount = serverFogPara.total_words;
  }

  if (typeof serverFogPara?.total_sentences === 'number' && serverFogPara.total_sentences > 0) {
    sentenceCount = serverFogPara.total_sentences;
  }

  if (typeof serverFogPara?.complex_words === 'number' && serverFogPara.complex_words >= 0) {
    complexWords = serverFogPara.complex_words;
  } else if (typeof serverHealth?.complex_words === 'number' && serverHealth.complex_words >= 0) {
    complexWords = serverHealth.complex_words;
  }

  let blockSpans =
    Array.isArray(state.spans) && block.id
      ? state.spans.filter((s) => s.blockId === block.id)
      : [];
  if (blockSpans.length === 0 && (state.diagnostics || state.audit)) {
    blockSpans = computeInlineSpansForBlock(block, { allLenses: true });
  }

  const valeSpans = blockSpans.filter((s) => (s.pillar || s.category) === 'vale');
  const slopSpans = blockSpans.filter((s) => (s.pillar || s.category) === 'slop');
  const fogSpans = blockSpans.filter((s) => (s.pillar || s.category) === 'fog');

  const valeCount = valeSpans.length;
  const slopCount = slopSpans.length;
  const fogAlertCount = fogSpans.length;
  const fogSpanCount = fogSpans.filter((s) => s.isSentenceSpan !== false).length;

  const valeErrorCount = valeSpans.filter((s) => s.severity === 'error').length;
  const valeWarnCount = valeSpans.filter((s) => s.severity === 'warn' || s.severity === 'warning').length;
  const valeInfoCount = Math.max(0, valeCount - valeErrorCount - valeWarnCount);
  const complexWordSpans = fogSpans.filter((s) => s.isSentenceSpan === false).length;

  const effectiveFog = block.type === 'heading' || wordCount < 8 ? 0 : fog;

  let healthScore = 100;
  healthScore -= slopCount * 10;
  healthScore -= valeErrorCount * 8;
  healthScore -= valeWarnCount * 5;
  healthScore -= valeInfoCount * 3;
  healthScore -= fogSpanCount * 8;
  healthScore -= Math.min(18, complexWordSpans * 2.5);
  if (effectiveFog > 14) {
    healthScore -= (effectiveFog - 14) * 2.2;
  }
  healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));

  const totalIssues = valeCount + slopCount + fogAlertCount;

  let health = 'clean';
  if (totalIssues === 0 && (effectiveFog === 0 || effectiveFog <= 14.5)) {
    health = 'pristine';
  } else if (healthScore >= 88 && effectiveFog <= 15) {
    health = 'clean';
  } else if (healthScore >= 76 && effectiveFog <= 16.5) {
    health = 'mild';
  } else if (healthScore >= 64 && effectiveFog <= 18) {
    health = 'fair';
  } else if (healthScore >= 50 && effectiveFog <= 20) {
    health = 'warn';
  } else if (healthScore >= 36 && effectiveFog <= 22) {
    health = 'high';
  } else {
    health = 'bad';
  }

  let status = 'clean';
  if (health === 'bad' || health === 'high' || valeErrorCount > 0) {
    status = 'error';
  } else if (health === 'warn' || health === 'fair' || totalIssues > 0 || effectiveFog > 15) {
    status = 'warn';
  }

  return {
    fog,
    words: wordCount,
    wordCount,
    sentenceCount,
    complexWords,
    valeCount,
    slopCount,
    jargonCount: slopSpans.filter((s) => String(s.rule || '').toLowerCase().includes('lexical')).length,
    fogAlertCount,
    fogSpanCount,
    totalIssues,
    healthScore,
    health,
    status,
    alerts: blockSpans,
    spans: blockSpans,
  };
}
