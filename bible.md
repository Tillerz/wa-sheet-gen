# World Anvil Sheet Generator — Design Document

## 1. Goal

A standalone Windows app to design World Anvil (WA) character sheets / stat blocks visually and export the five files WA needs:

| File | Content |
| --- | --- |
| `approved.css` | `@font-face` definitions, plus CSS that the normal filter removes (see 3.1) |
| `style.css` | all other CSS |
| `import-to-wa.yml` | field (data) definitions |
| `basic-sheet.html.twig` | view: shows a sheet with its saved data |
| `edit-form.html.twig` | form: lets the user enter data |

The app's own project file (`project.json`) is the source of truth. The five WA files are an **export**, generated from it.

## 2. Folders

- `source/` — app code
- `examples/` — working example sheets, one per subfolder (`nimble`, `dccarl`, `daggerheart`). Use them as the reference for every generated pattern.

## 3. Hard WA rules (the export must follow all of them)

### 3.1 CSS

- All CSS goes into the two CSS files. No `style=` attributes and no `<style>` in the twig files.
- **`approved.css`** goes into a special WA field with fewer security filters. Only WA developers and the sheet author can edit it. It holds:
  - `@font-face` blocks. Fonts load directly from a font file URL (`.woff2`, `.otf`, …). No `@import`, no external CSS files.
  - CSS that the normal `style.css` filter removes, e.g. gradients (`linear-gradient(…)`).
- **`style.css`** holds everything else.
- No class name may start with `sh` or `py` (selector `.sh…` / `.py…`).
- The sequence `);` must never appear. The WA security filter removes it. Fix: put a space between, e.g. `var(--dark) ;`. The generator does this automatically wherever needed.
- No `'` and no `"` anywhere in CSS files. Font names with spaces go unquoted (`font-family: IM Fell English SC`).
- No `%` inside `( )`. So no `rgb(10%, …)`, no `calc(50% …)`. Colors are written as hex (`#a000a0`) or WA theme variables (`var(--dark)`, `var(--light)`).
- The three character rules above apply to both CSS files.
- The `style.css` filter removes anything that looks suspicious. Never use these words anywhere in CSS, also not as part of a longer word or class name: `script`, `javascript`, `expression`, `behavior`, `@import`. The list lives in one place in the code so it can grow.
- Every generated selector starts with the root class `.block-<sheetname>`, so sheet CSS cannot leak into the rest of the WA page.

### 3.2 YAML (`import-to-wa.yml`)

- First line is always `fields:`.
- Indent: 2 spaces. No tabs.
- Keys are the field names (`hp_max:`). WA turns spaces in keys into underscores on import, so `hp max:` (as in the examples) and `hp_max:` give the same variable. The generator writes the underscore form.
- No duplicate keys. The exporter refuses to write a file with duplicates.
- String values in double quotes (`label: "hp max"`).

### 3.3 Twig / HTML

- **No JavaScript** in any exported file: no `<script>`, no `on…=` event attributes, no `javascript:` links. Only HTML, CSS and Twig. User-entered text is HTML-escaped on export.
- Generated HTML uses single quotes for attributes, like the examples.
- Data is read as `{{variables.<field_name>|default}}`.
- The root element is always:

  ```html
  <div class='container-fluid block-<sheetname>'>
  </div>
  ```

  `<sheetname>` follows the naming rule (3.4).
- Element `id`s must be unique. The generator only writes ids where needed (form inputs, `label for=`). The examples reuse ids like `card-personal`. Do not copy that.
- Font Awesome icons (`fa-solid`, `fa-regular`) are available on WA. The examples use them.

### 3.4 Naming

| Thing | Rule | Example |
| --- | --- | --- |
| Field name | lowercase `a-z`, `0-9`, `_` only; starts with a letter; no `__`, no `_` at start or end | `hp_max` |
| Class name for a field | field name with `_` → `-` | `hp-max` |
| YAML key | field name | `hp_max` |
| Twig variable | field name | `variables.hp_max` |
| Sheet name | lowercase `a-z`, `0-9`, `-` | `nimble` → `block-nimble` |

The app derives the field name from the label as you type (`HP Max` → `hp_max`). You can override it, but it must pass the rule. Field names must be unique in a sheet.

Field names, sheet names and card classes become CSS class names. So they must not contain a suspicious word (3.1). Example: `description` contains `script` and is refused. Use e.g. `desc` instead.

## 4. Fields

### 4.1 Mandatory field

Every sheet has a field `name` (type string, `required: true`). You cannot delete it. You can move it and change its label.

### 4.2 Field types

All types found in the three examples:

