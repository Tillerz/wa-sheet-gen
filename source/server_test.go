package main

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const testToken = "test-token"

func testHandler(t *testing.T) http.Handler {
	t.Helper()
	web, err := fs.Sub(webFiles, "web")
	if err != nil {
		t.Fatal(err)
	}
	return newServer(testToken, web, filepath.Join(t.TempDir(), "settings.json"))
}

func do(t *testing.T, h http.Handler, method, target, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, "http://127.0.0.1:1234"+target, &buf)
	if token != "" {
		req.Header.Set("X-Token", token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestTokenRequired(t *testing.T) {
	h := testHandler(t)
	for _, tok := range []string{"", "wrong"} {
		if rec := do(t, h, "GET", "/api/project/new", tok, nil); rec.Code != http.StatusUnauthorized {
			t.Errorf("token %q: got %d, want 401", tok, rec.Code)
		}
	}
	if rec := do(t, h, "GET", "/api/project/new", testToken, nil); rec.Code != http.StatusOK {
		t.Errorf("valid token: got %d, want 200", rec.Code)
	}
}

func TestForeignHostRejected(t *testing.T) {
	h := testHandler(t)
	req := httptest.NewRequest("GET", "http://evil.example:1234/", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("got %d, want 403", rec.Code)
	}
}

func TestStaticFilesServed(t *testing.T) {
	h := testHandler(t)
	for _, path := range []string{"/", "/app.js", "/canvas.html", "/vendor/bootstrap.min.css"} {
		if rec := do(t, h, "GET", path, "", nil); rec.Code != http.StatusOK {
			t.Errorf("%s: got %d, want 200", path, rec.Code)
		}
	}
}

func TestNewSaveOpenRoundTrip(t *testing.T) {
	h := testHandler(t)
	rec := do(t, h, "GET", "/api/project/new", testToken, nil)
	var p Project
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	p.SheetName = "my-sheet"

	folder := filepath.Join(t.TempDir(), "new folder")
	rec = do(t, h, "POST", "/api/project/save", testToken, map[string]any{"folder": folder, "project": p})
	if rec.Code != http.StatusOK {
		t.Fatalf("save: got %d: %s", rec.Code, rec.Body)
	}
	if _, err := os.Stat(filepath.Join(folder, projectFile+".tmp")); !os.IsNotExist(err) {
		t.Errorf("temp file left behind")
	}

	rec = do(t, h, "POST", "/api/project/open", testToken, map[string]string{"folder": folder})
	if rec.Code != http.StatusOK {
		t.Fatalf("open: got %d: %s", rec.Code, rec.Body)
	}
	var got Project
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.SheetName != "my-sheet" || got.Version != projectVersion {
		t.Errorf("got sheet %q version %d", got.SheetName, got.Version)
	}
	card := got.Root.Children[0].Children[0].Children[0]
	if card.Type != "card" || card.Children[0].Children[0].Props["text"] != "Personal" {
		t.Errorf("start card wrong: %+v", card)
	}
	field := card.Children[1].Children[0]
	if field.Type != "field" || field.Props["name"] != "name" || field.Props["required"] != true {
		t.Errorf("mandatory name field lost: %+v", field)
	}
}

func TestSaveRejectsBadInput(t *testing.T) {
	h := testHandler(t)
	dir := t.TempDir()
	cases := map[string]map[string]any{
		"bad characters":  {"folder": dir, "project": Project{SheetName: "My Sheet", Root: &Node{Type: "container"}}},
		"banned word":     {"folder": dir, "project": Project{SheetName: "my-script", Root: &Node{Type: "container"}}},
		"no root":         {"folder": dir, "project": Project{SheetName: "ok"}},
		"relative folder": {"folder": "rel", "project": Project{SheetName: "ok", Root: &Node{Type: "container"}}},
	}
	for name, body := range cases {
		if rec := do(t, h, "POST", "/api/project/save", testToken, body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: got %d, want 400", name, rec.Code)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, projectFile)); !os.IsNotExist(err) {
		t.Errorf("a rejected save wrote a file")
	}
}

func TestOpenRejectsNewerVersion(t *testing.T) {
	dir := t.TempDir()
	data := `{"version": 99, "sheetName": "x", "root": {"id": "n1", "type": "container"}}`
	if err := os.WriteFile(filepath.Join(dir, projectFile), []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := loadProject(dir); err == nil || !strings.Contains(err.Error(), "newer version") {
		t.Errorf("got %v, want newer-version error", err)
	}
}

func TestFsList(t *testing.T) {
	h := testHandler(t)
	dir := t.TempDir()
	for _, d := range []string{"b-sheet", "A-plain", ".hidden"} {
		if err := os.Mkdir(filepath.Join(dir, d), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := saveProject(filepath.Join(dir, "b-sheet"), newProject()); err != nil {
		t.Fatal(err)
	}
	rec := do(t, h, "GET", "/api/fs/list?path="+url.QueryEscape(dir), testToken, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d: %s", rec.Code, rec.Body)
	}
	var l dirListing
	if err := json.Unmarshal(rec.Body.Bytes(), &l); err != nil {
		t.Fatal(err)
	}
	if len(l.Dirs) != 2 || l.Dirs[0].Name != "A-plain" || l.Dirs[1].Name != "b-sheet" {
		t.Fatalf("dirs: %+v", l.Dirs)
	}
	if l.Dirs[0].HasProject || !l.Dirs[1].HasProject {
		t.Errorf("hasProject wrong: %+v", l.Dirs)
	}
	if l.Parent == "" {
		t.Errorf("parent missing")
	}
}

func TestSheetNameRules(t *testing.T) {
	ok := []string{"nimble", "dccarl", "my-sheet-2"}
	bad := []string{"", "Nimble", "my_sheet", "-a", "a-", "a--b", "my sheet", "manuscript", "x-javascript"}
	for _, n := range ok {
		if err := validateSheetName(n); err != nil {
			t.Errorf("%q: unexpected error %v", n, err)
		}
	}
	for _, n := range bad {
		if err := validateSheetName(n); err == nil {
			t.Errorf("%q: expected an error", n)
		}
	}
}

func TestClassNameRules(t *testing.T) {
	ok := []string{"skills", "card-2", "hp"}
	bad := []string{"", "Skills", "2col", "my_card", "shield", "python", "desc-script", "a--b"}
	for _, n := range ok {
		if err := validateClassName(n); err != nil {
			t.Errorf("%q: unexpected error %v", n, err)
		}
	}
	for _, n := range bad {
		if err := validateClassName(n); err == nil {
			t.Errorf("%q: expected an error", n)
		}
	}
}

func TestFieldNameRules(t *testing.T) {
	ok := []string{"name", "hp_max", "att_value_001", "sk2"}
	bad := []string{"", "Name", "hp-max", "_hp", "hp_", "hp__max", "1hp", "description", "my field"}
	for _, n := range ok {
		if err := validateFieldName(n); err != nil {
			t.Errorf("%q: unexpected error %v", n, err)
		}
	}
	for _, n := range bad {
		if err := validateFieldName(n); err == nil {
			t.Errorf("%q: expected an error", n)
		}
	}
}

func TestLoadMigratesFieldsInRows(t *testing.T) {
	dir := t.TempDir()
	v1 := `{"version": 1, "sheetName": "old", "root": {"id": "n1", "type": "container", "children": [
	  {"id": "n2", "type": "row", "children": [{"id": "n3", "type": "col", "children": [
	    {"id": "n4", "type": "table", "children": [
	      {"id": "n5", "type": "tr", "children": [
	        {"id": "n6", "type": "field", "props": {"fieldType": "string", "name": "name", "label": "name", "required": true}},
	        {"id": "n7", "type": "field", "props": {"fieldType": "string", "name": "x", "label": ""}},
	        {"id": "n8", "type": "td"}
	      ]}
	    ]}
	  ]}]}
	]}}`
	if err := os.WriteFile(filepath.Join(dir, projectFile), []byte(v1), 0o644); err != nil {
		t.Fatal(err)
	}
	p, err := loadProject(dir)
	if err != nil {
		t.Fatal(err)
	}
	tr := p.Root.Children[0].Children[0].Children[0].Children[0]
	var types []string
	for _, c := range tr.Children {
		types = append(types, c.Type)
	}
	if strings.Join(types, ",") != "th,td,td,td" {
		t.Fatalf("cells: %v", types)
	}
	lbl := tr.Children[0].Children[0]
	if lbl.Type != "flabel" || lbl.Props["field"] != "n6" || lbl.ID != "n10" {
		t.Errorf("label: %+v", lbl)
	}
	if tr.Children[1].Children[0].ID != "n6" || tr.Children[2].Children[0].ID != "n7" {
		t.Errorf("fields not in td")
	}
	if p.Version != 2 {
		t.Errorf("version %d", p.Version)
	}
	if files, ps := buildExport(p); files == nil {
		t.Errorf("migrated project must export: %s", problemsText(ps))
	}
}

func TestSettingsRoundTrip(t *testing.T) {
	h := testHandler(t)
	rec := do(t, h, "GET", "/api/settings", testToken, nil)
	if rec.Code != 200 || strings.TrimSpace(rec.Body.String()) != "{}" {
		t.Fatalf("empty settings: %d %q", rec.Code, rec.Body)
	}
	rec = do(t, h, "PUT", "/api/settings", testToken, map[string]any{"recent": []string{"C:\\a"}, "canvasTheme": "light"})
	if rec.Code != 200 {
		t.Fatalf("put: %d %s", rec.Code, rec.Body)
	}
	rec = do(t, h, "GET", "/api/settings", testToken, nil)
	if !strings.Contains(rec.Body.String(), `"canvasTheme": "light"`) || !strings.Contains(rec.Body.String(), `C:\\a`) {
		t.Errorf("get: %s", rec.Body)
	}
	if rec := do(t, h, "PUT", "/api/settings", "", map[string]any{}); rec.Code != 401 {
		t.Errorf("settings need the token: %d", rec.Code)
	}
}

func TestAutosaveRoundTrip(t *testing.T) {
	h := testHandler(t)
	if rec := do(t, h, "GET", "/api/autosave", testToken, nil); strings.TrimSpace(rec.Body.String()) != "{}" {
		t.Fatalf("empty autosave: %q", rec.Body)
	}
	body := map[string]any{"folder": "C:\\x", "project": newProject(), "at": 123}
	if rec := do(t, h, "PUT", "/api/autosave", testToken, body); rec.Code != 200 {
		t.Fatalf("put: %d %s", rec.Code, rec.Body)
	}
	rec := do(t, h, "GET", "/api/autosave", testToken, nil)
	if !strings.Contains(rec.Body.String(), `"sheetName":"new-sheet"`) {
		t.Errorf("get: %s", rec.Body)
	}
	do(t, h, "DELETE", "/api/autosave", testToken, nil)
	if rec := do(t, h, "GET", "/api/autosave", testToken, nil); strings.TrimSpace(rec.Body.String()) != "{}" {
		t.Errorf("after delete: %q", rec.Body)
	}
}
