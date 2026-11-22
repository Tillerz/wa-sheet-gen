package main

import (
	"fmt"
	"regexp"
	"strings"
)

// Problem is one validation result (bible section 9).
type Problem struct {
	Level   string `json:"level"` // "error" or "warning"
	Message string `json:"message"`
	NodeID  string `json:"nodeId,omitempty"`
}

func errorf(id, format string, a ...any) Problem {
	return Problem{Level: "error", Message: fmt.Sprintf(format, a...), NodeID: id}
}

func warnf(id, format string, a ...any) Problem {
	return Problem{Level: "warning", Message: fmt.Sprintf(format, a...), NodeID: id}
}

func hasErrors(ps []Problem) bool {
	for _, p := range ps {
		if p.Level == "error" {
			return true
		}
	}
	return false
}

// allowedChildren mirrors the nesting rules of bible 5.1 (same as web/tree.js).
var allowedChildren = map[string][]string{
	"container":   {"row"},
	"row":         {"col"},
	"col":         {"row", "card", "field", "ul", "ol", "table", "text", "image"},
	"card":        {"card-header", "card-body"},
	"card-header": {"text"},
	"card-body":   {"row", "field", "ul", "ol", "table", "text", "image"},
	"ul":          {"li"},
	"ol":          {"li"},
	"li":          {"text", "field"},
	"table":       {"tr"},
	"tr":          {"th", "td", "field"},
	"th":          {"text"},
	"td":          {"text"},
}

func canContain(parent, child string) bool {
	for _, c := range allowedChildren[parent] {
		if c == child {
			return true
		}
	}
	return false
}

var fieldTypes = map[string]bool{
	"string": true, "number": true, "text": true, "checkbox": true,
	"select": true, "suggest": true, "image": true,
}

var digitsRe = regexp.MustCompile(`^[0-9]+$`)

// fontNameRe allows names that work unquoted in CSS (bible 3.1: no quotes).
var fontNameRe = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9 -]*$`)
var fontURLRe = regexp.MustCompile(`^https://[^\s'"()]+$`)

// validateProject checks the tree and settings. Generated CSS and HTML are checked separately.
func validateProject(p *Project) []Problem {
	var ps []Problem
	if err := validateSheetName(p.SheetName); err != nil {
		ps = append(ps, errorf("", "%v", err))
	}
	if p.Root == nil || p.Root.Type != "container" {
		return append(ps, errorf("", "the project has no sheet root"))
	}
	for _, f := range p.Fonts {
		if !fontNameRe.MatchString(f.Name) {
			ps = append(ps, errorf("", "font name %q: use letters, digits, spaces and - only", f.Name))
		}
		if !fontURLRe.MatchString(f.URL) {
			ps = append(ps, errorf("", "font %q: the URL must start with https:// and contain no spaces, quotes or brackets", f.Name))
		}
	}

	names := map[string]string{} // field name → node id
	hasName := false
	var walk func(n *Node, parent *Node)
	walk = func(n *Node, parent *Node) {
		if parent != nil && !canContain(parent.Type, n.Type) {
			ps = append(ps, errorf(n.ID, "a %s cannot be inside a %s", n.Type, parent.Type))
		}
		switch n.Type {
		case "row":
			if len(n.Children) == 0 {
				ps = append(ps, warnf(n.ID, "a row has no cols"))
			}
		case "col":
			if len(n.Children) == 0 {
				ps = append(ps, warnf(n.ID, "a col is empty"))
			}
		case "card":
			if len(n.Children) == 0 {
				ps = append(ps, warnf(n.ID, "a card has no header and no body"))
			}
			if cls := propString(n, "cls"); cls != "" {
				if err := validateClassName(cls); err != nil {
					ps = append(ps, errorf(n.ID, "%v", err))
				}
			}
		case "ul", "ol":
			if len(n.Children) == 0 {
				ps = append(ps, warnf(n.ID, "a list has no items"))
			}
		case "table":
			if len(n.Children) == 0 {
				ps = append(ps, warnf(n.ID, "a table has no rows"))
			}
		case "image":
			if !digitsRe.MatchString(propString(n, "imageId")) {
				ps = append(ps, errorf(n.ID, "an image has no WA image ID"))
			}
		case "field":
			ps = append(ps, validateField(n, names)...)
			if propBool(n, "required") {
				if propString(n, "name") != "name" || propString(n, "fieldType") != "string" {
					ps = append(ps, errorf(n.ID, "only the string field \"name\" can be required"))
				} else {
					hasName = true
				}
			}
		}
		for _, c := range n.Children {
			walk(c, n)
		}
	}
	walk(p.Root, nil)
	if !hasName {
		ps = append(ps, errorf("", "the required field \"name\" is missing"))
	}
	return ps
}

