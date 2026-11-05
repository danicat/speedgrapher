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

package fog

import (
	"strings"
)

func isVowel(b byte) bool {
	switch b {
	case 'a', 'e', 'i', 'o', 'u', 'y':
		return true
	default:
		return false
	}
}

// countSyllables estimates the number of syllables in a word using a zero-allocation
// byte scanner with English phonology rules for silent 'e' and common inflectional endings.
func countSyllables(word string) int {
	if len(word) == 0 {
		return 0
	}
	word = strings.ToLower(word)

	count := 0
	inVowel := false
	for i := 0; i < len(word); i++ {
		if isVowel(word[i]) {
			if !inVowel {
				count++
				inVowel = true
			}
		} else {
			inVowel = false
		}
	}

	if count == 0 {
		return 1
	}

	// Suffix rules for silent 'e'
	n := len(word)
	if strings.HasSuffix(word, "e") {
		// Silent terminal -e deduction (e.g. sentence, make, require, describe)
		// Exception: -le preceded by a consonant (e.g. table, little, bottle, cycle) forms a syllable
		if n > 2 && word[n-2] == 'l' && !isVowel(word[n-3]) {
			// keep syllable
		} else if n > 1 && !strings.HasSuffix(word, "ee") && !strings.HasSuffix(word, "oe") {
			count--
		}
	} else if strings.HasSuffix(word, "es") {
		// -es suffix: pronounced as a distinct syllable only after sibilants (s, z, x, ch, sh)
		// Otherwise -es represents a silent 'e' + 's' (e.g. requires, makes, writes)
		if n > 2 {
			pre := word[:n-2]
			if !strings.HasSuffix(pre, "s") &&
				!strings.HasSuffix(pre, "z") &&
				!strings.HasSuffix(pre, "x") &&
				!strings.HasSuffix(pre, "ch") &&
				!strings.HasSuffix(pre, "sh") &&
				!strings.HasSuffix(pre, "c") &&
				!strings.HasSuffix(pre, "g") {
				count--
			}
		}
	} else if strings.HasSuffix(word, "ed") {
		// -ed suffix: pronounced as a distinct syllable only when preceded by 'd' or 't' (e.g. created, needed)
		// Otherwise silent (e.g. looked, described, walked, stopped)
		if n > 2 {
			preChar := word[n-3]
			if preChar != 'd' && preChar != 't' {
				count--
			}
		}
	}

	if count <= 0 {
		return 1
	}
	return count
}
