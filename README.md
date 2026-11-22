# WA Sheet Generator

[![tests](https://github.com/Tillerz/wa-sheet-gen/actions/workflows/test.yml/badge.svg)](https://github.com/Tillerz/wa-sheet-gen/actions/workflows/test.yml)

A small Windows app to design **character sheets and stat blocks for [World Anvil](https://www.worldanvil.com)** by drag and drop, and export the five files World Anvil needs.

You build the sheet visually. The app writes clean Twig, CSS and YAML that pass World Anvil's security filter.

<!-- TODO: add a screenshot, e.g. docs/screenshot.png -->

## Features

- **Visual editor**: drag rows, cols, cards, tables, lists, texts and images into the sheet. Bootstrap 5 grid with col widths for small, medium and large screens.
- **All World Anvil field types**: text, number, text area, checkbox, dropdown, text with suggestions, and WA image ID.
- **Tables made for sheets**: drop a field into a cell, and its label lands in a `th`, its input in the next `td`.
- **Lists**: repeat a row, col, card, table row or list item N times. It is exported once inside a Twig loop, and fields become `skill_001`, `skill_002`, …, like hand-made WA sheets.
- **Formatting without code**: alignment, bold, italic, underline, colors, font sizes, fonts, borders, radius, backgrounds and bullet styles. Everything goes into CSS classes, so you can still adjust the look in the CSS later.
- **Custom fonts and custom CSS**: fonts load directly from a font file URL into `approved.css`.
- **Previews**: see the sheet and the edit form as World Anvil shows them, with sample data.
- **Built-in checks for World Anvil's rules**: no `);`, no quotes or `%` inside `( )` in CSS, no class names starting with `sh` or `py`, no filtered words like `script`, no JavaScript, unique field names. The export stops with a clear list of problems.
- **Undo / redo**, keyboard shortcuts, recent sheets, light and dark mode.
- **Small and private**: one `.exe`, no installer, no account, no internet needed (except to load your own font URLs in the preview).

## What it exports

| File | Content |
| --- | --- |
| `import-to-wa.yml` | the field definitions |
| `basic-sheet.html.twig` | the sheet view |
| `edit-form.html.twig` | the form to enter data |
| `style.css` | all styles |
| `approved.css` | font definitions and CSS that only the approved field may hold (e.g. gradients) |

Your design is saved as `project.json` in the same folder, so you can open and change it later.

## Install

**Requirements:** Windows 10 or 11 and a modern browser (tested with Microsoft Edge; Chrome should work the same).

1. Download `wa-sheet-gen.exe` from the [Releases](../../releases) page. <!-- TODO: no release published yet -->
2. Put it in any folder and double-click it.
3. A console window opens and the editor opens in your browser. Close the console window to quit.

Windows SmartScreen may warn the first time, because the app is not signed. Choose "More info" → "Run anyway".

## Quick start

1. A new sheet starts with a "Personal" card and the required `name` field.
2. Set the **sheet name** on the right. The root class becomes `block-<sheet-name>`.
3. Drag elements from the left into the sheet. Double-click texts and labels to edit them. Right-click for more actions.
4. Select an element to change its settings and its format on the right.
5. Use **Sheet** and **Form** above the canvas to preview.
6. Click **Export**. The app checks the sheet, saves it, and writes the five files into the sheet's folder.
7. In World Anvil, paste the files into your sheet template.

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+S / Ctrl+Shift+S | save / save as |
| Ctrl+Z / Ctrl+Y | undo / redo |
| Ctrl+D | duplicate the selected element |
| Delete | delete the selected element |
| Esc | clear the selection |

## How it works

The app is one Go program. It starts a small web server on `127.0.0.1` (your own PC only) with a random port and a secret key, and opens the editor in your browser. The editor is plain HTML, CSS and JavaScript, with no third-party JavaScript libraries.

Settings like recent sheets are stored in `%AppData%\wa-sheet-gen\settings.json`.

## Build from source

You need [Go](https://go.dev) 1.27 or newer.

```bash
cd source
GOOS=windows GOARCH=amd64 go build -o ../wa-sheet-gen.exe .
```

On Windows itself, `go build -o ..\wa-sheet-gen.exe .` inside `source` is enough.

### Tests

```bash
cd source && go test ./...                     # generator, checks, server
node --test source/webtest/*.test.mjs          # editor model (Node 22+, run from the repo root)
```

The export is pinned by golden files in `source/testdata/full/`. After a wanted change to the output:

```bash
cd source && go test -run TestExportGolden -update
```

Then review the diff before you commit.

### Project layout

```
bible.md            design document: all rules and decisions
source/             Go server, generator and checks
source/web/         the editor (embedded into the .exe)
source/testdata/    sample project and expected export
source/webtest/     tests for the editor model
examples/           hand-made WA sheets used as reference
```

## Credits

- [Bootstrap 5.0.1](https://getbootstrap.com) CSS (MIT license) is embedded for the canvas.
- Made for the [World Anvil](https://www.worldanvil.com) community. This project is not affiliated with World Anvil.

## License

<!-- TODO: choose a license (e.g. MIT) and add a LICENSE file. -->
Not decided yet.