func validateField(n *Node, names map[string]string) []Problem {
	var ps []Problem
	name := propString(n, "name")
	if err := validateFieldName(name); err != nil {
		ps = append(ps, errorf(n.ID, "%v", err))
	} else if _, dup := names[name]; dup {
		ps = append(ps, errorf(n.ID, "two fields are named %q", name))
	}
	names[name] = n.ID
	if strings.TrimSpace(propString(n, "label")) == "" {
		ps = append(ps, errorf(n.ID, "field %q has no label", name))
	}
	ft := propString(n, "fieldType")
	if !fieldTypes[ft] {
		ps = append(ps, errorf(n.ID, "field %q has an unknown type %q", name, ft))
	}
	switch ft {
	case "select", "suggest":
		opts := propStrings(n, "options")
		if len(opts) == 0 {
			ps = append(ps, errorf(n.ID, "field %q has no values to choose from", name))
		}
		seen := map[string]bool{}
		for _, o := range opts {
			if strings.TrimSpace(o) == "" || strings.ContainsAny(o, "\r\n") {
				ps = append(ps, errorf(n.ID, "field %q has an empty or multi-line value", name))
			}
			if seen[o] {
				ps = append(ps, errorf(n.ID, "field %q has the value %q twice", name, o))
			}
			seen[o] = true
		}
	case "number":
		minV, hasMin := propNumber(n, "min")
		maxV, hasMax := propNumber(n, "max")
		if hasMin && hasMax && minV > maxV {
			ps = append(ps, errorf(n.ID, "field %q: min is greater than max", name))
		}
	case "text":
		if r, ok := propNumber(n, "rows"); ok && (r < 1 || r > 20) {
			ps = append(ps, errorf(n.ID, "field %q: rows must be 1 to 20", name))
		}
	}
	return ps
}

var shPyClassRe = regexp.MustCompile(`(?i)\.(sh|py)[a-z0-9_-]*`)

// checkCSS applies the WA CSS filter rules (bible 3.1) to a whole CSS file.
func checkCSS(file, css string) []Problem {
	var ps []Problem
	if strings.Contains(css, ");") {
		ps = append(ps, errorf("", "%s contains \");\" — put a space between: \") ;\"", file))
	}
	if strings.ContainsAny(css, `'"`) {
		ps = append(ps, errorf("", "%s contains a quote (' or \")", file))
	}
	depth := 0
	for _, r := range css {
		if r == '(' {
			depth++
		} else if r == ')' && depth > 0 {
			depth--
		} else if r == '%' && depth > 0 {
			ps = append(ps, errorf("", "%s has %% inside ( )", file))
			break
		}
	}
	if w := findBannedWord(css); w != "" {
		ps = append(ps, errorf("", "%s contains the filtered word %q", file, w))
	}
	if m := shPyClassRe.FindString(css); m != "" {
		ps = append(ps, errorf("", "%s uses the class %s; classes must not start with sh or py", file, m))
	}
	return ps
}

var eventAttrRe = regexp.MustCompile(`(?i)<[^>]*\son[a-z]+\s*=`)

// checkHTML makes sure no JavaScript ends up in a twig file (bible 3.3).
func checkHTML(file, html string) []Problem {
	var ps []Problem
	lower := strings.ToLower(html)
	if strings.Contains(lower, "<script") || strings.Contains(lower, "javascript:") || eventAttrRe.MatchString(html) {
		ps = append(ps, errorf("", "%s contains JavaScript", file))
	}
	return ps
}

// ---------- prop helpers (JSON numbers arrive as float64, Go-made projects use int) ----------

func propString(n *Node, k string) string {
	s, _ := n.Props[k].(string)
	return s
}

func propBool(n *Node, k string) bool {
	b, _ := n.Props[k].(bool)
	return b
}

func propNumber(n *Node, k string) (float64, bool) {
	switch v := n.Props[k].(type) {
	case float64:
		return v, true
	case int:
		return float64(v), true
	}
	return 0, false
}

func propStrings(n *Node, k string) []string {
	switch v := n.Props[k].(type) {
	case []string:
		return v
	case []any:
		out := make([]string, 0, len(v))
		for _, x := range v {
			if s, ok := x.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}
