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

test('table nesting: field in a row, text only in cells', () => {
  assert.ok(t.canContain('tr', 'field'));
  assert.ok(!t.canContain('td', 'field'));
  assert.ok(t.canContain('td', 'text'));
  assert.ok(t.canContain('li', 'field'));
});

test('new table is 2x2 with th and td', () => {
  const tb = t.createNode('table', t.idGen(sample()));
  assert.equal(tb.children.length, 2);
  assert.deepEqual(tb.children[0].children.map((c) => c.type), ['th', 'td']);
  assert.equal(t.tableCols(tb), 2);
});

test('table rows and cols', () => {
  const r = sample();
  const tb = t.createNode('table', t.idGen(r));
  t.insert(r, 'n5', 0, tb);
  const row0 = tb.children[0];
  // a field counts as two cells (cells with text are not reused)
  const nx = t.idGen(r);
  for (const c of row0.children) c.children = [{ id: nx(), type: 'text', props: { text: 'x' } }];
  t.insert(r, row0.id, 2, t.createField(r, 'string', t.idGen(r)));
  assert.equal(t.tableCols(tb), 4);
  const added = t.tableAddRow(r, row0.children[0].id);
  assert.equal(tb.children[1], added, 'new row after the clicked row');
  assert.equal(added.children.length, 4);
  t.tableAddCol(r, tb.id);
  assert.equal(tb.children[2].children.length, 3);
  assert.ok(t.tableRemoveCol(r, tb.id));
  assert.equal(row0.children[row0.children.length - 1].type, 'field', 'field is never removed as a column');
  assert.ok(t.tableRemoveRow(r, added.id));
  assert.equal(tb.children.length, 2);
  t.tableRemoveRow(r, tb.children[0].id);
  assert.ok(!t.tableRemoveRow(r, tb.children[0].id), 'last row stays');
  const cell = { type: 'th' };
  t.toggleCell(cell);
  assert.equal(cell.type, 'td');
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

test('field reuses two empty cells of a row', () => {
  const r = sample();
  const tb = tableIn(r);
  const row = tb.children[0];
  t.insert(r, row.id, 0, t.createField(r, 'string', t.idGen(r)));
  assert.deepEqual(row.children.map((c) => c.type), ['field']);
  assert.equal(t.tableCols(tb), 2);
  // dropped after the cells: takes the cells on its left
  const row2 = tb.children[1];
  t.insert(r, row2.id, 2, t.createField(r, 'number', t.idGen(r)));
  assert.deepEqual(row2.children.map((c) => c.type), ['field']);
});

test('field leaving a row leaves two empty cells', () => {
  const r = sample();
  const tb = tableIn(r);
  const row = tb.children[0];
  // move the name field into the table
  t.move(r, 'n4', row.id, 0);
  assert.deepEqual(row.children.map((c) => c.type), ['field']);
  // and out again into the empty col n5
  t.move(r, 'n4', 'n5', 0);
  assert.deepEqual(row.children.map((c) => c.type), ['th', 'td']);
  const ids = new Set();
  t.walk(r, (n) => {
    assert.ok(!ids.has(n.id), 'duplicate id ' + n.id);
    ids.add(n.id);
  });
  // delete a field in a row
  const f = t.createField(r, 'string', t.idGen(r));
  t.insert(r, row.id, 0, f);
  t.remove(r, f.id);
  assert.deepEqual(row.children.map((c) => c.type), ['th', 'td']);
});

test('duplicate field in a row reuses empty cells', () => {
  const r = sample();
  const tb = tableIn(r);
  const row = tb.children[0];
  const f = t.createField(r, 'string', t.idGen(r));
  t.insert(r, row.id, 0, f);
  t.tableAddCol(r, tb.id);
  t.tableAddCol(r, tb.id);
  assert.equal(row.children.length, 3);
  t.duplicate(r, f.id);
  assert.deepEqual(row.children.map((c) => c.type), ['field', 'field']);
});

test('moving a field inside its row keeps the cell count', () => {
  const r = sample();
  const tb = tableIn(r);
  const row = tb.children[0];
  t.tableAddCol(r, tb.id);
  t.tableAddCol(r, tb.id);
  const f = t.createField(r, 'string', t.idGen(r));
  t.insert(r, row.id, 0, f);
  assert.equal(t.tableCols(tb), 4);
  t.move(r, f.id, row.id, row.children.length);
  assert.equal(row.children[row.children.length - 1], f);
  assert.equal(t.tableCols(tb), 4);
});
