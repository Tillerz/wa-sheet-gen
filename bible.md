# World Anvil Sheet Generator — Design Document

## 1. Goal

A standalone Windows app to design World Anvil (WA) character sheets / stat blocks visually and export the five files WA needs:

| File | Content |
| --- | --- |
| `approved.css` | `@font-face` definitions only |
| `style.css` | all other CSS |
| `import-to-wa.yml` | field (data) definitions |
| `basic-sheet.html.twig` | view: shows a sheet with its saved data |
| `edit-form.html.twig` | form: lets the user enter data |

The app's own project file is the source of truth. The five WA files are an **export**, generated from it.

## 2. Folders

- `source/` — app code
- `examples/` — working example sheets, one per subfolder (`nimble`, `dccarl`, `daggerheart`). Use them as the reference for every generated pattern.

## 3. Hard WA rules (the export must follow all of them)

### 3.1 CSS

- All CSS goes into the two CSS files. No `style=` attributes and no `<style>` in the twig files.
- `approved.css` contains only `@font-face` blocks. Fonts load directly from a font file URL (`.woff2`, `.otf`, …). No `@import`, no external CSS files.
- No class name may start with `sh` or `py` (selector `.sh…` / `.py…`). See open question Q1.
- The sequence `);` must never appear. The WA security filter removes it. Fix: put a space between, e.g. `var(--dark) ;`. The generator does this automatically wherever needed.
- No `'` and no `"` anywhere in CSS files. Font names with spaces go unquoted (`font-family: IM Fell English SC`).
- No `%` inside `( )`. So no `rgb(10%, …)`, no `calc(50% …)`. Colors are written as hex (`#a000a0`) or WA theme variables (`var(--dark)`, `var(--light)`).

### 3.2 YAML (`import-to-wa.yml`)

- First line is always `fields:`.
- Indent: 2 spaces. No tabs.
- No duplicate keys. The exporter refuses to write a file with duplicates.
- String values in double quotes (`label: "hp max"`).

### 3.3 Twig / HTML

- Generated HTML uses single quotes for attributes, like the examples.
- Data is read as `{{variables.<field_name>|default}}`.
- The root element is always:

  ```html
  <div class='container-fluid sheet-<sheetname>'>
  </div>
  ```

  `<sheetname>` follows the class naming rule (3.4).
- Element `id`s must be unique. The generator only writes ids where needed (form inputs, `label for=`). The examples reuse ids like `card-personal`. Do not copy that.
- Font Awesome icons (`fa-solid`, `fa-regular`) are available on WA. The examples use them.

### 3.4 Naming

| Thing | Rule | Example |
| --- | --- | --- |
| Field name | lowercase `a-z`, `0-9`, `_` only; starts with a letter; no `__`, no `_` at start or end | `hp_max` |
| Class name for a field | field name with `_` → `-` | `hp-max` |
| YAML key | field name with `_` → space (as in all examples). See Q2. | `hp max` |
| Twig variable | field name | `variables.hp_max` |
| Sheet name | lowercase `a-z`, `0-9`, `-` | `sheet-nimble` |

The app derives the field name from the label as you type (`HP Max` → `hp_max`). You can override it, but it must pass the rule. Field names must be unique in a sheet.

## 4. Fields

### 4.1 Mandatory field

Every sheet has a field `name` (type string, `required: true`). You cannot delete it. You can move it and change its label.

### 4.2 Field types

All types found in the three examples:

| Type | YAML | Form (edit-form) | Sheet (basic-sheet) |
| --- | --- | --- | --- |
| **String** | `input: string` | `<input type='text'>` | `{{variables.x\|default}}` |
| **Number** | `input: integer`, optional `min:` | `<input type='number'>` (+ `min=`) | `{{variables.x\|default}}` |
| **Text area** | `input: text`, `rows: N` (default 3) | `<textarea rows='N'>` | `{{variables.x\|default\|nl2br}}` |
| **Checkbox** | `input: checkbox` | hidden input `value='0'` + checkbox `value='1'` with the same `name` (see 4.3) | Font Awesome icon: `fa-square-check` if 1, `fa-square` if not |
| **Dropdown** | `input: select` + `options:` map | `<select>` with one `<option>` per value | `{{variables.x\|default}}` |
| **Suggest** (text with suggestions while typing) | `input: string` | `<input list='list-x'>` + `<datalist id='list-x'>` | `{{variables.x\|default}}` |
| **Image** (WA image ID) | `input: integer`, `render: image` | `<input type='number' placeholder='WA Image ID'>` | `{% if variables.x\|default > 0 %}[img:{{variables.x}}]{% endif %}` |

Per type, the field dialog asks for:

