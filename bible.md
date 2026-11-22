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

A new sheet starts with: row → col-12 → card with the header "Personal" → card-body → `name` field.

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
- String, Number, Text area, Suggest, Image ID: placeholder (shown in the empty input of the form)
- The label may be empty. Then only the value is written; in a table row the field takes only the value cell (`td`), so the labels can sit in a header row. In the YAML an empty label falls back to the field name.
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
| tr | th, td |
| th / td | static text, field, field label |

- **Static text**: free text, edited by double-click.
- **Static image**: a fixed WA image, `<img src='/i/<id>/render'>`, as in the nimble and dccarl headers. Optional width in px (`width='350'`).
- **Field labels left / top** (table setting, panel or right-click): *left* (default) as described below. *Top*: a field takes only its own cell; its label goes as a field label into the header row (the first row of the table) in the same column, if that cell is empty; a field in the first row gets a new header row above it. Switching moves the labels of all fields in the table; cells stay. With a list row below the header row this gives tables like "Skill | Value" or weapon lists with many columns. A header label of a list field has no `for=` in the form (it belongs to all entries).
- **Field in a table** (project version 2): cells always stay normal cells. A field with a label dropped into a cell splits over two cells: that cell becomes a `th` holding a **field label** (an element that shows the field's label), the next cell (made if missing) becomes a `td` holding the field. In a cell the field writes only its input/value. A field without a label goes into the cell as it is. Moving or deleting a field removes its field label; right-click "Add label cell" brings it back. Version 1 projects (field directly in a row) are converted on open.

### 5.2 Cols

- A new col is always `col-12` (full width on phones). Dropped into a row with free space, it also gets the free width on large screens (`col-lg-x`).
- Each col has a width per breakpoint: `col-x` (all sizes), `col-md-x`, `col-lg-x`. Values 1–12. Each breakpoint can also be unset.
- The screen-size switch (Small / Medium / Large) only changes the canvas width, to see how the sheet looks. Editing always works on the Large layout: Large is the default view.
- Dragging the right edge of a col (only in the Large view) changes `col-lg-x` in steps of 1, clamped to 1–12. `col-x` and `col-md-x` are set in the properties panel.

### 5.3 Cards

- A new card gets a card-header and a card-body.
- Right-click: delete header, delete body, add header (if missing), add body (if missing).
- Optional extra class name (e.g. `skills`), checked against the naming rules.

### 5.4 Tables

- New table: 2 × 2, each row one `th` and one `td`.
- Right-click: add row (below the clicked row), remove row, add column (at the end), remove the last column, toggle a cell between `th` and `td` (also when right-clicking a text, field or field label inside it). Removing a column never removes a cell that holds a field.
- A table never goes below 1 × 1.

## 6. Editor UI

- **Palette** (left): row, col, card, ul, ol, table, static text, static image, and one entry per field type.
- **Canvas** (center): the sheet with real Bootstrap layout and the sheet's own CSS applied. Element outlines and type tags show on hover.
- **Sidebars**: both can be resized by dragging their inner edge (double-click: default width); the widths are kept in the settings file.
- **Properties panel** (right): settings of the selected element (col widths, card class, field settings, …). A path bar on top (`Sheet › Row › … › Table › Table row › Data cell (td)`) selects any element above the current one, e.g. a table that its cells cover completely.
- **Drag and drop**:
  - from the palette into any allowed target (5.1)
  - moving existing elements: rows up/down, cols left/right, any element into another allowed container
  - a drop indicator shows where the element will land; disallowed targets show no indicator
- **Moving a covered element**: a drag that starts inside the selected element moves the selected element. So a table (covered by its cells) is moved by selecting it in the path bar and dragging anywhere inside it.
- **Double-click** edits text in place (static text, labels, card-header text, li, cells).
- **Right-click** menu per element: delete, duplicate, format, plus the element's own actions (5.3, 5.4).
- **Duplicate** copies an element. Copied fields get a new unique name (a numeric suffix is added or increased: `weapon` → `weapon_2`). For many numbered entries, use lists (section 11, version 2).
- **Empty space**: when the cols of a row (at the current screen size) fill less than 12 columns, the free part shows as a striped "empty" box. An empty row shows "drop a col here".
- **Undo / Redo**: buttons in the top bar, and Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z). Each canvas change is one step; quick typing in the panel is grouped into one step. Undo back to the saved state clears the "unsaved" mark. Up to 200 steps.
- **View switch**: Layout (editing) / Sheet preview / Form preview. The previews are the exported Twig, filled with sample data by a small renderer that knows only the patterns the generator writes (`source/preview.go`). They are read-only. `[img:ID]` shows as a box; Font Awesome icons show as simple stand-ins.
- **Outlines** button: hides the dashed outlines of rows, cols, lists and cells and the "empty" markers, for a clean view while editing.
- **Save** button: highlighted only when there are unsaved changes.
- **Keyboard**: Ctrl+S save, Ctrl+Shift+S save as, Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) undo / redo, Ctrl+D duplicate, Delete remove, Esc deselect. Not while typing in a text box (except Ctrl+S).
- **Canvas**: shows the real sheet CSS (made by the same Go code as the export, via `/api/preview`). Dark canvas by default, switchable to light (editor only, not exported). In the canvas, `--dark` is #222222 and `--light` is #f5f5f5; on WA the theme sets them.
- **Version**: shown next to the app name at the top right; set in `source/version.go`.
- **Settings** (recent sheets, last folder, canvas theme, outlines) are stored by the server in `%AppData%\wa-sheet-gen\settings.json`, not in the browser: the app gets a new port on every start, and browsers store per port.
- **Autosave**: unsaved work is written to `autosave.json` next to the settings file about 1 second after each change (deleted after saving). After a reload or a crash the app asks whether to restore it; restored work stays marked as unsaved.
- **Inherited values**: when an element has no own font or size, the format panel shows what it inherits, e.g. "(inherit: Grenze)" and "inherit: 28px" (read from the canvas; "WA default" when nothing in the sheet sets it).
- **Open / Save as** dialog: a "Recent" list of the last 8 sheets (click: go there; double-click in Open: open it).
- Look: modern, clean, light and dark mode, fast. No external JavaScript libraries.
- Add mouse-over text to fields

