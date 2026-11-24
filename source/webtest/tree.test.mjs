// Run from the repo root: node --test source/webtest/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as t from '../web/tree.js';

function sample() {
  return {
    id: 'n1', type: 'container', children: [
      { id: 'n2', type: 'row', children: [
        { id: 'n3', type: 'col', props: { col: 12 }, children: [
          { id: 'n4', type: 'field', props: { fieldType: 'string', name: 'name', label: 'name', required: true } },
        ] },
        { id: 'n5', type: 'col', props: { col: 6 }, children: [] },
      ] },
      { id: 'n6', type: 'row', children: [] },
    ],
  };
}

test('nesting rules', () => {
  assert.ok(t.canContain('container', 'row'));
  assert.ok(!t.canContain('container', 'col'));
  assert.ok(t.canContain('row', 'col'));
  assert.ok(!t.canContain('row', 'card'));
  assert.ok(t.canContain('card-body', 'row'));
  assert.ok(!t.canContain('card', 'row'));
});

test('insert respects rules', () => {
  const r = sample();
  const next = t.idGen(r);
  t.insert(r, 'n6', 0, t.createNode('col', next));
  assert.equal(t.find(r, 'n6').node.children.length, 1);
  assert.throws(() => t.insert(r, 'n1', 0, t.createNode('col', next)));
});

test('idGen never reuses ids', () => {
  const r = sample();
  const next = t.idGen(r);
  assert.equal(next(), 'n7');
  assert.equal(next(), 'n8');
});

test('new card has header with text and body', () => {
  const c = t.createNode('card', t.idGen(sample()));
  assert.deepEqual(c.children.map((x) => x.type), ['card-header', 'card-body']);
  assert.equal(c.children[0].children[0].type, 'text');
});

test('move within same parent adjusts index', () => {
  const r = sample();
  // move n3 to the end of n2 (position 2 before the move)
  t.move(r, 'n3', 'n2', 2);
  assert.deepEqual(t.find(r, 'n2').node.children.map((x) => x.id), ['n5', 'n3']);
  t.move(r, 'n3', 'n2', 0);
  assert.deepEqual(t.find(r, 'n2').node.children.map((x) => x.id), ['n3', 'n5']);
});

test('move to other parent and forbidden moves', () => {
  const r = sample();
  t.move(r, 'n5', 'n6', 0);
  assert.equal(t.find(r, 'n5').parent.id, 'n6');
  assert.ok(!t.canMove(r, 'n2', 'n3'), 'row cannot go into its own col');
  assert.ok(!t.canMove(r, 'n3', 'n1'), 'col cannot go into container');
  assert.ok(!t.canMove(r, 'n1', 'n2'), 'root cannot move');
  assert.throws(() => t.move(r, 'n2', 'n3', 0));
});

test('required field blocks delete', () => {
  const r = sample();
  assert.ok(!t.canRemove(r, 'n4'));
  assert.ok(!t.canRemove(r, 'n2'), 'row holding the name field');
  assert.ok(!t.canRemove(r, 'n1'), 'root');
  t.remove(r, 'n5');
  assert.equal(t.find(r, 'n5'), null);
});

test('duplicate renames fields and drops required', () => {
  const r = sample();
  const copy = t.duplicate(r, 'n3');
  assert.deepEqual(t.find(r, 'n2').node.children.map((x) => x.id), ['n3', copy.id, 'n5']);
  const f = copy.children[0];
  assert.equal(f.props.name, 'name_2');
  assert.equal(f.props.label, 'name_2');
  assert.equal(f.props.required, undefined);
  assert.notEqual(f.id, 'n4');
  const again = t.duplicate(r, copy.id);
  assert.equal(again.children[0].props.name, 'name_3');
});

test('uniqueFieldName', () => {
  assert.equal(t.uniqueFieldName('weapon', new Set()), 'weapon_2');
  assert.equal(t.uniqueFieldName('weapon_2', new Set(['weapon_3'])), 'weapon_4');
});

