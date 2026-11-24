package main

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Calculated fields (bible 11): a field of type "calc" has a formula. It shows nothing in the form
// and has no WA field; the sheet shows the result. Formula parts:
//
//	number            3, 2.5
//	field name        skill      the number field with that name (in a list: the same entry)
//	@field name       @base      the number field whose label is the text in the field "base"
//	+ - * ( )         // /       // is a floor division; / and // only by a fixed number, never by a field
//
// The same parsed formula is used for the Twig output, the previews and the checks.

type calcNode struct {
	kind byte    // 'n' number, 'f' field, '@' field named by a text field, 'u' minus, '+' '-' '*' '/' 'd' (//)
	num  float64 // kind 'n'
	name string  // kind 'f' and '@'
	l, r *calcNode
}

type calcTok struct {
	kind byte // 'n' number, 'i' name, '@' @name, 'd' //, or the operator / parenthesis itself
	text string
}

func isNameChar(r byte, first bool) bool {
	return r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r == '_' || !first && r >= '0' && r <= '9'
}

func calcTokens(src string) ([]calcTok, error) {
	var toks []calcTok
	for i := 0; i < len(src); {
		c := src[i]
		switch {
		case c == ' ' || c == '\t' || c == '\n' || c == '\r':
			i++
		case c >= '0' && c <= '9' || c == '.':
			j := i
			for j < len(src) && (src[j] >= '0' && src[j] <= '9' || src[j] == '.') {
				j++
			}
			toks = append(toks, calcTok{'n', src[i:j]})
			i = j
		case isNameChar(c, true) || c == '@':
			j := i
			if c == '@' {
				j++
				if j >= len(src) || !isNameChar(src[j], true) {
					return nil, fmt.Errorf("@ must be followed by a field name")
				}
			}
			start := j
			for j < len(src) && isNameChar(src[j], j == start) {
				j++
			}
			if c == '@' {
				toks = append(toks, calcTok{'@', src[start:j]})
			} else {
				toks = append(toks, calcTok{'i', src[i:j]})
			}
			i = j
		case c == '/' && i+1 < len(src) && src[i+1] == '/':
			toks = append(toks, calcTok{'d', "//"})
			i += 2
		case strings.IndexByte("+-*/()", c) >= 0:
			toks = append(toks, calcTok{c, string(c)})
			i++
		default:
			return nil, fmt.Errorf("the character %q is not allowed in a formula (use numbers, field names, + - * / // and brackets)", string(c))
		}
	}
	return toks, nil
}

type calcParser struct {
	toks []calcTok
	pos  int
}

func (p *calcParser) peek() byte {
	if p.pos < len(p.toks) {
		return p.toks[p.pos].kind
	}
	return 0
}

// parseCalc turns a formula into a tree, or says what is wrong with it.
func parseCalc(src string) (*calcNode, error) {
	toks, err := calcTokens(src)
	if err != nil {
		return nil, err
	}
	if len(toks) == 0 {
		return nil, fmt.Errorf("the formula is empty")
	}
	p := &calcParser{toks: toks}
	n, err := p.expr()
	if err != nil {
		return nil, err
	}
	if p.pos < len(toks) {
		return nil, fmt.Errorf("unexpected %q in the formula", toks[p.pos].text)
	}
	return n, nil
}

func (p *calcParser) expr() (*calcNode, error) {
	l, err := p.term()
	if err != nil {
		return nil, err
	}
	for p.peek() == '+' || p.peek() == '-' {
		op := p.toks[p.pos].kind
		p.pos++
		r, err := p.term()
		if err != nil {
			return nil, err
		}
		l = &calcNode{kind: op, l: l, r: r}
	}
	return l, nil
}

