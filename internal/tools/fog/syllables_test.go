package fog

import (
	"testing"
)

func TestCountSyllables(t *testing.T) {
	testCases := []struct {
		word     string
		expected int
	}{
		{"complex", 2},
		{"sentence", 3},
		{"difficult", 3},
		{"dog", 1},
		{"cat", 1},
		{"created", 2},
		{"beautiful", 3},
		{"requires", 3},
		{"understanding", 4},
	}

	for _, tc := range testCases {
		t.Run(tc.word, func(t *testing.T) {
			if got := countSyllables(tc.word); got != tc.expected {
				t.Errorf("for word '%s', expected %d syllables but got %d", tc.word, tc.expected, got)
			}
		})
	}
}