test('card parts', () => {
  const r = sample();
  const next = t.idGen(r);
  const card = t.createNode('card', next);
  t.insert(r, 'n5', 0, card);
  card.children.shift();
  t.addCardPart(r, card.id, 'card-header');
  assert.equal(card.children[0].type, 'card-header');
  t.addCardPart(r, card.id, 'card-header');
  assert.equal(card.children.length, 2, 'no second header');
});

test('col widths', () => {
  const n = { type: 'col', props: { col: 6 } };
  t.setColWidth(n, 'md', 20);
  assert.equal(n.props.md, 12);
  t.setColWidth(n, 'lg', 0);
  assert.equal(n.props.lg, 1);
  t.setColWidth(n, 'col', null);
  assert.deepEqual(n.props, { md: 12, lg: 1 });
  assert.equal(t.effectiveWidth({ col: 6 }, 'lg'), 6);
  assert.equal(t.effectiveWidth({ col: 6, md: 4 }, 'lg'), 4);
  assert.equal(t.effectiveWidth({ md: 4 }, 'col'), null);
  assert.deepEqual(t.colClasses({ col: 12, md: 6 }), ['col-12', 'col-md-6']);
  assert.deepEqual(t.colClasses({}), ['col']);
});

const rules = { fieldNameRe: /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/, bannedWords: ['script'] };

test('new table is 2x2 with th and td', () => {
  const tb = t.createNode('table', t.idGen(sample()));
  assert.equal(tb.children.length, 2);
  assert.deepEqual(tb.children[0].children.map((c) => c.type), ['th', 'td']);
  assert.equal(t.tableCols(tb), 2);
});

test('list items', () => {
  const r = sample();
  const ul = t.createNode('ul', t.idGen(r));
  t.insert(r, 'n5', 0, ul);
  assert.equal(ul.children.length, 2);
  const first = ul.children[0];
  const item = t.listAddItem(r, first.children[0].id);
  assert.equal(ul.children[1], item, 'added after the clicked item');
  t.listAddItem(r, ul.id);
  assert.equal(ul.children.length, 4);
});

test('field names', () => {
  assert.equal(t.toFieldName('HP Max'), 'hp_max');
  assert.equal(t.toFieldName('  Hit-Dice (max) '), 'hit_dice_max');
  assert.equal(t.toFieldName('2nd skill'), 'f_2nd_skill');
  assert.equal(t.toFieldName('!!!'), '');
  assert.equal(t.fieldNameError('hp_max', rules, new Set()), '');
  assert.ok(t.fieldNameError('hp-max', rules));
  assert.ok(t.fieldNameError('description', rules).includes('script'));
  assert.ok(t.fieldNameError('name', rules, new Set(['name'])).includes('Another'));
});

test('createField gives unique names and type defaults', () => {
  const r = sample();
  const f1 = t.createField(r, 'text', t.idGen(r));
  assert.equal(f1.props.name, 'new_field');
  assert.equal(f1.props.rows, 3);
  t.insert(r, 'n5', 0, f1);
  const f2 = t.createField(r, 'select', t.idGen(r));
  assert.equal(f2.props.name, 'new_field_2');
  assert.deepEqual(f2.props.options, ['Option 1', 'Option 2']);
  assert.throws(() => t.createField(r, 'nope', t.idGen(r)));
});

function tableIn(r) {
  const tb = t.createNode('table', t.idGen(r));
  t.insert(r, 'n5', 0, tb);
  return tb;
}

test('rowFreeSpace', () => {
  const row = (...cols) => ({ type: 'row', children: cols.map((props) => ({ type: 'col', props })) });
  assert.equal(t.rowFreeSpace(row(), 'lg'), 12);
  assert.equal(t.rowFreeSpace(row({ col: 6 }), 'lg'), 6);
  assert.equal(t.rowFreeSpace(row({ col: 6 }, { col: 6 }), 'lg'), 0);
  assert.equal(t.rowFreeSpace(row({ col: 8 }, { col: 6 }), 'lg'), 6, 'second col wraps');
  assert.equal(t.rowFreeSpace(row({ col: 12, md: 4 }), 'md'), 8);
  assert.equal(t.rowFreeSpace(row({ col: 12, md: 4 }), 'col'), 0);
  assert.equal(t.rowFreeSpace(row({ md: 4 }), 'col'), 0, 'auto col fills the line');
});

