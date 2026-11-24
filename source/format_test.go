package main

import (
	"strings"
	"testing"
)

// A table cell can have a width in % (default) or px, and a height in px.
func TestCellWidthUnitAndHeight(t *testing.T) {
	p := newProject()
	body := p.Root.Children[0].Children[0].Children[0].Children[1]
	body.Children = append(body.Children, &Node{ID: "t", Type: "table", Children: []*Node{
		{ID: "r", Type: "tr", Children: []*Node{
			{ID: "a", Type: "td", Props: map[string]any{"fmt": map[string]any{"width": 30.0}}},
			{ID: "b", Type: "td", Props: map[string]any{"fmt": map[string]any{"width": 240.0, "widthUnit": "px", "height": 48.0}}},
		}},
	}})
	files, ps := buildExport(p)
	if files == nil {
		t.Fatalf("export: %s", problemsText(ps))
	}
	css := files["style.css"]
	for _, want := range []string{"width: 30%;", "width: 240px;", "height: 48px;"} {
		if !strings.Contains(css, want) {
			t.Errorf("style.css misses %q\n%s", want, css)
		}
	}
	cell := body.Children[1].Children[0].Children[1]
	for what, fmtv := range map[string]map[string]any{
		"unknown unit":  {"width": 20.0, "widthUnit": "em"},
		"px too wide":   {"width": 5000.0, "widthUnit": "px"},
		"percent > 100": {"width": 150.0},
		"height 0":      {"height": 0.0},
		"height huge":   {"height": 9000.0},
	} {
		cell.Props["fmt"] = fmtv
		if _, ps := buildExport(p); !hasErrors(ps) {
			t.Errorf("%s: not refused", what)
		}
	}
	// Only cells have a height.
	cell.Props["fmt"] = map[string]any{}
	body.Props = map[string]any{"fmt": map[string]any{"height": 20.0}}
	if _, ps := buildExport(p); !strings.Contains(problemsText(ps), "only table cells have a height") {
		t.Errorf("a card body has no height: %q", problemsText(ps))
	}
}
