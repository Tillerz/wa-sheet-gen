package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var update = flag.Bool("update", false, "rewrite the golden files in testdata")

func loadTestProject(t *testing.T, name string) *Project {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	var p Project
	if err := json.Unmarshal(data, &p); err != nil {
		t.Fatal(err)
	}
	return &p
}

// TestExportGolden compares the export of testdata/full.project.json with testdata/full/.
// After a wanted change, run: go test -run TestExportGolden -update, then review the diff.
func TestExportGolden(t *testing.T) {
	files, problems := buildExport(loadTestProject(t, "full.project.json"))
	if files == nil {
		t.Fatalf("export failed: %+v", problems)
	}
	for _, name := range exportFiles {
		path := filepath.Join("testdata", "full", name)
		if *update {
			if err := os.WriteFile(path, []byte(files[name]), 0o644); err != nil {
				t.Fatal(err)
			}
			continue
		}
		want, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if files[name] != string(want) {
			t.Errorf("%s differs from the golden file.\n--- got ---\n%s", name, files[name])
		}
	}
}

func TestExportNewProject(t *testing.T) {
	files, problems := buildExport(newProject())
	if files == nil {
		t.Fatalf("a new sheet must export: %+v", problems)
	}
	if !strings.HasPrefix(files["import-to-wa.yml"], "fields:\n  name:\n") {
		t.Errorf("yaml start: %q", files["import-to-wa.yml"])
	}
}

func TestExportEscapesUserText(t *testing.T) {
	files, _ := buildExport(loadTestProject(t, "full.project.json"))
	view := files["basic-sheet.html.twig"]
	if strings.Contains(view, "{{ variables.x }}") || strings.Contains(view, "<b>") {
		t.Errorf("user text was not escaped")
	}
	form := files["edit-form.html.twig"]
	if !strings.Contains(form, `== 'It\'s far'`) || !strings.Contains(form, "value='It&#39;s far'") {
		t.Errorf("option with a quote was not escaped for twig and html")
	}
}

func problemsText(ps []Problem) string {
	var b strings.Builder
	for _, p := range ps {
		b.WriteString(p.Level + ": " + p.Message + "\n")
	}
	return b.String()
}

