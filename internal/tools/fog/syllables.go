package fog

import (
	"regexp"
	"strings"
)

// countSyllables estimates the number of syllables in a word by counting vowel groups.
// This is a simplified heuristic.
func countSyllables(word string) int {
	word = strings.ToLower(word)

	vowelGroups := regexp.MustCompile("[aeiouy]+").FindAllString(word, -1)
	syllableCount := len(vowelGroups)

	if syllableCount == 0 {
		return 1
	}

	return syllableCount
}
