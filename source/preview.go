package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// The previews render the exported Twig with sample data. This is not a Twig engine:
// it only knows the few patterns our generator writes (see export.go).

var (
	twigIfGt0Re = regexp.MustCompile(`(?s)\{% if variables\.([a-z0-9_]+)\|default > 0 %\}(.*?)(?:\{% else %\}(.*?))?\{% endif %\}`)
	twigIfEqRe  = regexp.MustCompile(`(?s)\{% if variables\.([a-z0-9_]+)\|default == '((?:[^'\\]|\\.)*)' %\}(.*?)\{% endif %\}`)
	twigNl2brRe = regexp.MustCompile(`\{\{variables\.([a-z0-9_]+)\|default\|nl2br\}\}`)
	twigVarRe   = regexp.MustCompile(`\{\{variables\.([a-z0-9_]+)(?:\|default(?:\('((?:[^'\\]|\\.)*)'\))?)?\}\}`)
	twigStrRe   = regexp.MustCompile(`\{\{'((?:[^'\\]|\\.)*)'\}\}`)
	presetSetRe = regexp.MustCompile(`(?m)^[ ]*\{% set preset_([a-z0-9_]+) = \[(.*)\] %\}\n`)
	presetUseRe = regexp.MustCompile(`preset_([a-z0-9_]+)\[i - ([0-9]+)\]\|default`)
	twigItemRe  = regexp.MustCompile(`'((?:[^'\\]|\\.)*)'`)
	// {% if variables.a_001|default or variables.b_001|default %} … {% endif %} (hide empty list entries)
	twigIfAnyRe = regexp.MustCompile(`(?s)\{% if ((?:variables\.[a-z0-9_]+\|default(?: or )?)+) %\}(.*?)\{% endif %\}`)
	twigVarName = regexp.MustCompile(`variables\.([a-z0-9_]+)`)
	bbImgRe     = regexp.MustCompile(`\[img:([0-9]+)\]`)
	twigUnquote = strings.NewReplacer(`\'`, `'`, `\\`, `\`)
	twigLoopRe  = regexp.MustCompile(`(?s)\{% for i in ([0-9]+)\.\.([0-9]+) %\}\n[ ]*` + regexp.QuoteMeta(loopIDLine) + `\n(.*?)[ ]*\{% endfor %\}\n`)
	twigAttrRe  = regexp.MustCompile(`attribute\(variables, '([a-z0-9_]+)' ~ id\)`)
)

// sampleData gives every field a value to show in the previews.
func sampleData(p *Project) map[string]string {
	vars := map[string]string{}
	eachFieldEntry(p.Root, func(n *Node, suffix string) {
		if suffix != "" && hasPreset(n) {
			return // shows its preset value (editable fields: as the default)
		}
		name := propString(n, "name") + suffix
		label := strings.TrimSpace(propString(n, "label"))
		if label == "" {
			label = strings.ReplaceAll(propString(n, "name"), "_", " ")
		}
		if suffix != "" {
			label += " " + strings.TrimLeft(suffix[1:], "0")
		}
		switch propString(n, "fieldType") {
		case "number":
			v := 3.0
			if m, ok := propNumber(n, "min"); ok && m > v {
				v = m
			}
			if m, ok := propNumber(n, "max"); ok && m < v {
				v = m
			}
			vars[name] = num(v)
		case "text":
			vars[name] = "Sample " + label + ",\nsecond line."
		case "checkbox":
			vars[name] = "1"
		case "select", "suggest":
			if opts := propStrings(n, "options"); len(opts) > 0 {
				i := 0
				if suffix != "" { // list entries show different values
					k, _ := strconv.Atoi(suffix[1:])
					i = (k - 1) % len(opts)
				}
				vars[name] = opts[i]
			}
		case "image":
			vars[name] = "1234"
		default:
			if name == "name" {
				vars[name] = "Aria Windwalker"
			} else {
				vars[name] = "Sample " + label
			}
		}
	})
	return vars
}

// isPositiveText is Twig's truth for a stored value: empty and "0" are false.
func isPositiveText(s string) bool {
	s = strings.TrimSpace(s)
	return s != "" && s != "0"
}

func isPositive(s string) bool {
	s = strings.TrimSpace(s)
	return s != "" && s != "0" && !strings.HasPrefix(s, "-")
}

// renderPreview fills our generated Twig with vars. Values are HTML-escaped like Twig does.
func renderPreview(twig string, vars map[string]string) string {
	// Preset arrays: {% set preset_x = ['a', 'b'] %} (raw Twig strings, still escaped)
	presets := map[string][]string{}
	twig = presetSetRe.ReplaceAllStringFunc(twig, func(m string) string {
		g := presetSetRe.FindStringSubmatch(m)
		for _, it := range twigItemRe.FindAllStringSubmatch(g[2], -1) {
			presets[g[1]] = append(presets[g[1]], it[1])
		}
		return ""
	})
	// Lists: repeat the loop body with id = 001, 002, …
	out := twigLoopRe.ReplaceAllStringFunc(twig, func(m string) string {
		g := twigLoopRe.FindStringSubmatch(m)
		from, _ := strconv.Atoi(g[1])
		to, _ := strconv.Atoi(g[2])
		var b strings.Builder
		for i := from; i <= to; i++ {
			id := fmt.Sprintf("%03d", i)
			body := twigAttrRe.ReplaceAllString(g[3], "variables.${1}"+id)
			// preset_x[i - N]|default → the entry's preset value as a Twig string
			body = presetUseRe.ReplaceAllStringFunc(body, func(u string) string {
				pg := presetUseRe.FindStringSubmatch(u)
				off, _ := strconv.Atoi(pg[2])
				if k := i - off; k >= 0 && k < len(presets[pg[1]]) {
					return "'" + presets[pg[1]][k] + "'"
				}
				return "''"
			})
			b.WriteString(strings.ReplaceAll(body, "{{id}}", id))
		}
		return b.String()
	})
	out = twigIfGt0Re.ReplaceAllStringFunc(out, func(m string) string {
		g := twigIfGt0Re.FindStringSubmatch(m)
		if isPositive(vars[g[1]]) {
			return g[2]
		}
		return g[3]
	})
	out = twigIfEqRe.ReplaceAllStringFunc(out, func(m string) string {
		g := twigIfEqRe.FindStringSubmatch(m)
		if vars[g[1]] == twigUnquote.Replace(g[2]) {
			return g[3]
		}
		return ""
	})
	// After the inner ifs are gone, the next {% endif %} belongs to the entry condition.
	out = twigIfAnyRe.ReplaceAllStringFunc(out, func(m string) string {
		g := twigIfAnyRe.FindStringSubmatch(m)
		for _, v := range twigVarName.FindAllStringSubmatch(g[1], -1) {
			if isPositiveText(vars[v[1]]) {
				return g[2]
			}
		}
		return ""
	})
	out = twigNl2brRe.ReplaceAllStringFunc(out, func(m string) string {
		g := twigNl2brRe.FindStringSubmatch(m)
		return strings.ReplaceAll(esc(vars[g[1]]), "\n", "<br>\n")
	})
	out = twigVarRe.ReplaceAllStringFunc(out, func(m string) string {
		g := twigVarRe.FindStringSubmatch(m)
		if v := vars[g[1]]; v != "" {
			return esc(v)
		}
		return esc(twigUnquote.Replace(g[2]))
	})
	out = twigStrRe.ReplaceAllStringFunc(out, func(m string) string {
		return esc(twigUnquote.Replace(twigStrRe.FindStringSubmatch(m)[1]))
	})
	// WA turns [img:ID] into the image; the preview shows a box instead.
	return bbImgRe.ReplaceAllString(out, "<span class='ed-img-ph'>WA image $1</span>")
}

// previewHTML returns the sheet and the form as they would look on WA with sample data.
func previewHTML(p *Project) (sheet, form string) {
	vars := sampleData(p)
	return renderPreview(genTwig(p, false), vars), renderPreview(genTwig(p, true), vars)
}
