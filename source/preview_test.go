package main

import (
	"strings"
	"testing"
)

func TestPreviewRendersAllTwig(t *testing.T) {
	p := loadTestProject(t, "full.project.json")
	sheet, form := previewHTML(p)
	for name, html := range map[string]string{"sheet": sheet, "form": form} {
		if strings.Contains(html, "{{") || strings.Contains(html, "{%") {
			t.Errorf("%s preview still has Twig code:\n%s", name, html)
		}
	}
	checks := map[string]string{
		"name value":          "<div class='var var-name'>Aria Windwalker</div>",
		"number in range":     "<div class='var var-level'>3</div>",
		"nl2br":               "second line.",
		"checkbox checked":    "fa-square-check",
		"image box":           "<span class='ed-img-ph'>WA image 1234</span>",
		"escaped user text":   "&#123;&#123; variables.x &#125;&#125;",
		"select first option": "<div class='var var-weapon-range'>Melee</div>",
	}
	for what, want := range checks {
		if !strings.Contains(sheet, want) {
			t.Errorf("sheet: %s: missing %q", what, want)
		}
	}
	formChecks := map[string]string{
		"input value":      "value='Aria Windwalker'",
		"selected option":  "<option value='Melee' selected='selected'>",
		"other option":     "<option value='Very Close' >",
		"checkbox checked": "<input value='1' checked='checked'",
		"textarea value":   "rows='5' placeholder='Write it&#39;s notes'>Sample Notes,\nsecond line.</textarea>",
	}
	for what, want := range formChecks {
		if !strings.Contains(form, want) {
			t.Errorf("form: %s: missing %q", what, want)
		}
	}
}

func TestRenderPreviewQuotedOption(t *testing.T) {
	twig := `<option {% if variables.x|default == 'It\'s far' %}selected='selected'{% endif %}>`
	got := renderPreview(twig, map[string]string{"x": "It's far"})
	if got != `<option selected='selected'>` {
		t.Errorf("got %q", got)
	}
	got = renderPreview(`{% if variables.c|default > 0 %}A{% else %}B{% endif %}`, map[string]string{"c": "0"})
	if got != "B" {
		t.Errorf("got %q", got)
	}
}

func TestPreviewExpandsLists(t *testing.T) {
	sheet, form := previewHTML(loadTestProject(t, "full.project.json"))
	if strings.Count(sheet, "<div class='var var-skill'>3</div>") != 3 {
		t.Errorf("want 3 skill rows:\n%s", sheet)
	}
	if !strings.Contains(sheet, "<div class='var var-size'>2H</div>") {
		t.Errorf("second list entry should show the second option")
	}
	for _, want := range []string{"id='skill_002'", "for='skill_003'", "list='list-trait-002'", "datalist id='list-trait-002'"} {
		if !strings.Contains(form, want) {
			t.Errorf("form: missing %q", want)
		}
	}
	if strings.Contains(form, "{{id}}") || strings.Contains(form, "~ id") {
		t.Errorf("loop code left in the form preview")
	}
}

func TestPresetValues(t *testing.T) {
	sheet, form := previewHTML(loadTestProject(t, "full.project.json"))
	for _, want := range []string{
		"<div class='var var-skill-name'>Arcana</div>",
		"<div class='var var-skill-name'>Rogue&#39;s Lore</div>",
		"<div class='var var-weapon'>Sword</div>",
		"<div class='var var-weapon'>Bow</div>",
	} {
		if !strings.Contains(sheet, want) {
			t.Errorf("sheet misses %q", want)
		}
	}
	for _, want := range []string{
		"<div class='ivar ivar-skill-name'>Stealth</div>",
		"value='Sword' class='form-control ivar ivar-weapon' id='weapon_001'",
	} {
		if !strings.Contains(form, want) {
			t.Errorf("form misses %q", want)
		}
	}
	if strings.Contains(form, "name='skill_name") {
		t.Errorf("a preset-only field must have no input")
	}
}

// Empty list entries are hidden in the sheet (not in the form), unless the list keeps them.
func TestEmptyListEntriesHidden(t *testing.T) {
	p := newProject()
	p.Root.Children = append(p.Root.Children, &Node{ID: "r", Type: "row", Props: map[string]any{"repeat": 3.0}, Children: []*Node{
		{ID: "c", Type: "col", Children: []*Node{
			{ID: "a", Type: "field", Props: map[string]any{"fieldType": "string", "name": "weapon", "label": "Weapon"}},
			{ID: "b", Type: "field", Props: map[string]any{"fieldType": "number", "name": "dmg", "label": "Damage"}}}}}})
	sheet := renderPreview(genTwig(p, false), map[string]string{"weapon_002": "Bow", "dmg_003": "0"})
	if strings.Count(sheet, "var-weapon") != 1 || !strings.Contains(sheet, ">Bow<") {
		t.Errorf("only entry 2 has a value (0 counts as empty):\n%s", sheet)
	}
	form := renderPreview(genTwig(p, true), map[string]string{})
	if strings.Count(form, "name='weapon_") != 3 {
		t.Errorf("the form shows all entries")
	}
	p.Root.Children[1].Props["showEmpty"] = true
	if strings.Contains(genTwig(p, false), "{% if attribute(variables, 'weapon_' ~ id)|default or") {
		t.Errorf("showEmpty must keep every entry")
	}
}