| Type | YAML | Form (edit-form) | Sheet (basic-sheet) |
| --- | --- | --- | --- |
| **String** | `input: string` | `<input type='text'>` | `{{variables.x\|default}}` |
| **Number** | `input: integer`, optional `min:`, `max:` | `<input type='number'>` (+ `min=`, `max=`) | `{{variables.x\|default}}` |
| **Text area** | `input: text`, `rows: N` (default 3) | `<textarea rows='N'>` | `{{variables.x\|default\|nl2br}}` |
| **Checkbox** | `input: checkbox` | hidden input `value='0'` + checkbox `value='1'` with the same `name` (see 4.3) | Font Awesome icon: `fa-square-check` if 1, `fa-square` if not |
| **Dropdown** | `input: select` + `options:` map | `<select>` with one `<option>` per value | `{{variables.x\|default}}` |
| **Suggest** (text with suggestions while typing) | `input: string` | `<input list='list-x'>` + `<datalist id='list-x'>` | `{{variables.x\|default}}` |
| **Image** (WA image ID) | `input: integer`, `render: image` | `<input type='number' placeholder='WA Image ID'>` | `{% if variables.x\|default > 0 %}[img:{{variables.x}}]{% endif %}` |

Per type, the field dialog asks for:

- all types: label, field name, description (YAML `description`; empty means same as label)
- Number: min, max (both optional)
- Text area: rows
- Dropdown / Suggest: list of values, one per line

For Dropdown, each value is both the YAML option key and its label (`Very Close: "Very Close"`), and the form `<option value>` uses exactly the same text. (The daggerheart example has `1H` in YAML but `1h` in the form. Do not copy that.)

The datalist is written out directly per field. No twig macro needed.

### 4.3 Reference output (one field, all three files)

String field `hp_max`, label `hp max`:

```yaml
  hp_max:
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
<input value='0' name='wounds' type='hidden' /><input value='1' {% if variables.wounds|default > 0 %}checked='checked'{% endif %} id='wounds' name='wounds' type='checkbox' />
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
| table | tr |
| tr | th, td, field |
| th / td | static text |

- **Static text**: free text, edited by double-click.
- **Static image**: a fixed WA image, `<img src='/i/<id>/render'>`, as in the nimble and dccarl headers. Optional width in px (`width='350'`).
- **Field in a table row**: a field dropped into a row fills two cells, the label in `<th>` and the value in `<td>`, as in the examples. It counts as two columns. Single cells hold only static text.

### 5.2 Cols

- Each col has a width per breakpoint: `col-x` (all sizes), `col-md-x`, `col-lg-x`. Values 1–12. Each breakpoint can also be unset.
- A breakpoint switch in the toolbar (all / md / lg) chooses which width the canvas shows and which width the resize handle changes.
- Dragging the right edge of a col changes its width in steps of 1, clamped to 1–12.

### 5.3 Cards

- A new card gets a card-header and a card-body.
- Right-click: delete header, delete body, add header (if missing), add body (if missing).
- Optional extra class name (e.g. `skills`), checked against the naming rules.

### 5.4 Tables

- New table: 2 × 2, each row one `th` and one `td`.
- Right-click: add row (below the clicked row), remove row, add column (at the end), remove the last column, toggle a cell between `th` and `td`. Removing a column never removes a field.
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
- **Duplicate** copies an element. Copied fields get a new unique name (a numeric suffix is added or increased: `weapon` → `weapon_2`). For many numbered entries, use lists (section 11, version 2).
- **View switch**: Layout (editing) / Sheet preview / Form preview. Previews render with sample data.
- Look: modern, clean, light and dark mode, fast. No external JavaScript libraries.
- Add mouse-over text to fields

## 7. Formatting

Toolbar buttons and the right-click menu, for the selected element:

- align left / center / right
- bold, italic, underline
- text color (color picker → hex, or WA theme variable `--dark` / `--light`)
- font size (px)
- font family (from the sheet's font list)
- border: width (px), style (solid, dashed, dotted, double, none), color
- border radius (px)
- background color

Border, border radius and background color are offered only where they make sense:

| Element | Border / radius / background |
| --- | --- |
| card, card-header, card-body | yes |
| table, th / td | yes |
| field value (sheet) | yes |
| field input (form): `input`, `textarea`, `select` | yes, set separately from the sheet look |
| row, col, ul, ol, li, static text | no |

A field has two looks: the value in the sheet (`.var-hp-max`) and the input in the form (`.ivar-hp-max`). The properties panel has a Sheet / Form switch for this.

A plain background color goes into `style.css`. A gradient would go into `approved.css` (3.1); gradients are not in the toolbar in version 1, use custom CSS.

Rules:

- **All formatting goes into CSS**, including bold, italic and underline. No `<b>`, `<i>`, `<u>` tags in the twig files. So the look can be changed in the CSS without touching the sheet code.
- Formatting applies to a whole element, not to single words inside a text.
- The CSS rule uses the element's own class:
  - fields: their field classes (`.block-nimble .var-hp-max { font-weight: bold }`)
  - cards: their card class (`.block-nimble .skills .card-header { … }`)
  - other elements get a generated class (`f-1`, `f-2`, …) only when they have formatting
- **Fonts**: a sheet font list. Each entry has a name and a direct font file URL and becomes one `@font-face` block in `approved.css`. One font can be the sheet default (set on the root class).
- **Custom CSS**: the project has two free text boxes, one for extra `style.css` and one for extra `approved.css`. Their content is added at the end of the exported files and is checked by the validator. Edit custom CSS here, not in the exported files: the next export overwrites the exported files.

## 8. Save, load, export

### 8.1 Project folder

- One folder per sheet. It holds `project.json` and the five exported files.
- `project.json` holds the sheet name, font list, formats, custom CSS, and the full element tree with all field settings. It has a `version` number for future format changes.
- New / Open (choose a folder) / Save / Save as. Unsaved changes are marked in the title and prompt before closing or opening another project.

### 8.2 Export

- Writes the five files into the project folder.
- Validation (section 9) runs first. Errors stop the export. Warnings do not.
- Files are UTF-8 without BOM.

### 8.3 Importing existing WA files — not supported

Hand-written sheets like the examples use twig loops, macros, `{% set %}` variables and conditions. These cannot be mapped back to a visual layout reliably. So the app only opens its own `project.json`.

## 9. Validation

Runs on export and on demand (a "Check" button), with a list of problems that link to the element:

- **Errors** (export blocked):
  - CSS contains `);`, `'`, `"`, or `%` inside `( )`
  - a class name starts with `sh` or `py`
  - a suspicious word (3.1) in CSS, a class name or a field name
  - JavaScript in any exported file (3.3)
  - a field name breaks the naming rule, or two fields share a name
  - `name` field missing
  - Dropdown or Suggest field with no values
  - Number field with min greater than max
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
- File access (open, save, export) goes through the Go server. The UI shows a simple folder browser.
- **Build** (from WSL/Linux, inside `source/`): `GOOS=windows GOARCH=amd64 go build -o ../wa-sheet-gen.exe .`
- **Bootstrap 5.0.1**, the version WA uses. The canvas uses an embedded copy of `https://cdn.jsdelivr.net/npm/bootstrap@5.0.1/dist/css/bootstrap.min.css` (CSS only, no Bootstrap JavaScript). It is downloaded once during development and stored in the repo. The app makes no network calls at runtime, except loading font URLs on the canvas.

