package main

import (
	"fmt"
	"regexp"
	"strings"
)

// bannedWords are filtered by the WA CSS security filter (bible 3.1).
// They must not appear in CSS, class names or field names.
var bannedWords = []string{"script", "javascript", "expression", "behavior", "@import"}

// findBannedWord returns the first banned word contained in s, or "".
func findBannedWord(s string) string {
	lower := strings.ToLower(s)
	for _, w := range bannedWords {
		if strings.Contains(lower, w) {
			return w
		}
	}
	return ""
}

var sheetNameRe = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// classNameRe is the rule for user-given CSS class names, e.g. card classes.
var classNameRe = regexp.MustCompile(`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`)

// forbiddenClassPrefixes are filtered by WA (bible 3.1).
var forbiddenClassPrefixes = []string{"sh", "py"}

// validateSheetName checks the naming rule for sheet names (bible 3.4).
func validateSheetName(name string) error {
	if !sheetNameRe.MatchString(name) {
		return fmt.Errorf("sheet name %q: use only a-z, 0-9 and single - between words", name)
	}
	if w := findBannedWord(name); w != "" {
		return fmt.Errorf("sheet name %q contains the filtered word %q", name, w)
	}
	return nil
}

// validateClassName checks a user-given CSS class name (bible 3.1, 3.4).
func validateClassName(name string) error {
	if !classNameRe.MatchString(name) {
		return fmt.Errorf("class %q: start with a-z, then use only a-z, 0-9 and single - between words", name)
	}
	for _, p := range forbiddenClassPrefixes {
		if strings.HasPrefix(name, p) {
			return fmt.Errorf("class %q must not start with %q", name, p)
		}
	}
	if w := findBannedWord(name); w != "" {
		return fmt.Errorf("class %q contains the filtered word %q", name, w)
	}
	return nil
}