func TestValidationErrors(t *testing.T) {
	cases := map[string]struct {
		edit func(p *Project)
		want string
	}{
		"duplicate field": {func(p *Project) {
			body := p.Root.Children[0].Children[0].Children[0].Children[1]
			body.Children = append(body.Children, &Node{ID: "x", Type: "field", Props: map[string]any{"fieldType": "string", "name": "name", "label": "x"}})
		}, "two fields are named"},
		"bad nesting": {func(p *Project) {
			p.Root.Children = append(p.Root.Children, &Node{ID: "x", Type: "col"})
		}, "a col cannot be inside a container"},
		"name missing": {func(p *Project) {
			p.Root.Children[0].Children[0].Children[0].Children[1].Children = nil
		}, "\"name\" is missing"},
		"banned word in field": {func(p *Project) {
			body := p.Root.Children[0].Children[0].Children[0].Children[1]
			body.Children = append(body.Children, &Node{ID: "x", Type: "field", Props: map[string]any{"fieldType": "string", "name": "description", "label": "d"}})
		}, "filtered word"},
		"select without values": {func(p *Project) {
			body := p.Root.Children[0].Children[0].Children[0].Children[1]
			body.Children = append(body.Children, &Node{ID: "x", Type: "field", Props: map[string]any{"fieldType": "select", "name": "s", "label": "s"}})
		}, "no values"},
		"min over max": {func(p *Project) {
			body := p.Root.Children[0].Children[0].Children[0].Children[1]
			body.Children = append(body.Children, &Node{ID: "x", Type: "field", Props: map[string]any{"fieldType": "number", "name": "n", "label": "n", "min": 5.0, "max": 1.0}})
		}, "min is greater"},
		"image without id": {func(p *Project) {
			col := p.Root.Children[0].Children[0]
			col.Children = append(col.Children, &Node{ID: "x", Type: "image", Props: map[string]any{"imageId": ""}})
		}, "no WA image ID"},
		"card class sh": {func(p *Project) {
			p.Root.Children[0].Children[0].Children[0].Props["cls"] = "shield"
		}, "must not start with"},
		"css paren semicolon": {func(p *Project) { p.CustomCSS.Style = ".a { color: var(--x); }" }, "contains \");\""},
		"css quote":           {func(p *Project) { p.CustomCSS.Style = ".a { font-family: 'x' }" }, "quote"},
		"css percent":         {func(p *Project) { p.CustomCSS.Style = ".a { width: calc(50% - 2px) }" }, "% inside ( )"},
		"css sh class":        {func(p *Project) { p.CustomCSS.Style = ".shadow { color: red }" }, "must not start with sh or py"},
		"css banned word":     {func(p *Project) { p.CustomCSS.Approved = ".a { behavior: x }" }, "filtered word"},
		"css font list":       {func(p *Project) { p.CustomCSS.Style = ".a { font-family: Georgia, serif }" }, "only one font"},
		"bad font url":        {func(p *Project) { p.Fonts = []Font{{Name: "X", URL: "http://a b"}} }, "URL must start"},
		"bad color": {func(p *Project) {
			p.Root.Children[0].Children[0].Children[0].Props["fmt"] = map[string]any{"color": "rgb(10%, 0, 0)"}
		}, "use #rgb"},
		"bad align": {func(p *Project) {
			p.Root.Props = map[string]any{"fmt": map[string]any{"align": "middle"}}
		}, "unknown alignment"},
		"list style on wrong list": {func(p *Project) {
			col := p.Root.Children[0].Children[0]
			col.Children = append(col.Children, &Node{ID: "x", Type: "ul", Props: map[string]any{"fmt": map[string]any{"listStyle": "upper-roman"}},
				Children: []*Node{{ID: "y", Type: "li"}}})
		}, "does not fit a ul"},
		"list on a text": {func(p *Project) {
			p.Root.Children[0].Children[0].Children[0].Children[0].Children[0].Props["repeat"] = 3.0
		}, "cannot be a list"},
		"list too long": {func(p *Project) { p.Root.Children[0].Props = map[string]any{"repeat": 250.0} }, "up to entry 199"},
		"list start too high": {func(p *Project) {
			p.Root.Children[0].Props = map[string]any{"repeat": 20.0, "repeatStart": 190.0}
		}, "this one: 190 to 209"},
		"list in list": {func(p *Project) {
			p.Root.Children[0].Props = map[string]any{"repeat": 2.0}
			p.Root.Children[0].Children[0].Props["repeat"] = 2.0
		}, "inside another list"},
		"name in list": {func(p *Project) { p.Root.Children[0].Props = map[string]any{"repeat": 2.0} }, "cannot be inside a list"},
		"list name clash": {func(p *Project) {
			body := p.Root.Children[0].Children[0].Children[0].Children[1]
			body.Children = append(body.Children, &Node{ID: "x", Type: "field", Props: map[string]any{"fieldType": "string", "name": "hp_002", "label": "x"}})
			p.Root.Children = append(p.Root.Children, &Node{ID: "r", Type: "row", Props: map[string]any{"repeat": 3.0}, Children: []*Node{
				{ID: "c", Type: "col", Children: []*Node{{ID: "f", Type: "field", Props: map[string]any{"fieldType": "string", "name": "hp", "label": "hp"}}}}}})
		}, "\"hp_002\" is used twice"},
		"width on a card": {func(p *Project) {
			p.Root.Children[0].Children[0].Children[0].Props["fmt"] = map[string]any{"width": 50.0}
		}, "only table cells"},
		"preset outside a list": {func(p *Project) {
			body := p.Root.Children[0].Children[0].Children[0].Children[1]
			body.Children = append(body.Children, &Node{ID: "x", Type: "field", Props: map[string]any{"fieldType": "string", "name": "s", "label": "s", "preset": []any{"a"}}})
		}, "only work inside a list"},
		"preset on a number": {func(p *Project) {
			p.Root.Children = append(p.Root.Children, &Node{ID: "r", Type: "row", Props: map[string]any{"repeat": 2.0}, Children: []*Node{
				{ID: "c", Type: "col", Children: []*Node{{ID: "f", Type: "field", Props: map[string]any{"fieldType": "number", "name": "n", "label": "n", "preset": []any{"1"}}}}}}})
		}, "only string fields"},
		"bad size": {func(p *Project) {
			p.Root.Props = map[string]any{"fmt": map[string]any{"size": 500.0}}
		}, "size must be"},
	}
	for name, c := range cases {
		p := newProject()
		c.edit(p)
		files, ps := buildExport(p)
		if files != nil {
			t.Errorf("%s: export should fail", name)
		}
		if !strings.Contains(problemsText(ps), c.want) {
			t.Errorf("%s: want %q in:\n%s", name, c.want, problemsText(ps))
		}
	}
}