- all types: label, field name, description (YAML `description`)
- Number: min (optional)
- Text area: rows
- Dropdown / Suggest: list of values, one per line

For Dropdown, each value is both the YAML option key and its label (`Very Close: "Very Close"`), and the form `<option value>` uses exactly the same text. (The daggerheart example has `1H` in YAML but `1h` in the form. Do not copy that.)

The datalist is written out directly per field. No twig macro needed.

### 4.3 Reference output (one field, all three files)

String field `hp_max`, label `hp max`:

```yaml
  hp max:
    label: "hp max"
    input: string
    description: "hp max"
```

```twig
<div class='ilbl ilbl-hp-max'><label for='hp_max'>hp max</label></div>
<div class='ivar ivar-hp-max'><input value='{{variables.hp_max|default}}' class='form-control ivar ivar-hp-max' id='hp_max' name='hp_max' type='text' /></div>
```

```twig
<div class='lbl lbl-hp-max'>hp max</div>
<div class='var var-hp-max'>{{variables.hp_max|default}}</div>
```

Inside a table, the label goes into `<th>` and the value into `<td>` (as in the examples) instead of the two `<div>`s.

Checkbox in the form:

```twig
<input value='0' name='wounds_001' type='hidden' /><input value='1' {% if variables.wounds_001|default > 0 %}checked='checked'{% endif %} id='wounds_001' name='wounds_001' type='checkbox' />
```

Classes: sheet uses `lbl` / `var`, form uses `ilbl` / `ivar`, plus a per-field class (`lbl-hp-max`, `var-hp-max`, …). This lets one CSS file style both views.

## 5. Layout elements

### 5.1 Allowed elements and nesting

| Element | May contain |
| --- | --- |
| `container-fluid` (root, exactly one) | row |
| row | col |
| col | row, card, field, ul, ol, table, static text, static image |
| card | card-header (0–1), card-body (0–1) |
| card-header | static text |
| card-body | row, field, ul, ol, table, static text, static image |
| ul / ol | li |
| li | static text, field |
| table | tr → th / td cells |
| th / td | static text, field |

- **Static text**: free text, edited by double-click.
- **Static image**: a fixed WA image, `<img src='/i/<id>/render'>`, as in the nimble and dccarl headers.

### 5.2 Cols

- Each col has a width per breakpoint: `col-x` (all sizes), `col-md-x`, `col-lg-x`. Values 1–12. Each breakpoint can also be unset.
- A breakpoint switch in the toolbar (all / md / lg) chooses which width the canvas shows and which width the resize handle changes.
- Dragging the right edge of a col changes its width in steps of 1, clamped to 1–12.

### 5.3 Cards

- A new card gets a card-header and a card-body.
- Right-click: delete header, delete body, add header (if missing), add body (if missing).
- Optional extra class name (e.g. `skills`), checked against the naming rules.

### 5.4 Tables

- New table: 2 × 2.
- Right-click: add/remove row, add/remove column, toggle a cell between `th` and `td`.
- A table never goes below 1 × 1.

## 6. Editor UI

- **Palette** (left): row, col, card, ul, ol, table, static text, static image, and one entry per field type.
- **Canvas** (center): the sheet with real Bootstrap layout and the sheet's own CSS applied. Element outlines and type tags show on hover.
- **Properties panel** (right): settings of the selected element (col widths, card class, field settings, …).
- **Drag and drop**:
  - from the palette into any allowed target (5.1)
  - moving existing elements: rows up/down, cols left/right, any element into another allowed container
  - a drop indicator shows where the element will land; disallowed targets show no indicator
- **Double-click** edits text in place (static text, labels, card-header text, li, cells).
- **Right-click** menu per element: delete, duplicate, format, plus the element's own actions (5.3, 5.4).
- **Duplicate** on a field (or a container with fields) gives the copies new field names: a numeric suffix is added or increased (`wounds_001` → `wounds_002`). Numbers use 3 digits, as in the examples.
- **View switch**: Layout (editing) / Sheet preview / Form preview. Previews render with sample data.
- Look: modern, clean, light and dark mode, fast. No external JavaScript libraries.

## 7. Formatting

Toolbar buttons and the right-click menu, for the selected element or text:

