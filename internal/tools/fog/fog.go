package fog

import (
	"math"
	"regexp"
	"strings"
)

const (
	FogCategoryUnreadable   = "Unreadable: Likely incomprehensible to most readers."
	FogCategoryHardToRead   = "Hard to Read: Requires significant effort, even for experts."
	FogCategoryProfessional = "Professional Audiences: Best for readers with specialized knowledge."
	FogCategoryGeneral      = "General Audiences: Clear and accessible for most readers."
	FogCategorySimplistic   = "Simplistic: May be perceived as childish or overly simple."
)

// CountWords counts the number of words and complex words in a given text.
// It removes punctuation and then counts words based on spaces.
func CountWords(text string) (int, int) {
	// remove punctuation
	cleanText := regexp.MustCompile(`[[:punct:]]`).ReplaceAllString(text, "")
	words := strings.Fields(cleanText)

	complexWordCount := 0
	for _, word := range words {
		if IsComplexWord(word) {
			complexWordCount++
		}
	}

	return len(words), complexWordCount
}

// CountSentences counts the number of sentences in a given text.
// It counts sentences by looking for sentence-ending punctuation (. ! ?).
func CountSentences(text string) int {
	// This regex counts sentences by looking for sentence-ending punctuation.
	// It's a simple approach and might not be perfect for all cases.
	re := regexp.MustCompile(`[.!?]+`)
	sentences := re.FindAllString(text, -1)
	return len(sentences)
}

// IsComplexWord determines if a word is "complex" by checking if it has three or more syllables.
// This implementation does not exclude proper nouns, familiar jargon, or compound words.
func IsComplexWord(word string) bool {
	return countSyllables(word) >= 3
}

// CalculateFogIndex calculates the Gunning Fog Index for a given text, rounded to two decimal places.
func CalculateFogIndex(text string) float64 {
	totalWords, complexWords := CountWords(text)
	totalSentences := CountSentences(text)

	if totalWords == 0 || totalSentences == 0 {
		return 0.0
	}

	averageSentenceLength := float64(totalWords) / float64(totalSentences)
	percentageComplexWords := 100 * (float64(complexWords) / float64(totalWords))

	index := 0.4 * (averageSentenceLength + percentageComplexWords)
	return math.Round(index*100) / 100
}

// ClassifyFogIndex classifies the Gunning Fog Index into a readability category.
func ClassifyFogIndex(index float64) string {
	switch {
	case index >= 22:
		return FogCategoryUnreadable
	case index >= 18:
		return FogCategoryHardToRead
	case index >= 13:
		return FogCategoryProfessional
	case index >= 9:
		return FogCategoryGeneral
	default:
		return FogCategorySimplistic
	}
}
