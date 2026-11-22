// Sheet layout tree: pure functions, no DOM. Nesting rules follow bible 5.1.

export const allowedChildren = {
  container: ['row'],
  row: ['col'],
  col: ['row', 'card', 'field', 'ul', 'ol', 'table', 'text', 'image'],
  card: ['card-header', 'card-body'],
  'card-header': ['text'],
  'card-body': ['row', 'field', 'ul', 'ol', 'table', 'text', 'image'],
  ul: ['li'],
  ol: ['li'],
  li: ['text', 'field'],
  table: ['tr'],
  // A field in a table row becomes two cells: label (th) and value (td).
  tr: ['th', 'td', 'field'],
  th: ['text'],
  td: ['text'],
};

export const fieldTypes = ['string', 'number', 'text', 'checkbox', 'select', 'suggest', 'image'];

export function canContain(parentType, childType) {
  return (allowedChildren[parentType] || []).includes(childType);
}

// find returns { node, parent, index } for id, or null.
export function find(root, id, parent = null, index = -1) {
  if (root.id === id) return { node: root, parent, index };
  const kids = root.children || [];
  for (let i = 0; i < kids.length; i++) {
    const r = find(kids[i], id, root, i);
    if (r) return r;
  }
  return null;
}

export function walk(node, fn) {
  fn(node);
  for (const c of node.children || []) walk(c, fn);
}

