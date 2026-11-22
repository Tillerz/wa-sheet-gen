package main

import (
	"fmt"
	"regexp"
	"strings"
)

// Formatting (bible 7). A node keeps its format in props.fmt; a field has three:
// fmt (value in the sheet), fmtLabel (label in sheet and form), fmtInput (input in the form).
//
// fmt keys: align (left|center|right), bold, italic, underline (bool), color, bg (color),
// size (px), font (font name), borderWidth (px), borderStyle, borderColor, radius (px).

var (
	colorRe        = regexp.MustCompile(`^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|var\(--[a-z][a-z0-9-]*\))$`)
	alignValues    = map[string]bool{"left": true, "center": true, "right": true}
	borderStyles   = map[string]bool{"solid": true, "dashed": true, "dotted": true, "double": true, "none": true}
	fieldFmtKeys   = []string{"fmt", "fmtLabel", "fmtInput"}
	boxTypes       = map[string]bool{"card": true, "card-header": true, "card-body": true, "table": true, "th": true, "td": true}
	numberFmtLimit = map[string]float64{"size": 200, "borderWidth": 50, "radius": 200}
	// listStyles per list type (bible 7: bullet shape of ul, numbering of ol).
	listStyles = map[string]map[string]bool{
		"ul": {"disc": true, "circle": true, "square": true, "none": true},
		"ol": {"decimal": true, "decimal-leading-zero": true, "lower-alpha": true, "upper-alpha": true, "lower-roman": true, "upper-roman": true, "none": true},
	}
)

func fmtOf(n *Node, key string) map[string]any {
	m, _ := n.Props[key].(map[string]any)
	return m
}

func fmtString(m map[string]any, k string) string {
	s, _ := m[k].(string)
	return s
}

func fmtNumber(m map[string]any, k string) (float64, bool) {
	switch v := m[k].(type) {
	case float64:
		return v, true
	case int:
		return float64(v), true
	}
	return 0, false
}

func fmtBool(m map[string]any, k string) bool {
	b, _ := m[k].(bool)
	return b
}

// validateFmt reports invalid format values. CSS generation skips invalid values anyway.
func validateFmt(n *Node, key string, fonts map[string]bool) []Problem {
	m := fmtOf(n, key)
	if m == nil {
		return nil
	}
	var ps []Problem
	if a := fmtString(m, "align"); a != "" && !alignValues[a] {
		ps = append(ps, errorf(n.ID, "unknown alignment %q", a))
	}
	for _, k := range []string{"color", "bg", "borderColor"} {
		if c := fmtString(m, k); c != "" && !colorRe.MatchString(c) {
			ps = append(ps, errorf(n.ID, "color %q: use #rgb, #rrggbb or var(--name)", c))
		}
	}
	for k, limit := range numberFmtLimit {
		if v, ok := fmtNumber(m, k); ok && (v < 0 || v > limit) {
			ps = append(ps, errorf(n.ID, "%s must be 0 to %s px", k, num(limit)))
		}
	}
	if ls := fmtString(m, "listStyle"); ls != "" && !listStyles[n.Type][ls] {
		ps = append(ps, errorf(n.ID, "list style %q does not fit a %s", ls, n.Type))
	}
	if s := fmtString(m, "borderStyle"); s != "" && !borderStyles[s] {
		ps = append(ps, errorf(n.ID, "unknown border style %q", s))
	}
	if f := fmtString(m, "font"); f != "" {
		if !fontNameRe.MatchString(f) {
			ps = append(ps, errorf(n.ID, "font name %q: use letters, digits, spaces and - only", f))
		} else if !fonts[f] {
			ps = append(ps, warnf(n.ID, "font %q is not in the font list; WA will only show it if the reader has it", f))
		}
	}
	return ps
}

