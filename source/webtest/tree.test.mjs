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