## 11. Version 2: lists

Sheets often repeat a block, e.g. 10 skills or 4 weapons. Version 2 exports these as a Twig loop around one block, as the examples do, instead of 10 copies.

- Right-click on a container → **Make list** → choose the number of entries.
- The fields inside get numbered names on WA: `weapon_name` → `weapon_name_001` … `weapon_name_004` (3 digits, as in the examples).
- Twig output, following the examples:

  ```twig
  {% for i in 1..4 %}
    {% set id = i %}{% if id < 10 %}{% set id = '0' ~ id %}{% endif %}{% if id < 100 %}{% set id = '0' ~ id %}{% endif %}
    … {{attribute(variables, 'weapon_name_' ~ id)|default}} …
  {% endfor %}
  ```

- YAML has no loops, so the YAML still lists every entry (`weapon_name_001` … `weapon_name_004`). The app writes these automatically.
- Changing the number later is one setting in the app: it updates the loop range and the YAML entries.
- Optional per-entry labels from a list (like `skill_list` in nimble) are a later idea.

## 12. Not in version 1

- Lists / Twig loops (section 11)
- Importing hand-written WA sheets (8.3)
- Themes switched by a field (like daggerheart's vivid/dark)
- Formatting single words inside a text
- Undo/redo beyond a simple history (open for discussion)
- Own app window (option B: WebView2)

## 13. Open questions

None at the moment.

## 14. Milestones

Each step ends with a check.

1. **Skeleton**: Go server, embedded UI, browser opens, token check, New/Open/Save of an empty project, Bootstrap CSS stored in the repo. → check: start the exe on Windows, save, reopen.
2. **Layout editor**: rows, cols, cards, drag and drop, col resize, context menus. → check: rebuild the nimble layout by hand.
3. **Content**: all field types, ul/ol, tables, static text/image, double-click editing, duplicate. → check: rebuild the nimble fields.
4. **Export + validation**: generator, validator, golden-file tests. → check: `go test ./...` passes; upload the exported nimble rebuild to WA and confirm sheet and form work.
5. **Formatting + fonts + custom CSS**: toolbar, borders and backgrounds, generated classes, font list. → check: CSS passes validation; looks right in WA.
6. **Polish**: previews with sample data, dark mode, keyboard shortcuts.
7. **Version 2**: lists (section 11).
