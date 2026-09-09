import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSignature, splitTopLevel, detectImports, buildHarness, parseDafnyOutput } from '../../src/discharge.js';
import { decide, applyPolicy, normalizeReadings } from '../../src/ambiguity.js';

const LEMMA = `lemma DelegateNonExistentIsNoop(m: Model, from: Subject, to: Subject, cap: Capability)
    requires Inv(m)
    requires !(from in m.subjects && to in m.subjects)
    ensures Apply(m, Delegate(from, to, cap)) == m
  { }`;

test('parseSignature: plain lemma', () => {
  const sig = parseSignature(LEMMA);
  assert.equal(sig.name, 'DelegateNonExistentIsNoop');
  assert.deepEqual(sig.argNames, ['m', 'from', 'to', 'cap']);
  assert.equal(sig.typeParams, '');
});

test('parseSignature: attributes, type params, nested types, ghost params', () => {
  const sig = parseSignature('ghost lemma {:verify true} Foo<T(==)>(ghost xs: seq<(int, T)>, m: map<int, set<T>>) requires true { }');
  assert.equal(sig.name, 'Foo');
  assert.equal(sig.typeParams, '<T(==)>');
  assert.deepEqual(sig.argNames, ['xs', 'm']);
});

test('splitTopLevel ignores nested commas', () => {
  assert.deepEqual(splitTopLevel('a: map<int, int>, b: (int, int), c: int'), ['a: map<int, int>', 'b: (int, int)', 'c: int']);
});

test('detectImports finds module and aliased opened imports', () => {
  const src = `include "x.dfy"\n// import opened Nope\nmodule DelegationAuthClaims {\n  import opened DelegationAuthDomain\n  import opened D = Other.Mod\n  lemma L() {}\n}`;
  assert.deepEqual(detectImports(src), { module: 'DelegationAuthClaims', imports: ['import opened DelegationAuthDomain', 'import opened D = Other.Mod'] });
});

test('buildHarness emits check/trivial blocks with correct line ranges', () => {
  const sig = parseSignature(LEMMA);
  const reading = { reading: 'both missing', requires: 'Inv(m) && from !in m.subjects && to !in m.subjects', ensures: 'Apply(m, Delegate(from, to, cap)) == m' };
  const { source, blocks } = buildHarness({ includePath: '/tmp/claims.dfy', imports: ['import opened Dom'], sig, reading, probes: ['check', 'trivial'] });
  assert.match(source, /include "\/tmp\/claims.dfy"/);
  assert.match(source, /DelegateNonExistentIsNoop\(m, from, to, cap\);/);
  assert.equal(blocks.length, 2);
  const srcLines = source.split('\n');
  for (const b of blocks) {
    assert.match(srcLines[b.start], new RegExp(`lemma Claimcheck_${b.kind}\\(`)); // start line is the comment, next is header
    assert.equal(srcLines[b.end - 1], '');
  }
});

test('buildHarness accepts pre-formed multi-clause contracts', () => {
  const sig = parseSignature(LEMMA);
  const reading = { reading: 'r', requires: 'requires Inv(m)\nrequires from !in m.subjects', ensures: 'true' };
  const { source } = buildHarness({ includePath: 'c.dfy', imports: [], sig, reading, probes: ['sat'] });
  assert.match(source, /  requires Inv\(m\)\n  requires from !in m.subjects\n  ensures false/);
});

test('parseDafnyOutput attributes errors to blocks', () => {
  const blocks = [{ kind: 'check', start: 6, end: 13 }, { kind: 'trivial', start: 14, end: 20 }];
  const out = `/tmp/x/opaque.dfy(17,4): Error: a postcondition could not be proved on this return path\n/tmp/x/opaque.dfy(9,12): Related location: this is the postcondition that could not be proved\n\nDafny program verifier finished with 1 verified, 1 error\n`;
  const r = parseDafnyOutput(out, blocks);
  assert.equal(r.finished, true);
  assert.deepEqual(r.verified, { check: true, trivial: false });
});

test('parseDafnyOutput: resolution error means nothing finished', () => {
  const r = parseDafnyOutput(`/tmp/x/opaque.dfy(8,20): Error: unresolved identifier: Foo\n1 resolution/type errors detected in opaque.dfy\n`, [{ kind: 'check', start: 6, end: 13 }]);
  assert.equal(r.finished, false);
  assert.deepEqual(r.verified, { check: false });
  assert.equal(r.errors.length >= 1, true);
});

// --- decide() ---

const R = (reading, covered) => ({ reading, requires: 'Inv(m)', ensures: 'x', covered });

test('decide: no readings falls back to match', () => {
  assert.equal(decide({ match: true }).status, 'confirmed');
  assert.equal(decide({ match: false }).status, 'disputed');
  assert.equal(decide({ match: false, nlAmbiguous: true }).status, 'ambiguous');
});

test('decide: judged-only, mixed coverage is ambiguous; uniform coverage defers to match', () => {
  assert.equal(decide({ match: false, readings: [R('a', true), R('b', false)] }).status, 'ambiguous');
  assert.equal(decide({ match: false, readings: [R('a', true), R('b', true)] }).status, 'disputed'); // model may have seen a tautology
  assert.equal(decide({ match: true, readings: [R('a', false)] }).status, 'confirmed');
});

test('decide: a proof of every reading overrides a model dispute', () => {
  const d = decide({ match: false, readings: [R('both missing', false), R('either missing', true)] },
    [{ status: 'covered' }, { status: 'covered' }]);
  assert.equal(d.status, 'confirmed');
  assert.equal(d.evidence, 'proven');
});

test('decide: proven on one reading, judged-uncovered on another is ambiguous with mixed evidence', () => {
  const d = decide({ match: false, readings: [R('both', false), R('either', false)], interpretation: '' },
    [{ status: 'covered' }, { status: 'unknown' }]);
  assert.equal(d.status, 'ambiguous');
  assert.equal(d.evidence, 'mixed');
  assert.equal(d.interpretation, 'both');
});

test('decide: vacuous and trivial readings are excluded from evidence', () => {
  const d = decide({ match: false, readings: [R('echo of lemma', true), R('real', false)] },
    [{ status: 'trivial' }, { status: 'unknown' }]);
  assert.equal(d.status, 'disputed');
  const e = decide({ match: false, readings: [R('impossible', true)] }, [{ status: 'vacuous' }]);
  assert.equal(e.status, 'disputed');
});

test('applyPolicy', () => {
  assert.equal(applyPolicy('ambiguous', 'flag'), 'ambiguous');
  assert.equal(applyPolicy('ambiguous', 'strict'), 'disputed');
  assert.equal(applyPolicy('ambiguous', 'lenient'), 'confirmed');
  assert.equal(applyPolicy('confirmed', 'strict'), 'confirmed');
  assert.throws(() => applyPolicy('ambiguous', 'bogus'));
});

test('normalizeReadings tolerates junk', () => {
  assert.deepEqual(normalizeReadings([{ reading: ' a ', covered: 1 }, null, { reading: '' }, 'x']), [{ reading: 'a', requires: 'true', ensures: '', covered: true }]);
});
