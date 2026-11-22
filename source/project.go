package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	projectVersion = 2
	projectFile    = "project.json"
)

// Node is one element of the sheet layout tree.
type Node struct {
	ID       string         `json:"id"`
	Type     string         `json:"type"`
	Props    map[string]any `json:"props,omitempty"`
	Children []*Node        `json:"children,omitempty"`
}

type Font struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type CustomCSS struct {
	Style    string `json:"style"`
	Approved string `json:"approved"`
}

// Project is the content of project.json, the source of truth for a sheet.
type Project struct {
	Version   int       `json:"version"`
	SheetName string    `json:"sheetName"`
	Fonts     []Font    `json:"fonts"`
	Theme     string    `json:"theme,omitempty"` // id of a sheet theme (themes.go), or empty
	CustomCSS CustomCSS `json:"customCss"`
	Root      *Node     `json:"root"`
}

// newProject returns a sheet with a useful start: row > col > card "Personal" > name field.
func newProject() *Project {
	return &Project{
		Version:   projectVersion,
		SheetName: "new-sheet",
		Fonts:     []Font{},
		Root: &Node{ID: "n1", Type: "container", Children: []*Node{
			{ID: "n2", Type: "row", Children: []*Node{
				{ID: "n3", Type: "col", Props: map[string]any{"col": 12}, Children: []*Node{
					{ID: "n4", Type: "card", Props: map[string]any{}, Children: []*Node{
						{ID: "n5", Type: "card-header", Children: []*Node{
							{ID: "n6", Type: "text", Props: map[string]any{"text": "Personal"}},
						}},
						{ID: "n7", Type: "card-body", Children: []*Node{
							{ID: "n8", Type: "field", Props: map[string]any{
								"fieldType": "string",
								"name":      "name",
								"label":     "name",
								"required":  true,
							}},
						}},
					}},
				}},
			}},
		}},
	}
}

func loadProject(folder string) (*Project, error) {
	data, err := os.ReadFile(filepath.Join(folder, projectFile))
	if err != nil {
		return nil, err
	}
	var p Project
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, fmt.Errorf("%s is not a valid project file: %w", projectFile, err)
	}
	if p.Version > projectVersion {
		return nil, fmt.Errorf("%s was made by a newer version of this app (file version %d, app version %d)", projectFile, p.Version, projectVersion)
	}
	if p.Root == nil || p.Root.Type != "container" {
		return nil, errors.New(projectFile + " has no sheet root")
	}
	if p.Version < 2 {
		migrateFieldsInRows(p.Root)
		p.Version = 2
	}
	return &p, nil
}

// migrateFieldsInRows converts version 1 projects: there a field sat directly in a
// table row and stood for two cells. From version 2 on, the row holds a label cell
// (th with a field label) and a value cell (td with the field).
func migrateFieldsInRows(root *Node) {
	next := maxNodeID(root) + 1
	newID := func() string {
		id := fmt.Sprintf("n%d", next)
		next++
		return id
	}
	var walk func(n *Node)
	walk = func(n *Node) {
		if n.Type == "tr" {
			var cells []*Node
			for _, c := range n.Children {
				if c.Type != "field" {
					cells = append(cells, c)
					continue
				}
				if strings.TrimSpace(propString(c, "label")) != "" {
					cells = append(cells, &Node{ID: newID(), Type: "th", Children: []*Node{
						{ID: newID(), Type: "flabel", Props: map[string]any{"field": c.ID}},
					}})
				}
				cells = append(cells, &Node{ID: newID(), Type: "td", Children: []*Node{c}})
			}
			n.Children = cells
		}
		for _, c := range n.Children {
			walk(c)
		}
	}
	walk(root)
}

func maxNodeID(n *Node) int {
	max := 0
	if v, err := strconv.Atoi(strings.TrimPrefix(n.ID, "n")); err == nil && strings.HasPrefix(n.ID, "n") {
		max = v
	}
	for _, c := range n.Children {
		if m := maxNodeID(c); m > max {
			max = m
		}
	}
	return max
}

func saveProject(folder string, p *Project) error {
	if err := validateSheetName(p.SheetName); err != nil {
		return err
	}
	if p.Root == nil || p.Root.Type != "container" {
		return errors.New("project has no sheet root")
	}
	p.Version = projectVersion
	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(folder, 0o755); err != nil {
		return err
	}
	// Write to a temp file first so a failed write never destroys the old file.
	tmp := filepath.Join(folder, projectFile+".tmp")
	if err := os.WriteFile(tmp, append(data, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(folder, projectFile))
}
