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
		"name value":          "<td class='var var-name'>Aria Windwalker</td>",
		"number in range":     "<td class='var var-level'>3</td>",
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