## 7. Formatting

The "Format" section of the properties panel, quick buttons above the canvas (align, bold, italic, underline) and "Format…" in the right-click menu, for the selected element:

- align left / center / right
- bold, italic, underline
- bullet shape of a bullet list (disc, circle, square, none) and numbering of a numbered list (1., 01., a., A., i., I., none): `list-style-type`
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

A field has three looks, switched with Label / Value / Input in the panel: the label in sheet and form (`.lbl-hp-max`, `.ilbl-hp-max`), the value in the sheet (`.var-hp-max`) and the input in the form (`:is(input, textarea, select).ivar-hp-max`). The quick buttons act on the active look.

A plain background color goes into `style.css`. A gradient would go into `approved.css` (3.1); gradients are not in the toolbar in version 1, use custom CSS.

Rules:

- **All formatting goes into CSS**, including bold, italic and underline. No `<b>`, `<i>`, `<u>` tags in the twig files. So the look can be changed in the CSS without touching the sheet code.
- Formatting applies to a whole element, not to single words inside a text.
- The CSS rule uses the element's own class:
  - fields: their field classes (`.block-nimble .var-hp-max { font-weight: bold }`)
  - the sheet root: the root class itself (`.block-nimble { … }`), e.g. the default font
  - every other formatted element gets a generated class (`f-1`, `f-2`, …). Elements with the same formatting share one class. (A card's own extra class is left for custom CSS, because two cards with the same class may look different.)
- A formatted text inside a header, list item or cell is wrapped in `<span class='f-N'>`.
- Colors: `#rgb`, `#rrggbb` or `var(--name)`; sizes in px. A value ending in `)` is written with a space before `;`.
- **Fonts**: a sheet font list. Each entry has a name and a direct font file URL and becomes one `@font-face` block in `approved.css`. One font can be the sheet default (set on the root class).
- **Themes** (Sheet panel): Cozy Fantasy, Elegant Medieval, Druid Grove, Steampunk, Horror, Sci-Fi Space, Sci-Fi Cyberpunk, Clean Modern, Clean Modern (dark) (`source/themes.go`). All share one template and style: sheet background, text color, font and border; cards; card headers; labels; values; form inputs; tables; and slightly striped rows in tables (`--bs-table-bg` on even rows, so a cell color set by the user still wins) and lists. Fonts are system fonts with a generic fallback; colors hex only. The theme CSS is written at the start of `style.css`, before the formats and the custom CSS, and its selectors are never more specific than a format rule, so formats and custom CSS override it. A test checks every theme against the WA rules.
- In "labels on top" tables, a cell that gets a field becomes a `td`.
- **Custom CSS**: the project has two free text boxes, one for extra `style.css` and one for extra `approved.css`. Their content is added at the end of the exported files and is checked by the validator. Edit custom CSS here, not in the exported files: the next export overwrites the exported files.

## 8. Save, load, export

### 8.1 Project folder

- One folder per sheet. It holds `project.json` and the five exported files.
- `project.json` holds the sheet name, font list, formats, custom CSS, and the full element tree with all field settings. It has a `version` number for future format changes.
- New / Open (choose a folder) / Save / Save as. Unsaved changes are marked in the title and prompt before closing or opening another project.

### 8.2 Export

- Writes the five files into the project folder. The project is saved first (Save as if it has no folder yet).
- Validation (section 9) runs first. Errors stop the export. Warnings do not. A problem list shows both; clicking a problem selects its element.
- User text is HTML-escaped, including `{` and `}`, so it can never become Twig code. Dropdown values are escaped for both the Twig string and the HTML.
- A static text directly in a col or card-body becomes `<div class='txt'>…</div>`; in a header, list item or cell it is plain text.
- A golden-file test (`source/testdata/`) fixes the exact output. After a wanted change: `go test -run TestExportGolden -update`, then review the diff.
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
- **Build**: `./build.sh` (all platforms into `dist/`, plus release archives), `./build.sh windows` (quick Windows build), `./test.sh` (all tests), `./release.sh` (GitHub release). See the README.
- **Bootstrap 5.0.1**, the version WA uses. The canvas uses an embedded copy of `https://cdn.jsdelivr.net/npm/bootstrap@5.0.1/dist/css/bootstrap.min.css` (CSS only, no Bootstrap JavaScript). It is downloaded once during development and stored in the repo. The app makes no network calls at runtime, except loading font URLs on the canvas.

## 11. Version 2: lists

Sheets often repeat a block, e.g. 10 skills or 4 weapons. Version 2 exports these as a Twig loop around one block, as the examples do, instead of 10 copies.

- Rows, cols, cards, table rows and list items can be lists: right-click → **Make list…** (or "From entry / To entry" in the properties panel) → a number (20) or a range (21-40). At least 2 entries, up to entry 199. The loop is `{% for i in 21..40 %}`; the fields become `weapon_021` … `weapon_040`. With anything inside selected (e.g. a field in a table row), the panel and the right-click menu offer the list for the nearest element around it that can repeat (or the list it is already in). The canvas shows the block once with a "× N" badge; the Sheet and Form previews show all entries.
- A list cannot be inside another list, and the `name` field cannot be inside a list.
- **Long lists split over cards** (1–20, 21–40, 41–60): fields in lists may share a name; the checker makes sure their numbered WA names do not overlap. **Duplicate** continues every list in the copy, also a list inside it (e.g. the list row of a duplicated table or card): same field names, the next range (1–20 → 21–40). Fields outside lists in the copy get new names; a field duplicated inside a list still gets a new name.
- Fields in lists show a small ☰ mark in the canvas; its tooltip names the WA fields (`weapon_021 … weapon_040`).
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
- In the form, names, ids and `label for` become `weapon_name_{{id}}`; a suggest field's datalist id becomes `list-weapon-name-{{id}}`, so ids stay unique.
- YAML labels get the number: `"weapon name 001"`.
- The checker refuses names that clash with list entries (e.g. a field `hp_002` next to a list field `hp`).
- Optional per-entry labels from a list (like `skill_list` in nimble) are a later idea.

## 12. Not built yet

- Per-entry labels for lists (like `skill_list` in nimble)
- Importing hand-written WA sheets (8.3)
- Themes switched by a field (like daggerheart's vivid/dark)
- Formatting single words inside a text
- Undo/redo beyond a simple history (open for discussion)
- Own app window (option B: WebView2)
- Multi-select of elements, to format several at once (idea, tracked in the todo manager)

## 13. Open questions

None at the moment.

## 14. Milestones

Each step ends with a check.

1. **Skeleton**: Go server, embedded UI, browser opens, token check, New/Open/Save of an empty project, Bootstrap CSS stored in the repo. → check: start the exe on Windows, save, reopen.
2. **Layout editor**: rows, cols, cards, drag and drop, col resize, context menus. → check: rebuild the nimble layout by hand.
3. **Content**: all field types, ul/ol, tables, static text/image, double-click editing, duplicate. → check: rebuild the nimble fields.
4. **Export + validation**: generator, validator, golden-file tests. → check: `go test ./...` passes; upload the exported nimble rebuild to WA and confirm sheet and form work.
5. **Formatting + fonts + custom CSS**: toolbar, borders and backgrounds, generated classes, font list. → check: CSS passes validation; looks right in WA.
6. **Polish**: previews with sample data, outlines toggle, keyboard shortcuts. (The app follows the Windows light/dark setting.)
7. **Version 2**: lists (section 11), table cells with field labels, recent sheets, settings file, bullet styles.