func (p *calcParser) term() (*calcNode, error) {
	l, err := p.unary()
	if err != nil {
		return nil, err
	}
	for k := p.peek(); k == '*' || k == '/' || k == 'd'; k = p.peek() {
		p.pos++
		r, err := p.unary()
		if err != nil {
			return nil, err
		}
		if k != '*' && (r.kind != 'n' || r.num == 0) {
			return nil, fmt.Errorf("divide only by a fixed number that is not 0 (a field can be empty, and WA stops on a division by 0)")
		}
		l = &calcNode{kind: k, l: l, r: r}
	}
	return l, nil
}

func (p *calcParser) unary() (*calcNode, error) {
	if p.peek() == '-' {
		p.pos++
		c, err := p.unary()
		if err != nil {
			return nil, err
		}
		return &calcNode{kind: 'u', l: c}, nil
	}
	return p.primary()
}

func (p *calcParser) primary() (*calcNode, error) {
	if p.pos >= len(p.toks) {
		return nil, fmt.Errorf("the formula ends too early")
	}
	t := p.toks[p.pos]
	p.pos++
	switch t.kind {
	case 'n':
		v, err := strconv.ParseFloat(t.text, 64)
		if err != nil {
			return nil, fmt.Errorf("%q is not a number", t.text)
		}
		return &calcNode{kind: 'n', num: v}, nil
	case 'i':
		return &calcNode{kind: 'f', name: t.text}, nil
	case '@':
		return &calcNode{kind: '@', name: t.text}, nil
	case '(':
		n, err := p.expr()
		if err != nil {
			return nil, err
		}
		if p.peek() != ')' {
			return nil, fmt.Errorf("a bracket ( is not closed")
		}
		p.pos++
		return n, nil
	}
	return nil, fmt.Errorf("unexpected %q in the formula", t.text)
}

// refs lists the fields a formula uses, each once, in order of appearance.
func (c *calcNode) refs() []*calcNode {
	var out []*calcNode
	seen := map[string]bool{}
	var walk func(n *calcNode)
	walk = func(n *calcNode) {
		if n == nil {
			return
		}
		if n.kind == 'f' || n.kind == '@' {
			if key := string(n.kind) + n.name; !seen[key] {
				seen[key] = true
				out = append(out, n)
			}
		}
		walk(n.l)
		walk(n.r)
	}
	walk(c)
	return out
}

func calcPrec(n *calcNode) int {
	switch n.kind {
	case '+', '-':
		return 1
	case '*', '/', 'd':
		return 2
	case 'u':
		return 3
	}
	return 4
}

// twig writes the formula as a Twig expression; leaf gives the Twig name of a field.
func (c *calcNode) twig(leaf func(*calcNode) string) string {
	var print func(n *calcNode, parent int, right bool, parentOp byte) string
	print = func(n *calcNode, parent int, right bool, parentOp byte) string {
		var s string
		switch n.kind {
		case 'n':
			return num(n.num)
		case 'f', '@':
			return leaf(n)
		case 'u':
			s = "-" + print(n.l, 3, false, 'u')
		default:
			op := map[byte]string{'+': " + ", '-': " - ", '*': " * ", '/': " / ", 'd': " // "}[n.kind]
			s = print(n.l, calcPrec(n), false, n.kind) + op + print(n.r, calcPrec(n), true, n.kind)
		}
		p := calcPrec(n)
		if p < parent || p == parent && right && (parentOp == '-' || parentOp == '/' || parentOp == 'd') {
			return "(" + s + ")"
		}
		return s
	}
	return print(c, 0, false, 0)
}

// eval calculates the formula; value gives the number of a field.
func (c *calcNode) eval(value func(*calcNode) float64) float64 {
	switch c.kind {
	case 'n':
		return c.num
	case 'f', '@':
		return value(c)
	case 'u':
		return -c.l.eval(value)
	}
	l, r := c.l.eval(value), c.r.eval(value)
	switch c.kind {
	case '+':
		return l + r
	case '-':
		return l - r
	case '*':
		return l * r
	case '/':
		return l / r
	}
	return math.Floor(l / r)
}

