package main

import (
	"fmt"
	"strings"
)

// Sheet themes (bible 7): a short CSS block at the start of style.css. Formats and custom
// CSS come later in the file and override it. All themes share one template, so they all
// style the same parts. Fonts are system fonts with a generic fallback (no font files),
// colors are hex only (WA filter: no quotes, no % inside ( ), no ");").
type Theme struct {
	ID, Name, Desc string

	Bg, Text, SheetBorder string
	Radius                int
	BodyFont, HeaderFont  string
	CardBg, CardBorder    string
	HeaderBg, HeaderText  string
	HeaderUpper           bool
	Label, Value          string
	LabelStyle            string // "upper" or "smallcaps"
	InputBg, InputText    string
	InputBorder           string
	TableBorder, Stripe   string
	Fonts                 []string // library fonts (fontlib.go) the theme uses; added to approved.css
}

var themes = []Theme{
	{ID: "cozy-fantasy", Name: "Cozy Fantasy", Desc: "warm parchment, brown leather, serif",
		Bg: "#f5ead6", Text: "#3d2b1f", SheetBorder: "3px double #a67c52", Radius: 10,
		BodyFont: "Georgia, Cambria, serif", HeaderFont: "Grenze, Georgia, serif",
		CardBg: "#fbf3e4", CardBorder: "#c9a678", HeaderBg: "#8b5a2b", HeaderText: "#fff3dc",
		Label: "#8b5a2b", Value: "#2e1f14", LabelStyle: "smallcaps",
		InputBg: "#fffaf0", InputText: "#3d2b1f", InputBorder: "#c9a678", TableBorder: "#d9c09a", Fonts: []string{"Grenze"}, Stripe: "#f0e2c8"},
	{ID: "elegant-medieval", Name: "Elegant Medieval", Desc: "ivory, deep red and gold, book serif",
		Bg: "#f2eee3", Text: "#2a1d1a", SheetBorder: "4px double #7a1f1f", Radius: 2,
		BodyFont: "IM Fell Double Pica Roman, Palatino Linotype, Book Antiqua, serif", HeaderFont: "IM Fell English SC, Palatino Linotype, serif",
		CardBg: "#faf7ef", CardBorder: "#b8963e", HeaderBg: "#5c1414", HeaderText: "#e9d49a", HeaderUpper: true,
		Label: "#7a1f1f", Value: "#2a1d1a", LabelStyle: "upper",
		InputBg: "#fffdf7", InputText: "#2a1d1a", InputBorder: "#b8963e", TableBorder: "#d6c49a", Fonts: []string{"IM Fell English SC", "IM Fell Double Pica Roman"}, Stripe: "#efe8d6"},
	{ID: "druid-grove", Name: "Druid Grove", Desc: "soft greens, moss and bark",
		Bg: "#eef3e6", Text: "#22311f", SheetBorder: "3px solid #5b7a3a", Radius: 14,
		BodyFont: "Alegreya Regular, Georgia, serif", HeaderFont: "Amarante, Georgia, serif",
		CardBg: "#f7faf1", CardBorder: "#9bb57a", HeaderBg: "#3f5f2a", HeaderText: "#eef6dc",
		Label: "#4d6b30", Value: "#1f2a1b", LabelStyle: "smallcaps",
		InputBg: "#fbfdf6", InputText: "#22311f", InputBorder: "#9bb57a", TableBorder: "#c3d4a8", Fonts: []string{"Amarante", "Alegreya Regular"}, Stripe: "#e7eedb"},
	{ID: "steampunk", Name: "Steampunk", Desc: "dark leather, brass and copper",
		Bg: "#2a2018", Text: "#ecdcb8", SheetBorder: "3px solid #b5893b", Radius: 8,
		BodyFont: "Georgia, Cambria, serif", HeaderFont: "Eczar Bold, Georgia, serif",
		CardBg: "#362a1f", CardBorder: "#8f6a2e", HeaderBg: "#6e4a22", HeaderText: "#f5e2b0", HeaderUpper: true,
		Label: "#d4a95a", Value: "#f3e6c8", LabelStyle: "upper",
		InputBg: "#2f251b", InputText: "#f3e6c8", InputBorder: "#8f6a2e", TableBorder: "#5c452a", Fonts: []string{"Eczar Bold"}, Stripe: "#45362a"},
	{ID: "horror", Name: "Horror", Desc: "near black, dried blood, old serif",
		Bg: "#110c0c", Text: "#d8ccc4", SheetBorder: "2px solid #4a0b0b", Radius: 4,
		BodyFont: "Georgia, Times New Roman, serif", HeaderFont: "IM Fell Great Primer SC, Georgia, serif",
		CardBg: "#191111", CardBorder: "#5a1414", HeaderBg: "#2e0606", HeaderText: "#e6c9b8",
		Label: "#b23a3a", Value: "#e2d6cd", LabelStyle: "smallcaps",
		InputBg: "#1d1414", InputText: "#e2d6cd", InputBorder: "#5a1414", TableBorder: "#3d1a1a", Fonts: []string{"IM Fell Great Primer SC"}, Stripe: "#261a1a"},
	{ID: "sci-fi-space", Name: "Sci-Fi Space", Desc: "deep navy, cool cyan, clean sans",
		Bg: "#0b1224", Text: "#d7e3ff", SheetBorder: "1px solid #3a6bd1", Radius: 12,
		BodyFont: "PT Sans Narrow, Bahnschrift, Segoe UI, sans-serif", HeaderFont: "Orbitron, Bahnschrift, sans-serif",
		CardBg: "#111b36", CardBorder: "#2a4785", HeaderBg: "#18295a", HeaderText: "#8fd8ff", HeaderUpper: true,
		Label: "#7fa6e6", Value: "#eef4ff", LabelStyle: "upper",
		InputBg: "#0e1730", InputText: "#d7e3ff", InputBorder: "#2f4f93", TableBorder: "#26407a", Fonts: []string{"Orbitron", "PT Sans Narrow"}, Stripe: "#1a2a52"},
	{ID: "sci-fi-cyberpunk", Name: "Sci-Fi Cyberpunk", Desc: "black, neon cyan, violet and yellow, a touch of pink, mono",
		Bg: "#0a0a10", Text: "#e4e8f2", SheetBorder: "2px solid #00f0ff", Radius: 0,
		BodyFont: "Consolas, Lucida Console, Courier New, monospace", HeaderFont: "Teko Regular, Bahnschrift, sans-serif",
		CardBg: "#10121c", CardBorder: "#8a2be2", HeaderBg: "#0e1c26", HeaderText: "#00f0ff", HeaderUpper: true,
		Label: "#f8e71c", Value: "#e4e8f2", LabelStyle: "upper",
		InputBg: "#0d0f18", InputText: "#39ff14", InputBorder: "#ff2bd6", TableBorder: "#2a3550", Fonts: []string{"Teko Regular"}, Stripe: "#1a1d2e"},
	{ID: "clean-modern", Name: "Clean Modern", Desc: "white, light grey, simple sans",
		Bg: "#ffffff", Text: "#1f2430", SheetBorder: "1px solid #d9dde5", Radius: 12,
		BodyFont: "Segoe UI, Helvetica, Arial, sans-serif", HeaderFont: "Segoe UI, Helvetica, Arial, sans-serif",
		CardBg: "#ffffff", CardBorder: "#e3e6ec", HeaderBg: "#f3f5f9", HeaderText: "#1f2430",
		Label: "#6b7280", Value: "#111827", LabelStyle: "upper",
		InputBg: "#ffffff", InputText: "#111827", InputBorder: "#cfd5df", TableBorder: "#e3e6ec", Stripe: "#f6f7fa"},
	{ID: "clean-modern-dark", Name: "Clean Modern (dark)", Desc: "dark grey, soft blue accents, simple sans",
		Bg: "#16181d", Text: "#e3e6ec", SheetBorder: "1px solid #2c313a", Radius: 12,
		BodyFont: "Segoe UI, Helvetica, Arial, sans-serif", HeaderFont: "Segoe UI, Helvetica, Arial, sans-serif",
		CardBg: "#1d2027", CardBorder: "#2f343e", HeaderBg: "#252a33", HeaderText: "#f1f3f7",
		Label: "#8d96a7", Value: "#f5f7fa", LabelStyle: "upper",
		InputBg: "#14161b", InputText: "#f5f7fa", InputBorder: "#3a404b", TableBorder: "#2f343e", Stripe: "#22262e"},
}