// cssDecls turns a format into CSS declarations. Invalid values are skipped.
// box enables border and background (bible 7: only where it makes sense).
func cssDecls(m map[string]any, box bool) []string {
	if m == nil {
		return nil
	}
	var d []string
	add := func(prop, val string) { d = append(d, prop+": "+val) }
	if a := fmtString(m, "align"); alignValues[a] {
		add("text-align", a)
	}
	if fmtBool(m, "bold") {
		add("font-weight", "bold")
	}
	if fmtBool(m, "italic") {
		add("font-style", "italic")
	}
	if fmtBool(m, "underline") {
		add("text-decoration", "underline")
	}
	if c := fmtString(m, "color"); colorRe.MatchString(c) {
		add("color", c)
	}
	if v, ok := fmtNumber(m, "size"); ok && v > 0 && v <= numberFmtLimit["size"] {
		add("font-size", num(v)+"px")
	}
	if f := fmtString(m, "font"); fontNameRe.MatchString(f) {
		add("font-family", f)
	}
	if ls := fmtString(m, "listStyle"); listStyles["ul"][ls] || listStyles["ol"][ls] {
		add("list-style-type", ls)
	}
	if !box {
		return d
	}
	if c := fmtString(m, "bg"); colorRe.MatchString(c) {
		add("background-color", c)
	}
	w, hasW := fmtNumber(m, "borderWidth")
	style := fmtString(m, "borderStyle")
	color := fmtString(m, "borderColor")
	if (hasW && w >= 0 && w <= numberFmtLimit["borderWidth"]) || borderStyles[style] || colorRe.MatchString(color) {
		if !hasW || w < 0 || w > numberFmtLimit["borderWidth"] {
			w = 1
		}
		if !borderStyles[style] {
			style = "solid"
		}
		if !colorRe.MatchString(color) {
			color = "currentColor"
		}
		add("border", num(w)+"px "+style+" "+color)
	}
	if v, ok := fmtNumber(m, "radius"); ok && v >= 0 && v <= numberFmtLimit["radius"] {
		add("border-radius", num(v)+"px")
	}
	return d
}

// cssRule writes one rule. A value ending in ")" gets a space before ";",
// because WA filters the sequence ");" (bible 3.1).
func cssRule(b *strings.Builder, selector string, decls []string) {
	if len(decls) == 0 {
		return
	}
	b.WriteString(selector + " {\n")
	for _, d := range decls {
		if strings.HasSuffix(d, ")") {
			b.WriteString("  " + d + " ;\n")
		} else {
			b.WriteString("  " + d + ";\n")
		}
	}
	b.WriteString("}\n")
}

// formatClasses gives every formatted element (not the root, not fields) a class f-N.
// Elements with the same declarations share a class. Order follows the tree.
func formatClasses(p *Project) (map[string]string, []string) {
	classes := map[string]string{}
	var order []string // declaration text per class, index = N-1
	byDecl := map[string]string{}
	var walk func(n *Node)
	walk = func(n *Node) {
		if n.Type != "container" && n.Type != "field" {
			if d := cssDecls(fmtOf(n, "fmt"), boxTypes[n.Type]); len(d) > 0 {
				key := strings.Join(d, ";")
				cls, ok := byDecl[key]
				if !ok {
					order = append(order, key)
					cls = fmt.Sprintf("f-%d", len(order))
					byDecl[key] = cls
				}
				classes[n.ID] = cls
			}
		}
		for _, c := range n.Children {
			walk(c)
		}
	}
	if p.Root != nil {
		walk(p.Root)
	}
	return classes, order
}

// genFormatCSS writes the rules for the root, the f-N classes and the fields.
func genFormatCSS(p *Project) string {
	var b strings.Builder
	if p.Root == nil {
		return ""
	}
	root := ".block-" + p.SheetName
	// The root takes text formats and a background color (no border).
	rootDecls := cssDecls(fmtOf(p.Root, "fmt"), false)
	if bg := fmtString(fmtOf(p.Root, "fmt"), "bg"); colorRe.MatchString(bg) {
		rootDecls = append(rootDecls, "background-color: "+bg)
	}
	cssRule(&b, root, rootDecls)
	_, order := formatClasses(p)
	for i, key := range order {
		cssRule(&b, fmt.Sprintf("%s .f-%d", root, i+1), strings.Split(key, ";"))
	}
	eachField(p.Root, func(n *Node) {
		cls := fieldClass(propString(n, "name"))
		cssRule(&b, fmt.Sprintf("%s .lbl-%s, %s .ilbl-%s", root, cls, root, cls), cssDecls(fmtOf(n, "fmtLabel"), false))
		cssRule(&b, fmt.Sprintf("%s .var-%s", root, cls), cssDecls(fmtOf(n, "fmt"), true))
		cssRule(&b, fmt.Sprintf("%s :is(input, textarea, select).ivar-%s", root, cls), cssDecls(fmtOf(n, "fmtInput"), true))
	})
	return b.String()
}