test('new col is col-12', () => {
  assert.deepEqual(t.createNode('col', t.idGen(sample())).props, { col: 12 });
});

test('table nesting: fields and labels go into cells', () => {
  assert.ok(!t.canContain('tr', 'field'));
  assert.ok(t.canContain('td', 'field'));
  assert.ok(t.canContain('th', 'flabel'));
  assert.ok(t.canContain('li', 'field'));
});

test('table rows and cols', () => {
  const r = sample();
  const tb = tableIn(r);
  const row0 = tb.children[0];
  const added = t.tableAddRow(r, row0.children[0].id);
  assert.equal(tb.children[1], added, 'new row after the clicked row');
  assert.equal(added.children.length, 2);
  t.tableAddCol(r, tb.id);
  assert.equal(t.tableCols(tb), 3);
  assert.ok(t.tableRemoveCol(r, tb.id));
  assert.equal(t.tableCols(tb), 2);
  assert.ok(t.tableRemoveRow(r, added.id));
  assert.equal(tb.children.length, 2);
  t.tableRemoveRow(r, tb.children[0].id);
  assert.ok(!t.tableRemoveRow(r, tb.children[0].id), 'last row stays');
  const cell = { type: 'th' };
  t.toggleCell(cell);
  assert.equal(cell.type, 'td');
});

test('field dropped into a cell: label in th, field in the next td', () => {
  const r = sample();
  const tb = tableIn(r);
  const row = tb.children[0];
  const [c0, c1] = row.children;
  c0.type = 'td';
  c1.type = 'th';
  const f = t.createField(r, 'string', t.idGen(r));
  t.insert(r, c0.id, 0, f);
  assert.equal(c0.type, 'th');
  assert.deepEqual(c0.children.map((c) => [c.type, c.props.field]), [['flabel', f.id]]);
  assert.equal(c1.type, 'td', 'the value cell becomes a td');
  assert.equal(c1.children[0], f);
  // the cells stay normal cells
  assert.equal(row.children.length, 2);
  const ids = new Set();
  t.walk(r, (n) => {
    assert.ok(!ids.has(n.id), 'duplicate id ' + n.id);
    ids.add(n.id);
  });
});

test('field dropped into the last cell gets a new td', () => {
  const r = sample();
  const tb = tableIn(r);
  const row = tb.children[0];
  const f = t.createField(r, 'number', t.idGen(r));
  t.insert(r, row.children[1].id, 0, f);
  assert.equal(row.children.length, 3);
  assert.equal(row.children[2].children[0], f);
});

test('field without label goes into the cell as it is', () => {
  const r = sample();
  const tb = tableIn(r);
  const cell = tb.children[0].children[1];
  const f = t.createField(r, 'string', t.idGen(r));
  f.props.label = '';
  t.insert(r, cell.id, 0, f);
  assert.equal(cell.type, 'td');
  assert.equal(cell.children[0], f);
  assert.equal(t.fieldLabels(r, f.id).length, 0);
});

test('moving or deleting a field removes its label; add label cell brings it back', () => {
  const r = sample();
  const tb = tableIn(r);
  const row = tb.children[0];
  t.move(r, 'n4', row.children[0].id, 0); // the name field
  assert.equal(t.fieldLabels(r, 'n4').length, 1);
  t.move(r, 'n4', 'n5', 0);
  assert.equal(t.fieldLabels(r, 'n4').length, 0, 'label removed when the field leaves');
  assert.equal(row.children.length, 2, 'cells stay');
  // field without its label in a cell: add label cell
  const f = t.createField(r, 'string', t.idGen(r));
  f.props.label = '';
  t.insert(r, row.children[1].id, 0, f);
  f.props.label = 'x';
  t.addFieldLabel(r, f.id);
  assert.equal(row.children[0].type, 'th');
  assert.equal(t.fieldLabels(r, f.id).length, 1);
  t.remove(r, f.id);
  assert.equal(t.fieldLabels(r, f.id).length, 0, 'label removed with the field');
});

