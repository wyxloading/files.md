package server

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMergePrefixCases(t *testing.T) {
	r := require.New(t)

	original := "line 1\nline 2"
	modified := "line 1\nline 2\nline 3\nline 4"
	r.Equal(modified, Merge(original, modified))
	r.Equal(modified, Merge(modified, original))
}

func TestMergeCommonPrefixDifferentSuffixes(t *testing.T) {
	r := require.New(t)

	// Both have common prefix but different additional lines
	original := "line 1\nline 2\nline 3\nline original 4"
	modified := "line 1\nline 2\nline 3\nline modified 4"
	merged := Merge(original, modified)
	r.Equal("line 1\nline 2\nline 3\nline original 4\nline modified 4", merged)
}

func TestMergeDifferentPrefixCommonSuffix(t *testing.T) {
	r := require.New(t)

	// Both have different prefixes but common suffix
	original := "line original 1\nline original 2\nline 3"
	modified := "new\nline original 1\nline original 2\nline 3"
	merged := Merge(original, modified)
	r.Equal("new\nline original 1\nline original 2\nline 3", merged, "Should merge lines before common suffix")
}

func TestMergeDivergentBody(t *testing.T) {
	r := require.New(t)

	// Divergent content with common prefix and suffix
	original := "header\nheader\noriginal A\noriginal B\nfooter\nfooter"
	modified := "header\nheader\nmodified X\nmodified Y\nfooter\nfooter"
	merged := Merge(original, modified)
	r.Equal("header\nheader\noriginal A\noriginal B\nmodified X\nmodified Y\nfooter\nfooter", merged)
}

func TestMergeSameHeader(t *testing.T) {
	r := require.New(t)

	result := Merge("#### 23 May, Saturday", "#### 23 May, Saturday")
	r.Equal("#### 23 May, Saturday", result)
}

func TestMergeDivergentContent(t *testing.T) {
	r := require.New(t)

	// Complete divergence with small common prefix
	original := "header\noriginal A\noriginal B"
	modified := "header\nmodified X\nmodified Y"
	merged := Merge(original, modified)
	r.Equal("header\noriginal A\noriginal B\nmodified X\nmodified Y", merged)
}

func TestMergeEmptyStrings(t *testing.T) {
	r := require.New(t)

	r.Equal("", Merge("", ""), "Empty strings should merge to empty string")
	r.Equal("content", Merge("", "content"), "Empty original should return modified")
	r.Equal("content", Merge("content", ""), "Empty modified should return original")
}

func TestMergeTrailingNewlines(t *testing.T) {
	r := require.New(t)

	original := "line 1\nline 2\n"
	modified := "line 1\nline 2\nline 3\n"
	r.Equal(modified, Merge(original, modified), "Should handle trailing newlines correctly")
}

func TestMergeDivergentChars(t *testing.T) {
	r := require.New(t)

	original := "abc"
	modified := "adc"
	merged := Merge(original, modified)
	r.Equal("abc\nadc", merged)
}

func TestJournal(t *testing.T) {
	r := require.New(t)

	server := "1 April\nfelt good\nate good\n2 April\nslept not so good"
	client := "1 April\nfelt good\n2 April\nslept not so good\nwent for hiking"
	merged := Merge(server, client)
	r.Equal("1 April\nfelt good\nate good\n2 April\nslept not so good\nwent for hiking", merged)
}

func TestMergeHeaders(t *testing.T) {
	r := require.New(t)

	headers := []string{"#### 23 May, Friday 🤸‍♂️🍽💪💧", "#### 23 May, Friday 🤸‍♂️🍽💪", "#### 23 May, Friday 🤸‍♂️"}
	merged := mergeEmojisInJournalHeaders(headers)
	r.Equal([]string{"#### 23 May, Friday 🤸‍♂️🍽💪💧"}, merged)
}

func TestMergeHeadersReversed(t *testing.T) {
	r := require.New(t)

	headers := []string{"#### 23 May, Friday 🤸‍♂️", "#### 23 May, Friday 🤸‍♂️🍽💪", "#### 23 May, Friday 🤸‍♂️🍽💪💧"}
	merged := mergeEmojisInJournalHeaders(headers)
	r.Equal([]string{"#### 23 May, Friday 🤸‍♂️🍽💪💧"}, merged)
}

func TestMergeHeadersWithDifferentEmojis(t *testing.T) {
	r := require.New(t)

	headers := []string{"#### 23 May, Friday 🤸‍♂️‍🍽💪💧", "#### 23 May, Friday  🤸‍♂️🍽💪📵🚶‍♂️"}
	merged := mergeEmojisInJournalHeaders(headers)
	r.Equal([]string{"#### 23 May, Friday 🤸‍♂️‍🍽💪💧📵🚶‍♂️"}, merged)
}

func TestMergeHeadersNoEmoji(t *testing.T) {
	r := require.New(t)

	headers := []string{"#### 23 May, Friday", "#### 23 May, Friday 💪"}
	merged := mergeEmojisInJournalHeaders(headers)
	r.Equal([]string{"#### 23 May, Friday 💪"}, merged)

	headers = []string{"#### 23 May, Saturday", "#### 23 May, Saturday"}
	merged = mergeEmojisInJournalHeaders(headers)
	r.Equal([]string{"#### 23 May, Saturday"}, merged)
}
