package main

import (
	"encoding/json"
	"flag"
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
		"bad font url":        {func(p *Project) { p.Fonts = []Font{{Name: "X", URL: "http://a b"}} }, "URL must start"},
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