test('duplicating a table row copies labels with their fields', () => {
  const r = sample();
  const tb = tableIn(r);
  const row = tb.children[0];
  const f = t.createField(r, 'string', t.idGen(r));
  t.insert(r, row.children[0].id, 0, f);
  const copy = t.duplicate(r, row.id);
  const copiedField = copy.children[1].children[0];
  const copiedLabel = copy.children[0].children[0];
  assert.notEqual(copiedField.id, f.id);
  assert.equal(copiedLabel.props.field, copiedField.id);
});

test('remove last column keeps cells with fields', () => {
  const r = sample();
  const tb = tableIn(r);
  const row = tb.children[0];
  const f = t.createField(r, 'string', t.idGen(r));
  f.props.label = '';
  t.insert(r, row.children[1].id, 0, f);
  t.tableAddCol(r, tb.id);
  t.tableRemoveCol(r, tb.id);
  t.tableRemoveCol(r, tb.id);
  assert.equal(row.children[1].children[0], f, 'field cell stays');
  assert.equal(tb.children[1].children.length, 1);
});

test('lists: allowed types, nesting and the name field', () => {
  const r = sample();
  const row = t.find(r, 'n2').node;
  assert.ok(t.listProblem(r, row).includes('name field'), 'row holds the name field');
  const col = t.find(r, 'n5').node;
  assert.equal(t.listProblem(r, col), '');
  t.setRepeat(col, 4);
  assert.equal(t.repeatCount(col), 4);
  const tb = t.createNode('table', t.idGen(r));
  t.insert(r, 'n5', 0, tb);
  assert.ok(t.listProblem(r, tb.children[0]).includes('inside a list'));
  assert.equal(t.listOf(r, tb.children[0].id), col);
  assert.ok(t.listProblem(r, tb).includes('Only rows'));
  t.setRepeat(col, 250);
  assert.equal(col.props.repeat, 199, 'up to entry 199');
  t.setRepeat(col, '');
  assert.equal(col.props.repeat, undefined);
  assert.equal(t.listOf(r, tb.id), null);
});

test('labels on top: header row gets the labels, fields take one cell', () => {
  const r = sample();
  const tb = tableIn(r);
  t.setLabelMode(r, tb.id, 'top');
  const [head, data] = tb.children;
  const name = t.createField(r, 'string', t.idGen(r));
  t.insert(r, data.children[0].id, 0, name);
  const val = t.createField(r, 'number', t.idGen(r));
  t.insert(r, data.children[1].id, 0, val);
  assert.equal(data.children.length, 2, 'no extra cells');
  assert.equal(data.children[0].children[0], name);
  assert.deepEqual(head.children.map((c) => [c.type, c.children[0].type, c.children[0].props.field]),
    [['th', 'flabel', name.id], ['th', 'flabel', val.id]]);
  // a header cell with text stays as it is
  head.children[1].children = [{ id: 'nx1', type: 'text', props: { text: 'Value' } }];
  t.move(r, val.id, data.children[1].id, 0);
  assert.equal(head.children[1].children[0].props.text, 'Value');
});

test('labels on top: a field in the first row gets a new header row', () => {
  const r = sample();
  const tb = tableIn(r);
  t.setLabelMode(r, tb.id, 'top');
  const f = t.createField(r, 'string', t.idGen(r));
  t.insert(r, tb.children[0].children[1].id, 0, f);
  assert.equal(tb.children.length, 3);
  assert.equal(tb.children[0].children[1].children[0].props.field, f.id);
});

test('switching label mode moves the labels', () => {
  const r = sample();
  const tb = tableIn(r);
  const f = t.createField(r, 'string', t.idGen(r));
  t.insert(r, tb.children[1].children[0].id, 0, f); // left: label in [1][0], field in [1][1]
  assert.equal(tb.children[1].children[0].children[0].type, 'flabel');
  t.setLabelMode(r, tb.id, 'top');
  assert.equal(t.labelMode(r, f.id), 'top');
  assert.equal(t.fieldLabels(r, f.id).length, 1);
  assert.equal(tb.children[0].children[1].children[0].props.field, f.id, 'label now above the field');
  assert.equal(tb.children[1].children[0].children.length, 0, 'old label cell is empty');
  t.setLabelMode(r, tb.id, 'left');
  assert.equal(tb.props.labels, undefined);
  assert.equal(tb.children[1].children[0].children[0].props.field, f.id, 'label back on the left');
});