function maxId(root) {
  let max = 0;
  walk(root, (n) => {
    const m = /^n(\d+)$/.exec(n.id);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return max;
}

// idGen returns a function that hands out ids not yet used in root.
export function idGen(root) {
  let next = maxId(root) + 1;
  return () => 'n' + next++;
}

export function createNode(type, nextId) {
  switch (type) {
    case 'row':
      return { id: nextId(), type: 'row', children: [] };
    case 'col':
      return { id: nextId(), type: 'col', props: { col: 12 }, children: [] };
    case 'card':
      return {
        id: nextId(), type: 'card', props: {}, children: [
          createNode('card-header', nextId),
          createNode('card-body', nextId),
        ],
      };
    case 'card-header':
      return {
        id: nextId(), type: 'card-header', children: [
          { id: nextId(), type: 'text', props: { text: 'Header' } },
        ],
      };
    case 'card-body':
      return { id: nextId(), type: 'card-body', children: [] };
    case 'ul':
    case 'ol':
      return { id: nextId(), type, children: [createNode('li', nextId), createNode('li', nextId)] };
    case 'li':
      return { id: nextId(), type: 'li', children: [{ id: nextId(), type: 'text', props: { text: 'Item' } }] };
    case 'table':
      return {
        id: nextId(), type: 'table', children: [
          { id: nextId(), type: 'tr', children: [createNode('th', nextId), createNode('td', nextId)] },
          { id: nextId(), type: 'tr', children: [createNode('th', nextId), createNode('td', nextId)] },
        ],
      };
    case 'tr':
      return { id: nextId(), type: 'tr', children: [] };
    case 'th':
    case 'td':
      return { id: nextId(), type, children: [] };
    case 'text':
      return { id: nextId(), type: 'text', props: { text: 'Text' } };
    case 'image':
      return { id: nextId(), type: 'image', props: { imageId: '' } };
    default:
      throw new Error('unknown element type: ' + type);
  }
}

export function isAncestor(root, ancestorId, id) {
  const a = find(root, ancestorId);
  return !!(a && find(a.node, id));
}

export function containsRequired(node) {
  let found = false;
  walk(node, (n) => {
    if (n.type === 'field' && n.props && n.props.required) found = true;
  });
  return found;
}

// insert puts node into parent at index. Throws if the nesting rules forbid it.
export function insert(root, parentId, index, node) {
  const p = find(root, parentId);
  if (!p) throw new Error('target not found');
  if (!canContain(p.node.type, node.type)) {
    throw new Error(`a ${node.type} cannot go into a ${p.node.type}`);
  }
  const kids = (p.node.children ||= []);
  const i = Math.max(0, Math.min(index, kids.length));
  kids.splice(i, 0, node);
  if (node.type === 'field' && p.node.type === 'tr') fitFieldInRow(p.node, i, cellCount(node));
}

function isEmptyCell(c) {
  return !!c && (c.type === 'th' || c.type === 'td')
    && (c.children || []).every((t) => t.type === 'text' && !(t.props && t.props.text));
}

// fitFieldInRow lets the field at index i take the place of up to `need` empty cells
// next to it (right side first), so the table keeps its number of columns.
function fitFieldInRow(tr, i, need) {
  const kids = tr.children;
  let taken = 0;
  while (taken < need && isEmptyCell(kids[i + 1])) {
    kids.splice(i + 1, 1);
    taken++;
  }
  while (taken < need && i > 0 && isEmptyCell(kids[i - 1])) {
    kids.splice(i - 1, 1);
    i--;
    taken++;
  }
}

// fixRowCells keeps a table row's width when a field's label is set or cleared.
// before is cellCount(node) from before the label change.
export function fixRowCells(root, node, before) {
  const n = find(root, node.id);
  if (!n || !n.parent || n.parent.type !== 'tr') return;
  const after = cellCount(node);
  if (after < before) n.parent.children.splice(n.index + 1, 0, createNode('td', idGen(root)));
  else if (after > before) fitFieldInRow(n.parent, n.index, after - before);
}

// takeOut removes n from its parent. A field leaving a table row leaves its
// empty cells behind (th + td, or only td without a label). Returns how many cells were added.
function takeOut(n, nextId) {
  n.parent.children.splice(n.index, 1);
  if (n.node.type !== 'field' || n.parent.type !== 'tr') return 0;
  const cells = cellCount(n.node) === 2 ? [createNode('th', nextId), createNode('td', nextId)] : [createNode('td', nextId)];
  n.parent.children.splice(n.index, 0, ...cells);
  return cells.length;
}

// canMove tells whether element id may be moved into parentId.
export function canMove(root, id, parentId) {
  const n = find(root, id);
  const p = find(root, parentId);
  if (!n || !p || !n.parent) return false;
  if (id === parentId || isAncestor(root, id, parentId)) return false;
  return canContain(p.node.type, n.node.type);
}

// move moves element id to parentId at index. index counts positions
// in the target as it looks before the move.
export function move(root, id, parentId, index) {
  if (!canMove(root, id, parentId)) throw new Error('this move is not allowed');
  const n = find(root, id);
  const nextId = idGen(root); // before takeOut, so new cells never reuse the moved id
  const sameParent = n.parent.id === parentId;
  const added = takeOut(n, nextId);
  const i = sameParent && n.index < index ? index - 1 + added : index;
  insert(root, parentId, i, n.node);
}

export function canRemove(root, id) {
  const n = find(root, id);
  return !!(n && n.parent && !containsRequired(n.node));
}

export function remove(root, id) {
  if (!canRemove(root, id)) throw new Error('this element cannot be deleted');
  takeOut(find(root, id), idGen(root));
}

// uniqueFieldName adds or increases a numeric suffix: weapon → weapon_2 → weapon_3.
export function uniqueFieldName(name, used) {
  const m = /^(.*?)_(\d+)$/.exec(name);
  const base = m ? m[1] : name;
  let i = m ? Number(m[2]) + 1 : 2;
  while (used.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

// duplicate inserts a deep copy of element id right after it and returns the copy.
// Copied fields get new unique names; a copy is never required.
export function duplicate(root, id) {
  const n = find(root, id);
  if (!n || !n.parent) throw new Error('this element cannot be duplicated');
  const nextId = idGen(root);
  const used = fieldNames(root);
  const copy = structuredClone(n.node);
  walk(copy, (c) => {
    c.id = nextId();
    if (c.type === 'field' && c.props) {
      const name = uniqueFieldName(c.props.name, used);
      used.add(name);
      if (c.props.label === c.props.name) c.props.label = name;
      c.props.name = name;
      delete c.props.required;
    }
  });
  n.parent.children.splice(n.index + 1, 0, copy);
  if (copy.type === 'field' && n.parent.type === 'tr') fitFieldInRow(n.parent, n.index + 1, cellCount(copy));
  return copy;
}

// Card parts: at most one header (always first) and one body.

export function hasPart(card, type) {
  return (card.children || []).some((c) => c.type === type);
}

export function addCardPart(root, cardId, type) {
  const c = find(root, cardId);
  if (!c || c.node.type !== 'card') throw new Error('not a card');
  if (hasPart(c.node, type)) return;
  const part = createNode(type, idGen(root));
  const kids = (c.node.children ||= []);
  if (type === 'card-header') kids.unshift(part);
  else kids.push(part);
}

// Col widths per breakpoint. key is 'col', 'md' or 'lg'; null unsets it.

export const breakpoints = ['col', 'md', 'lg'];

export function setColWidth(node, key, value) {
  if (!breakpoints.includes(key)) throw new Error('unknown breakpoint ' + key);
  node.props ||= {};
  if (value === null || value === '' || value === undefined) {
    delete node.props[key];
    return;
  }
  node.props[key] = Math.max(1, Math.min(12, Math.round(Number(value))));
}

// effectiveWidth is the width Bootstrap uses at a breakpoint (mobile first), or null for auto.
export function effectiveWidth(props = {}, key) {
  const order = breakpoints.slice(0, breakpoints.indexOf(key) + 1).reverse();
  for (const k of order) if (props[k]) return props[k];
  return null;
}

export function colClasses(props = {}) {
  const cls = [];
  if (props.col) cls.push(`col-${props.col}`);
  if (props.md) cls.push(`col-md-${props.md}`);
  if (props.lg) cls.push(`col-lg-${props.lg}`);
  return cls.length ? cls : ['col'];
}

// ---------- fields ----------

export function fieldNames(root) {
  const names = new Set();
  walk(root, (n) => {
    if (n.type === 'field' && n.props && n.props.name) names.add(n.props.name);
  });
  return names;
}

// toFieldName turns a label into a field name: "HP Max" → "hp_max".
export function toFieldName(label) {
  let n = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!n) return '';
  if (!/^[a-z]/.test(n)) n = 'f_' + n;
  return n;
}

// fieldNameError checks the naming rule (bible 3.4). rules comes from /api/rules.
export function fieldNameError(name, rules, used) {
  if (!rules.fieldNameRe.test(name)) return 'Start with a-z, then use only a-z, 0-9 and single _ between words.';
  const bad = rules.bannedWords.find((w) => name.includes(w));
  if (bad) return `Contains "${bad}", which the WA filter removes.`;
  if (used && used.has(name)) return 'Another field already has this name.';
  return '';
}

export function createField(root, fieldType, nextId) {
  if (!fieldTypes.includes(fieldType)) throw new Error('unknown field type: ' + fieldType);
  const used = fieldNames(root);
  const name = used.has('new_field') ? uniqueFieldName('new_field', used) : 'new_field';
  const props = { fieldType, name, label: name.replaceAll('_', ' ') };
  if (fieldType === 'text') props.rows = 3;
  if (fieldType === 'select' || fieldType === 'suggest') props.options = ['Option 1', 'Option 2'];
  return { id: nextId(), type: 'field', props };
}

// ---------- tables ----------

// cellCount is how many table cells an element of a row takes: a field with a
// label takes two (label, value), a field without a label only the value cell.
export function cellCount(node) {
  if (node.type !== 'field') return 1;
  return node.props && String(node.props.label || '').trim() ? 2 : 1;
}

// tableCols counts the widest row.
export function tableCols(table) {
  let max = 1;
  for (const tr of table.children || []) {
    let n = 0;
    for (const c of tr.children || []) n += cellCount(c);
    max = Math.max(max, n);
  }
  return max;
}

function tableOf(root, id) {
  let n = find(root, id);
  while (n && n.node.type !== 'table') n = n.parent ? find(root, n.parent.id) : null;
  return n ? n.node : null;
}

function rowOf(root, id) {
  let n = find(root, id);
  while (n && n.node.type !== 'tr') n = n.parent ? find(root, n.parent.id) : null;
  return n ? n.node : null;
}

export { tableOf, rowOf };

// tableAddRow adds an empty row after the row holding id (or at the end).
export function tableAddRow(root, id) {
  const table = tableOf(root, id);
  if (!table) throw new Error('not in a table');
  const nextId = idGen(root);
  const tr = createNode('tr', nextId);
  for (let i = 0; i < tableCols(table); i++) tr.children.push(createNode('td', nextId));
  const row = rowOf(root, id);
  const at = row ? table.children.indexOf(row) + 1 : table.children.length;
  table.children.splice(at, 0, tr);
  return tr;
}

export function tableRemoveRow(root, id) {
  const table = tableOf(root, id);
  const row = rowOf(root, id);
  if (!table || !row || table.children.length < 2) return false;
  if (containsRequired(row)) return false;
  table.children.splice(table.children.indexOf(row), 1);
  return true;
}

export function tableAddCol(root, id) {
  const table = tableOf(root, id);
  if (!table) throw new Error('not in a table');
  const nextId = idGen(root);
  for (const tr of table.children) tr.children.push(createNode('td', nextId));
}

// tableRemoveCol removes the last plain cell of every row. Fields stay.
export function tableRemoveCol(root, id) {
  const table = tableOf(root, id);
  if (!table || tableCols(table) < 2) return false;
  for (const tr of table.children) {
    const last = tr.children[tr.children.length - 1];
    if (tr.children.length > 1 && last && (last.type === 'th' || last.type === 'td')) tr.children.pop();
  }
  return true;
}

export function toggleCell(node) {
  if (node.type === 'th') node.type = 'td';
  else if (node.type === 'td') node.type = 'th';
}

// ---------- lists ----------

// listAddItem adds an item after the li holding id (or at the end of the list id).
export function listAddItem(root, id) {
  let n = find(root, id);
  let li = null;
  while (n && n.node.type !== 'ul' && n.node.type !== 'ol') {
    if (n.node.type === 'li') li = n.node;
    n = n.parent ? find(root, n.parent.id) : null;
  }
  if (!n) throw new Error('not in a list');
  const item = createNode('li', idGen(root));
  const kids = n.node.children;
  kids.splice(li ? kids.indexOf(li) + 1 : kids.length, 0, item);
  return item;
}

// rowFreeSpace is how many of the 12 grid columns stay empty on the last line
// of a row at a breakpoint. Auto-width cols fill the line, so then nothing is free.
export function rowFreeSpace(row, key) {
  let line = 0;
  for (const c of row.children || []) {
    const w = effectiveWidth(c.props, key);
    if (w === null) return 0;
    line = line + w > 12 ? w : line + w;
  }
  return 12 - line;
}