func TestValidationWarningsDoNotBlock(t *testing.T) {
	p := newProject()
	p.Root.Children = append(p.Root.Children, &Node{ID: "x", Type: "row"})
	files, ps := buildExport(p)
	if files == nil {
		t.Fatalf("warnings must not block: %s", problemsText(ps))
	}
	if !strings.Contains(problemsText(ps), "warning: a row has no cols") {
		t.Errorf("missing warning: %s", problemsText(ps))
	}
}

func TestCheckHTMLFindsScript(t *testing.T) {
	for _, s := range []string{"<script>x</script>", "<a href='javascript:x'>", "<div onclick='x'>"} {
		if len(checkHTML("f", s)) == 0 {
			t.Errorf("not caught: %s", s)
		}
	}
	if len(checkHTML("f", "<div class='x'>on hand= 3</div>")) != 0 {
		t.Errorf("plain text with on…= is fine")
	}
}

func TestExportAPI(t *testing.T) {
	h := testHandler(t)
	dir := t.TempDir()
	rec := do(t, h, "POST", "/api/export", testToken, map[string]any{"folder": dir, "project": newProject()})
	if rec.Code != 200 {
		t.Fatalf("export: %d %s", rec.Code, rec.Body)
	}
	for _, name := range exportFiles {
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		if len(data) >= 3 && string(data[:3]) == "\xef\xbb\xbf" {
			t.Errorf("%s starts with a BOM", name)
		}
	}
	bad := newProject()
	bad.SheetName = "Bad Name"
	rec = do(t, h, "POST", "/api/export", testToken, map[string]any{"folder": t.TempDir(), "project": bad})
	if rec.Code != 422 || !strings.Contains(rec.Body.String(), "problems") {
		t.Errorf("bad project: %d %s", rec.Code, rec.Body)
	}
	rec = do(t, h, "POST", "/api/check", testToken, map[string]any{"project": bad})
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "sheet name") {
		t.Errorf("check: %d %s", rec.Code, rec.Body)
	}
}

func TestFontNotInListIsWarning(t *testing.T) {
	p := newProject()
	p.Root.Props = map[string]any{"fmt": map[string]any{"font": "Grenze"}}
	files, ps := buildExport(p)
	if files == nil || !strings.Contains(problemsText(ps), "warning: font \"Grenze\" is not in the font list") {
		t.Errorf("want a warning, got: %s", problemsText(ps))
	}
}