test('repeatTarget: the element itself, the one around it, or the list it is in', () => {
  const r = sample();
  const tb = tableIn(r);
  const f = t.createField(r, 'string', t.idGen(r));
  t.setLabelMode(r, tb.id, 'top');
  t.insert(r, tb.children[1].children[0].id, 0, f);
  assert.equal(t.repeatTarget(r, f.id), tb.children[1], 'the table row');
  assert.equal(t.repeatTarget(r, tb.children[1].id), tb.children[1]);
  t.setRepeat(t.find(r, 'n5').node, 3); // make the col a list
  assert.equal(t.repeatTarget(r, f.id).id, 'n5', 'the list it is already in');
  assert.equal(t.repeatTarget(r, 'n1'), null, 'nothing around the sheet root');
});

test('labels on top: a field turns its th cell into a td', () => {
  const r = sample();
  const tb = tableIn(r);
  t.setLabelMode(r, tb.id, 'top');
  const cell = tb.children[1].children[0]; // a th in the new table
  assert.equal(cell.type, 'th');
  t.insert(r, cell.id, 0, t.createField(r, 'string', t.idGen(r)));
  assert.equal(cell.type, 'td');
});

test('list ranges: start, end, limits', () => {
  const n = { type: 'col', props: {} };
  t.setListRange(n, 21, 40);
  assert.deepEqual(n.props, { repeat: 20, repeatStart: 21 });
  assert.deepEqual(t.listRange(n), [21, 40]);
  t.setListRange(n, 1, 20);
  assert.deepEqual(n.props, { repeat: 20 }, 'start 1 is not stored');
  t.setListRange(n, 190, 250);
  assert.deepEqual(t.listRange(n), [190, 199]);
  t.setListRange(n, 5, 5);
  assert.deepEqual(n.props, {}, 'one entry is no list');
});

test('duplicating a list continues it with the same field names', () => {
  const r = sample();
  const col = t.find(r, 'n5').node;
  const f = t.createField(r, 'string', t.idGen(r));
  f.props.name = 'weapon';
  t.insert(r, col.id, 0, f);
  t.setListRange(col, 1, 20);
  const copy = t.duplicate(r, col.id);
  assert.deepEqual(t.listRange(copy), [21, 40]);
  assert.equal(copy.children[0].props.name, 'weapon', 'name kept');
  const third = t.duplicate(r, copy.id);
  assert.deepEqual(t.listRange(third), [41, 60]);
  // a field duplicated inside a list still gets a new name
  const inner = t.duplicate(r, f.id);
  assert.equal(inner.props.name, 'weapon_2');
});

test('duplicating a table continues the list row inside it', () => {
  const r = sample();
  const tb = tableIn(r);
  t.setLabelMode(r, tb.id, 'top');
  const row = tb.children[1];
  const f = t.createField(r, 'string', t.idGen(r));
  f.props.name = 'weapon';
  f.props.label = 'Weapon';
  t.insert(r, row.children[0].id, 0, f);
  t.setListRange(row, 1, 20);
  const plain = t.createField(r, 'number', t.idGen(r));
  plain.props.name = 'total';
  t.insert(r, 'n5', 1, plain);
  const copy = t.duplicate(r, tb.id);
  const copyRow = copy.children[1];
  assert.deepEqual(t.listRange(copyRow), [21, 40]);
  assert.equal(copyRow.children[0].children[0].props.name, 'weapon', 'list field keeps its name');
  assert.equal(copy.children[0].children[0].children[0].props.field, copyRow.children[0].children[0].id, 'header label points to the copy');
  assert.deepEqual(t.listRange(row), [1, 20], 'original unchanged');
});

test('createField: a calculated field starts with an empty formula', () => {
  const r = sample();
  const f = t.createField(r, 'calc', t.idGen(r));
  assert.equal(f.props.fieldType, 'calc');
  assert.equal(f.props.formula, '');
});