- align left / center / right
- bold, italic, underline
- text color (color picker → hex, or WA theme variable `--dark` / `--light`)
- font size (px)
- font family (from the sheet's font list)

Rules:

- Bold / italic / underline inside text use `<b>`, `<i>`, `<u>`. These are HTML, not CSS.
- Everything else becomes a CSS class in `style.css`. Elements get a generated class (`f-1`, `f-2`, …) only when they have formatting. Identical formatting shares one class.
- **Fonts**: a sheet font list. Each entry has a name and a direct font file URL and becomes one `@font-face` block in `approved.css`. One font can be the sheet default (set on `.container-fluid`).

## 8. Save, load, export

### 8.1 Project file

- Format: JSON, extension `.washeet.json`, with a `version` number for future migrations.
- Holds the sheet name, font list, formats, and the full element tree with all field settings.
- Save / Save as / Open / New. Unsaved changes are marked in the title and prompt before closing or opening another file.

### 8.2 Export

- Writes the five files into a chosen folder. Default: `<project folder>/<sheetname>/`.
- Validation (section 9) runs first. Errors stop the export. Warnings do not.
- Files are UTF-8 **without** BOM. (Some example files start with a BOM.)

### 8.3 Importing existing WA files — not supported

Hand-written sheets like the examples use twig loops, macros, `{% set %}` variables and conditions. These cannot be mapped back to a visual layout reliably. So the app only reopens its own project files. See Q3 for a possible later extension.

## 9. Validation

Runs on export and on demand (a "Check" button), with a list of problems that link to the element:

- **Errors** (export blocked):
  - CSS contains `);`, `'`, `"`, or `%` inside `( )`
  - a class name starts with `sh` or `py`
  - a field name breaks the naming rule, or two fields share a name
  - `name` field missing
  - Dropdown or Suggest field with no values
  - duplicate YAML keys
- **Warnings**:
  - empty card, row without cols, col without content
  - a font in use that is not in the font list

## 10. Architecture

- **Option A**: one Go `.exe`. It starts a local web server and opens the editor in the default browser.
- Go standard library only. The web UI (HTML, CSS, plain JavaScript) is embedded in the exe with `go:embed`.
- The server listens on `127.0.0.1` only, on a free random port. A random token in the start URL is required for every API call, so other websites cannot talk to it.
- The console window stays open while the app runs. Closing it quits the app.
- Generation and validation run in Go and are covered by unit tests with golden files (expected output files).
- File access (open, save, export) goes through the Go server. The UI shows a simple folder/file browser.
- **Build** (from WSL/Linux): `GOOS=windows GOARCH=amd64 go build -o wa-sheet-gen.exe ./source`.
- **Bootstrap** for the canvas: an embedded copy of the Bootstrap CSS (CSS only, no Bootstrap JavaScript). See Q4.

## 11. Not in version 1

- Importing hand-written WA sheets (8.3)
- Twig loops in the export: repeated elements export as flat, numbered copies
- Themes switched by a field (like daggerheart's vivid/dark)
- Undo/redo beyond a simple history (open for discussion)
- Own app window (option B: WebView2)

## 12. Open questions

- **Q1 — `.sh` rule vs. `sheet-` class**: the root class `sheet-<name>` starts with `sh`. If the rule is true, no CSS selector can use it. But the working daggerheart `style.css` uses `.sheet.vivid` and `.sheet-daggerheart.form a`. Is the rule real, and what exactly is filtered? Until then, generated CSS scopes with `.container-fluid` (as nimble does) and never writes `.sheet…` selectors.
- **Q2 — YAML key format**: all examples use spaces (`hp max:`) and WA maps them to `variables.hp_max`. Does WA also accept `hp_max:` as a key? If yes, use the field name directly.
- **Q3 — reopen exported files**: the export could hide the project JSON in a twig comment (`{# … #}`) in `basic-sheet.html.twig`. Then an exported set could be reopened. Needs a test whether WA keeps or strips twig comments, and size limits.
- **Q4 — Bootstrap version**: which Bootstrap version does WA use for sheets? The canvas CSS must match it.
- **Q5 — Number `max`**: the examples only use `min`. Does WA support `max:` in the YAML?
- **Q6 — `approved.css` content**: the daggerheart `approved.css` also holds two `.card-header` gradient rules. Is that needed (e.g. because `style.css` filters something), or was it a shortcut?

## 13. Milestones

Each step ends with a check.

1. **Skeleton**: Go server, embedded UI, browser opens, token check, New/Open/Save of an empty project. → check: start the exe on Windows, save, reopen.
2. **Layout editor**: rows, cols, cards, drag and drop, col resize, context menus. → check: rebuild the nimble layout by hand.
3. **Content**: all field types, ul/ol, tables, static text/image, double-click editing, duplicate with numbering. → check: rebuild the nimble fields.
4. **Export + validation**: generator, validator, golden-file tests. → check: `go test ./...` passes; upload the exported nimble rebuild to WA and confirm sheet and form work.
5. **Formatting + fonts**: toolbar, generated classes, font list. → check: CSS passes validation; looks right in WA.
6. **Polish**: previews with sample data, dark mode, keyboard shortcuts.
