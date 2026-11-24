package main

import (
	"strings"
	"testing"
)

func calcFieldNode(id, name, formula string) *Node {
	return &Node{ID: id, Type: "field", Props: map[string]any{"fieldType": "calc", "name": name, "label": name, "formula": formula}}
}

// skillsProject: two attributes and a list of 3 skills; each skill names its attribute (preset text)
// and the calculated field adds the attribute's value and the skill value.
func skillsProject(formula string) *Project {
	p := newProject()
	field := func(id, ft, name, label string, extra map[string]any) *Node {
		props := map[string]any{"fieldType": ft, "name": name, "label": label}
		for k, v := range extra {
			props[k] = v
		}
		return &Node{ID: id, Type: "field", Props: props}
	}
	list := &Node{ID: "l", Type: "col", Props: map[string]any{"repeat": 3.0}, Children: []*Node{
		field("sk", "string", "skill_name", "Skill", map[string]any{"preset": []any{"Brawling", "Ranged", "Jumping"}}),
		field("ba", "string", "base", "Base", map[string]any{"preset": []any{"Strength", "Agility", "Agility"}}),
		field("sv", "number", "skill", "Skill value", nil),
		calcFieldNode("tt", "total", formula),
	}}
	p.Root.Children = append(p.Root.Children, &Node{ID: "r", Type: "row", Children: []*Node{
		{ID: "a", Type: "col", Children: []*Node{
			field("st", "number", "strength", "Strength", map[string]any{"min": 5.0}),
			field("ag", "number", "agility", "Agility", nil),
		}},
		list,
	}})
	return p
}

func TestCalcSkillsExample(t *testing.T) {
	p := skillsProject("@base + skill")
	files, ps := buildExport(p)
	if files == nil {
		t.Fatalf("export: %s", problemsText(ps))
	}
	sheet, form := files["basic-sheet.html.twig"], files["edit-form.html.twig"]
	for _, want := range []string{
		"{% set calc_total_names = {'Strength': 'strength', 'Agility': 'agility'} %}",
		"{% set calc_total_1_key = preset_base[i - 1]|default %}",
		"{% set calc_total_1 = attribute(variables, calc_total_names[calc_total_1_key]|default('-'))|default(0) %}",
		"{% set calc_total_2 = attribute(variables, 'skill_' ~ id)|default(0) %}",
		"{# calc total #}{{ calc_total_1 + calc_total_2 }}",
	} {
		if !strings.Contains(sheet, want) {
			t.Errorf("sheet misses %q\n%s", want, sheet)
		}
	}
	if strings.Contains(form, "total") {
		t.Errorf("a calculated field is not in the form")
	}
	if strings.Contains(files["import-to-wa.yml"], "total") {
		t.Errorf("a calculated field has no YAML entry")
	}
	// Sample values: strength 5 (min), agility 3, skill 3 → 8, 6, 6.
	prev, _ := previewHTML(p)
	if strings.Contains(prev, "{%") || strings.Contains(prev, "{{") || strings.Contains(prev, "{#") {
		t.Errorf("preview still has Twig:\n%s", prev)
	}
	for _, want := range []string{
		"var-skill-name'>Brawling<", "var-total'>8<", "var-total'>6<",
	} {
		if !strings.Contains(prev, want) {
			t.Errorf("preview misses %q\n%s", want, prev)
		}
	}
	if strings.Count(prev, "var-total'>6<") != 2 {
		t.Errorf("Ranged and Jumping both use agility: 6 twice\n%s", prev)
	}
	if ps := checkCSS("x", ""); len(ps) > 0 || strings.Contains(sheet, ");") {
		t.Errorf("the generated Twig must not contain \");\"")
	}
}

func TestCalcWithoutList(t *testing.T) {
	p := newProject()
	body := p.Root.Children[0].Children[0].Children[0].Children[1]
	body.Children = append(body.Children,
		&Node{ID: "s", Type: "field", Props: map[string]any{"fieldType": "number", "name": "strength", "label": "Strength"}},
		calcFieldNode("m", "mod", "(strength - 10) // 2 + -1"))
	files, ps := buildExport(p)
	if files == nil {
		t.Fatalf("export: %s", problemsText(ps))
	}
	if !strings.Contains(files["basic-sheet.html.twig"], "{{ (calc_mod_1 - 10) // 2 + -1 }}") {
		t.Errorf("sheet:\n%s", files["basic-sheet.html.twig"])
	}
	prev, _ := previewHTML(p)
	if !strings.Contains(prev, "var-mod'>-5<") { // strength 3: (3 - 10) // 2 = -4, and -4 + -1
		t.Errorf("preview:\n%s", prev)
	}
}

func TestCalcFormulaErrors(t *testing.T) {
	for formula, want := range map[string]string{
		"":                        "empty",
		"skill +":                 "ends too early",
		"(skill":                  "not closed",
		"skill % 2":               "not allowed",
		"skill / strength":        "divide only by a fixed number",
		"skill // 0":              "divide only by a fixed number",
		"nothing + 1":             "no such field",
		"skill + @skill":          "must be a string, dropdown or suggest",
		"@":                       "@ must be followed",
		"strength + @base + base": "not a number field",
	} {
		_, ps := buildExport(skillsProject(formula))
		if !strings.Contains(problemsText(ps), want) {
			t.Errorf("formula %q: want %q, got %q", formula, want, problemsText(ps))
		}
	}
	// A calculated field outside the list cannot use a field of the list.
	p := skillsProject("skill + 1")
	list := p.Root.Children[1].Children[1]
	calc := list.Children[3]
	list.Children = list.Children[:3]
	p.Root.Children[1].Children[0].Children = append(p.Root.Children[1].Children[0].Children, calc)
	if _, ps := buildExport(p); !strings.Contains(problemsText(ps), "no such field") {
		t.Errorf("list field from outside the list: %q", problemsText(ps))
	}
	// A preset text that is no number label is a warning.
	p = skillsProject("@base + 1")
	p.Root.Children[1].Children[1].Children[1].Props["preset"] = []any{"Strength", "Luck", "Agility"}
	files, ps := buildExport(p)
	if files == nil || !strings.Contains(problemsText(ps), "is not the label of a number field") {
		t.Errorf("unknown attribute label: %q", problemsText(ps))
	}
}

func TestCalcTwigPrecedence(t *testing.T) {
	leaf := func(c *calcNode) string { return c.name }
	for formula, want := range map[string]string{
		"a + b * c":    "a + b * c",
		"(a + b) * c":  "(a + b) * c",
		"a - (b - c)":  "a - (b - c)",
		"a - (b + c)":  "a - (b + c)",
		"a + (b - c)":  "a + b - c",
		"-(a + b)":     "-(a + b)",
		"(a + 4) // 2": "(a + 4) // 2",
		"a * 2 / 4":    "a * 2 / 4",
		"2.50 + a":     "2.5 + a",
	} {
		n, err := parseCalc(formula)
		if err != nil {
			t.Errorf("%q: %v", formula, err)
			continue
		}
		if got := n.twig(leaf); got != want {
			t.Errorf("%q → %q, want %q", formula, got, want)
		}
	}
}