func TestPreviewAPI(t *testing.T) {
	h := testHandler(t)
	p := loadTestProject(t, "full.project.json")
	rec := do(t, h, "POST", "/api/preview", testToken, map[string]any{"project": p})
	if rec.Code != 200 {
		t.Fatalf("preview: %d %s", rec.Code, rec.Body)
	}
	var res struct {
		CSS     string            `json:"css"`
		Classes map[string]string `json:"classes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.Classes["n4"] != "f-1" || res.Classes["n15"] != res.Classes["n28"] {
		t.Errorf("classes: %+v", res.Classes)
	}
	if !strings.Contains(res.CSS, "@font-face") || !strings.Contains(res.CSS, ".block-test-sheet .f-1") {
		t.Errorf("css: %s", res.CSS)
	}
}

// A long list split over two cards: same field names, ranges 1..20 and 21..40.
func TestSplitListSharesFieldNames(t *testing.T) {
	p := newProject()
	card := func(id string, start float64) *Node {
		return &Node{ID: id, Type: "col", Props: map[string]any{"col": 6.0, "repeat": 20.0, "repeatStart": start}, Children: []*Node{
			{ID: id + "f", Type: "field", Props: map[string]any{"fieldType": "string", "name": "weapon", "label": "Weapon"}}}}
	}
	p.Root.Children = append(p.Root.Children, &Node{ID: "r", Type: "row", Children: []*Node{card("a", 1), card("b", 21)}})
	files, ps := buildExport(p)
	if files == nil {
		t.Fatalf("split list must export: %s", problemsText(ps))
	}
	if !strings.Contains(files["basic-sheet.html.twig"], "{% for i in 21..40 %}") {
		t.Errorf("second loop range missing")
	}
	yaml := files["import-to-wa.yml"]
	for _, want := range []string{"  weapon_001:", "  weapon_020:", "  weapon_021:", "  weapon_040:"} {
		if !strings.Contains(yaml, want) {
			t.Errorf("yaml misses %q", want)
		}
	}
	if strings.Count(yaml, "  weapon_021:") != 1 {
		t.Errorf("weapon_021 written twice")
	}
	sheet, _ := previewHTML(p)
	if strings.Count(sheet, "var-weapon") != 40 || !strings.Contains(sheet, "Sample Weapon 40") {
		t.Errorf("preview should show 40 weapons")
	}
	// overlapping ranges clash
	p.Root.Children[1].Children[1].Props["repeatStart"] = 15.0
	if _, ps := buildExport(p); !strings.Contains(problemsText(ps), "\"weapon_015\" is used twice") {
		t.Errorf("overlap not reported: %s", problemsText(ps))
	}
}

func TestPresetFewerValuesIsWarning(t *testing.T) {
	p := newProject()
	p.Root.Children = append(p.Root.Children, &Node{ID: "r", Type: "row", Props: map[string]any{"repeat": 3.0}, Children: []*Node{
		{ID: "c", Type: "col", Children: []*Node{{ID: "f", Type: "field", Props: map[string]any{"fieldType": "string", "name": "s", "label": "s", "preset": []any{"a", "b"}}}}}}})
	files, ps := buildExport(p)
	if files == nil || !strings.Contains(problemsText(ps), "warning: field \"s\" has 2 preset values, but its list goes up to entry 3") {
		t.Errorf("want a warning: %s", problemsText(ps))
	}
}

// A list split over three cards shares one list of preset values, counted by entry number.
func TestPresetSplitList(t *testing.T) {
	p := newProject()
	vals := []any{}
	for i := 1; i <= 30; i++ {
		vals = append(vals, fmt.Sprintf("Skill %d", i))
	}
	card := func(id string, start float64) *Node {
		return &Node{ID: id, Type: "col", Props: map[string]any{"repeat": 10.0, "repeatStart": start}, Children: []*Node{
			{ID: id + "f", Type: "field", Props: map[string]any{"fieldType": "string", "name": "skill", "label": "", "preset": vals}}}}
	}
	p.Root.Children = append(p.Root.Children, &Node{ID: "r", Type: "row", Children: []*Node{card("a", 1), card("b", 11), card("c", 21)}})
	files, ps := buildExport(p)
	if files == nil {
		t.Fatalf("export: %s", problemsText(ps))
	}
	if strings.Contains(files["basic-sheet.html.twig"], "[i - 11]") {
		t.Errorf("the second card must count by entry number")
	}
	sheet, _ := previewHTML(p)
	for _, want := range []string{">Skill 1<", ">Skill 10<", ">Skill 11<", ">Skill 20<", ">Skill 21<", ">Skill 30<"} {
		if !strings.Contains(sheet, want) {
			t.Errorf("preview misses %q", want)
		}
	}
	if strings.Count(sheet, ">Skill 1<") != 1 {
		t.Errorf("Skill 1 shown more than once")
	}
}

// Value text formats also style the form input (with !important, because WA's dark mode
// sets input colors with !important); the Input look comes later, so it wins.
func TestValueFormatsReachTheInput(t *testing.T) {
	files, _ := buildExport(loadTestProject(t, "full.project.json"))
	css := files["style.css"]
	sel := ".block-test-sheet input.ivar-level,\n.block-test-sheet textarea.ivar-level,\n.block-test-sheet select.ivar-level\n{\n"
	valueText := strings.Index(css, sel+"  text-align: right !important;")
	inputLook := strings.Index(css, sel+"  background-color: #ffffff !important;")
	if valueText < 0 || inputLook < 0 || valueText > inputLook {
		t.Errorf("value text rule %d must come before the input look rule %d:\n%s", valueText, inputLook, css)
	}
}