func isCalcField(n *Node) bool {
	return n.Type == "field" && propString(n, "fieldType") == "calc"
}

// fieldLabel is the label of a field as WA lists it: an empty label falls back to the name.
func fieldLabel(n *Node) string {
	label := strings.TrimSpace(propString(n, "label"))
	if label == "" {
		label = strings.ReplaceAll(propString(n, "name"), "_", " ")
	}
	return label
}

// fieldInfo is a field with the list it sits in (count 1: not in a list).
type fieldInfo struct {
	n            *Node
	start, count int
}

func (f fieldInfo) inList() bool { return f.count > 1 }

func fieldInfos(root *Node) []fieldInfo {
	var out []fieldInfo
	var walk func(n *Node, start, count int)
	walk = func(n *Node, start, count int) {
		if c := repeatCount(n); c > 1 {
			start, count = repeatStart(n), c
		}
		if n.Type == "field" {
			out = append(out, fieldInfo{n, start, count})
		}
		for _, c := range n.Children {
			walk(c, start, count)
		}
	}
	walk(root, 1, 1)
	return out
}

// calcTarget finds the field a formula name stands for, seen from a calc field at (start, count):
// outside lists a field that is not in a list; inside a list a field of the same list, or a field
// that is not in a list.
func calcTarget(infos []fieldInfo, name string, from fieldInfo) (fieldInfo, bool) {
	for _, f := range infos {
		if propString(f.n, "name") != name || isCalcField(f.n) {
			continue
		}
		if !f.inList() || f.start == from.start && f.count == from.count {
			return f, true
		}
	}
	return fieldInfo{}, false
}

// numberLabels maps the labels of the number fields outside lists to their names. @field names
// one of these labels. Labels that appear twice keep their first field.
func numberLabels(infos []fieldInfo) (labels []string, names map[string]string) {
	names = map[string]string{}
	for _, f := range infos {
		if f.inList() || propString(f.n, "fieldType") != "number" {
			continue
		}
		l := fieldLabel(f.n)
		if _, dup := names[l]; !dup {
			names[l] = propString(f.n, "name")
			labels = append(labels, l)
		}
	}
	return labels, names
}

// validateCalc checks one calculated field.
func validateCalc(infos []fieldInfo, from fieldInfo) []Problem {
	n := from.n
	name := propString(n, "name")
	var ps []Problem
	if propBool(n, "required") {
		ps = append(ps, errorf(n.ID, "field %q: a calculated field cannot be required", name))
	}
	tree, err := parseCalc(propString(n, "formula"))
	if err != nil {
		return append(ps, errorf(n.ID, "field %q: %v", name, err))
	}
	_, labelNames := numberLabels(infos)
	for _, ref := range tree.refs() {
		t, ok := calcTarget(infos, ref.name, from)
		if !ok {
			where := ""
			if from.inList() {
				where = " in this list (or outside lists)"
			}
			ps = append(ps, errorf(n.ID, "field %q: the formula uses %q, but there is no such field%s", name, ref.name, where))
			continue
		}
		ft := propString(t.n, "fieldType")
		if ref.kind == 'f' && ft != "number" {
			ps = append(ps, errorf(n.ID, "field %q: the formula uses %q, which is not a number field", name, ref.name))
		}
		if ref.kind == '@' {
			vals := propStrings(t.n, "options")
			if hasPreset(t.n) {
				vals = propStrings(t.n, "preset")
			}
			if ft != "string" && ft != "select" && ft != "suggest" {
				ps = append(ps, errorf(n.ID, "field %q: @%s must be a string, dropdown or suggest field that holds a field label", name, ref.name))
			}
			for _, v := range vals {
				if _, ok := labelNames[strings.TrimSpace(v)]; !ok {
					ps = append(ps, warnf(n.ID, "field %q: %q (value of %q) is not the label of a number field outside lists, so it counts as 0", name, v, ref.name))
				}
			}
		}
	}
	return ps
}
