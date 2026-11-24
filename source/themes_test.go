package main

import (
	"strings"
	"testing"
)

// Every theme must pass the WA CSS rules and style all the parts it promises.
func TestThemesPassWARules(t *testing.T) {
	seen := map[string]bool{}
	for _, th := range themes {
		if seen[th.ID] {
			t.Errorf("theme id %q twice", th.ID)
		}
		seen[th.ID] = true
		css := themeCSS(&th, ".block-test")
		if ps := checkCSS(th.ID, css); len(ps) > 0 {
			t.Errorf("%s breaks a WA rule: %s", th.ID, problemsText(ps))
		}
		wants := []string{
			".block-test\n{", ".block-test .card\n{", ".block-test .card-header\n{",
			".block-test .lbl,\n.block-test .ilbl\n{", ".block-test .table tr:nth-child(even)", "li:nth-child(even)",
		}
		if !th.Native { // a native theme leaves WA's own card body, input and row colors alone
			wants = append(wants, "border: ", ".block-test .var\n{", ".block-test .form-control\n{", "color: "+th.InputText+" !important",
				".block-test .card-body\n{", "background: transparent",
				".block-test .table th,\n.block-test .table td\n{", ".block-test .table tr:nth-child(n)\n{")
		} else if strings.Contains(css, ".form-control") || strings.Contains(css, ".card-body") || strings.Contains(css, "background-color: transparent") {
			t.Errorf("%s is native but sets WA's own colors", th.ID)
		}
		if strings.Contains(css, "rgb") { // WA's filter puts its class prefix after every ", " inside a value
			t.Errorf("%s uses rgb()/rgba(): use hex (#RRGGBBAA for see-through)", th.ID)
		}
		for _, want := range wants {
			if !strings.Contains(css, want) {
				t.Errorf("%s misses %q", th.ID, want)
			}
		}
	}
}

func TestThemeComesFirstInStyleCSS(t *testing.T) {
	p := loadTestProject(t, "full.project.json")
	p.Theme = "horror"
	files, ps := buildExport(p)
	if files == nil {
		t.Fatalf("export: %s", problemsText(ps))
	}
	css := files["style.css"]
	theme := strings.Index(css, "/* Theme: Horror */")
	format := strings.Index(css, ".block-test-sheet .f-1")
	custom := strings.Index(css, ".card-header { color: var(--dark) ; }")
	if theme < 0 || format < 0 || custom < 0 || !(theme < format && format < custom) {
		t.Errorf("order theme %d, format %d, custom %d", theme, format, custom)
	}
	p.Theme = "nope"
	if _, ps := buildExport(p); !strings.Contains(problemsText(ps), "unknown theme") {
		t.Errorf("unknown theme not reported")
	}
}

// Every library font must pass the font checks and the WA CSS rules in approved.css.
func TestFontLibraryPassesChecks(t *testing.T) {
	p := newProject()
	p.Fonts = fontLibrary
	if ps := validateProject(p); hasErrors(ps) {
		t.Errorf("library fonts: %s", problemsText(ps))
	}
	css := genApprovedCSS(p)
	if ps := checkCSS("approved.css", css); len(ps) > 0 {
		t.Errorf("approved.css with all library fonts: %s", problemsText(ps))
	}
	if strings.Count(css, "@font-face") != len(fontLibrary) {
		t.Errorf("not every font written")
	}
}

// Theme fonts must come from the font library and end up in approved.css.
func TestThemeFonts(t *testing.T) {
	lib := map[string]bool{}
	for _, f := range fontLibrary {
		lib[f.Name] = true
	}
	for _, th := range themes {
		for _, name := range th.Fonts {
			if !lib[name] {
				t.Errorf("%s uses %q, which is not in the font library", th.ID, name)
			}
			if !strings.Contains(th.HeaderFont+th.BodyFont, name) {
				t.Errorf("%s lists %q but does not use it", th.ID, name)
			}
		}
	}
	p := newProject()
	p.Theme = "elegant-medieval"
	p.Fonts = []Font{fontLibrary[6]} // IM Fell English SC, already in the sheet: not twice
	css := genApprovedCSS(p)
	if strings.Count(css, "font-family: IM Fell English SC;") != 1 || !strings.Contains(css, "font-family: IM Fell Double Pica Roman;") {
		t.Errorf("approved.css:\n%s", css)
	}
	if ps := checkCSS("approved.css", css); len(ps) > 0 {
		t.Errorf("%s", problemsText(ps))
	}
}

// WA's filter removes ") {": the generated CSS must never contain it, with any theme.
func TestGeneratedCSSHasNoParenBrace(t *testing.T) {
	for _, th := range append(themes, Theme{}) {
		p := loadTestProject(t, "full.project.json")
		p.Theme = th.ID
		p.CustomCSS = CustomCSS{}
		files, ps := buildExport(p)
		if files == nil {
			t.Fatalf("%s: %s", th.ID, problemsText(ps))
		}
		for _, f := range []string{"style.css", "approved.css"} {
			if m := parenBraceRe.FindString(files[f]); m != "" {
				t.Errorf("theme %q: %s contains %q", th.ID, f, m)
			}
		}
	}
	for _, bad := range []string{".a li:nth-child(even) { color: red }", ".a:not(.b){ color: red }"} {
		if ps := checkCSS("style.css", bad); !strings.Contains(problemsText(ps), "put the { on a new line") {
			t.Errorf("not caught: %s", bad)
		}
	}
	if ps := checkCSS("style.css", ".a li:nth-child(even)\n{\n  color: red;\n}"); len(ps) != 0 {
		t.Errorf("{ on a new line is fine: %s", problemsText(ps))
	}
}

// WA's filter breaks a comma inside ( ) in a value (rgba, linear-gradient ...): the CSS check must say so.
func TestCheckCSSCatchesCommaInValue(t *testing.T) {
	for _, bad := range []string{"a { color: rgba(1, 2, 3, 0.5) ; }", "a { color: rgb(1,2,3) ; }", "a\n{\n  background: linear-gradient(red, blue) ;\n}"} {
		if ps := checkCSS("style.css", bad); !strings.Contains(problemsText(ps), "comma inside") {
			t.Errorf("not caught: %s", bad)
		}
	}
	for _, ok := range []string{"a { color: #80808040 ; background: var(--dark) ; }", ".a:is(.b, .c)\n{\n  color: red ;\n}", "a { color: rgb(1 2 3) ; }"} {
		if ps := checkCSS("style.css", ok); len(ps) != 0 {
			t.Errorf("fine, but reported: %s: %s", ok, problemsText(ps))
		}
	}
	if ps := checkCSS("approved.css", "a { background: linear-gradient(red, blue) ; }"); len(ps) != 0 {
		t.Errorf("approved.css may hold gradients: %s", problemsText(ps))
	}
	if ps := checkCSS("style.css", "a { background: linear-gradient(red, blue) ; }"); !strings.Contains(problemsText(ps), "linear-gradient") {
		t.Errorf("the function name should be in the message: %s", problemsText(ps))
	}
}