func findTheme(id string) *Theme {
	for i := range themes {
		if themes[i].ID == id {
			return &themes[i]
		}
	}
	return nil
}

// themeCSS writes the theme for the sheet root class root (e.g. ".block-nimble").
// Selectors stay at most as specific as format rules (two classes), so formats win;
// the stripes only set Bootstrap's table variable, so a cell color set by the user wins.
func themeCSS(t *Theme, root string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "/* Theme: %s */\n", t.Name)
	rule := func(sel string, decls ...string) { cssRule(&b, sel, decls) }
	rule(root,
		"background-color: "+t.Bg,
		"color: "+t.Text,
		"font-family: "+t.BodyFont,
		"border: "+t.SheetBorder,
		fmt.Sprintf("border-radius: %dpx", t.Radius),
		"padding: 16px")
	rule(root+" .card",
		"background-color: "+t.CardBg,
		"color: "+t.Text,
		"border: 1px solid "+t.CardBorder,
		fmt.Sprintf("border-radius: %dpx", t.Radius/2),
		"margin-bottom: 12px")
	header := []string{
		"background-color: " + t.HeaderBg,
		"color: " + t.HeaderText,
		"font-family: " + t.HeaderFont,
		"font-weight: 600",
		"border-bottom: 1px solid " + t.CardBorder,
	}
	if t.HeaderUpper {
		header = append(header, "text-transform: uppercase", "letter-spacing: 0.08em")
	}
	rule(root+" .card-header", header...)
	label := []string{"color: " + t.Label, "font-size: 0.85em"}
	if t.LabelStyle == "upper" {
		label = append(label, "text-transform: uppercase", "letter-spacing: 0.06em")
	} else {
		label = append(label, "font-variant: small-caps", "letter-spacing: 0.03em")
	}
	rule(root+" .lbl, "+root+" .ilbl", label...)
	rule(root+" .var", "color: "+t.Value)
	rule(root+" .form-control",
		"background-color: "+t.InputBg,
		"color: "+t.InputText,
		"border-color: "+t.InputBorder)
	rule(root+" .table", "color: "+t.Text, "border-color: "+t.TableBorder)
	rule(root+" .table tr:nth-child(even)", "--bs-table-bg: "+t.Stripe)
	rule(root+" :where(ul, ol) > :where(li:nth-child(even))", "background-color: "+t.Stripe)
	return b.String()
}
