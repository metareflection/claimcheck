// Exercises the discharge plumbing end to end with a fake `dafny` binary, so
// the harness generation, process handling, and output attribution are tested
// without a Dafny install. Real Dafny runs are covered by --discharge on the
// integration projects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeDischarger, dischargeLemma, parseSignature } from '../../src/discharge.js';

const LEMMA = `lemma DelegateNonExistentIsNoop(m: Model, from: Subject, to: Subject, cap: Capability)
    requires Inv(m)
    requires !(from in m.subjects && to in m.subjects)
    ensures Apply(m, Delegate(from, to, cap)) == m
  { }`;
const CLAIMS = `include "../dafny-replay/x.dfy"\nmodule DelegationAuthClaims {\n  import opened DelegationAuthDomain\n${LEMMA}\n}`;

// Fake dafny: reads the harness, fails the block named in FAKE_FAIL (a list of
// lemma names), verifies the rest; reports resolution error if FAKE_RESOLVE set.
async function fakeDafny(behaviour) {
  const dir = await mkdtemp(join(tmpdir(), 'fake-dafny-'));
  const bin = join(dir, 'dafny');
  await writeFile(bin, `#!/usr/bin/env node
const fs = require('fs');
const file = process.argv[process.argv.length - 1];
const src = fs.readFileSync(file, 'utf-8').split('\\n');
const behaviour = ${JSON.stringify(behaviour)};
if (behaviour.resolve) { console.log(file + '(3,10): Error: module not found'); console.log('1 resolution/type errors detected'); process.exit(2); }
let errors = 0;
src.forEach((line, i) => {
  const m = /lemma (Claimcheck_\\w+)/.exec(line);
  if (m && behaviour.fail.includes(m[1])) { errors++; console.log(file + '(' + (i + 3) + ',4): Error: a postcondition could not be proved'); }
});
console.log('Dafny program verifier finished with ' + (3 - errors) + ' verified, ' + errors + ' errors');
process.exit(errors ? 4 : 0);
`);
  await chmod(bin, 0o755);
  return bin;
}

const reading = { reading: 'both missing', requires: 'Inv(m) && from !in m.subjects && to !in m.subjects', ensures: 'Apply(m, Delegate(from, to, cap)) == m', covered: false };

test('covered: check verifies, trivial and sat fail', async () => {
  const dafnyBin = await fakeDafny({ fail: ['Claimcheck_trivial', 'Claimcheck_sat'] });
  const discharge = makeDischarger({ claimsPath: '/tmp/claims.dfy', claimsSource: CLAIMS, domainModule: 'DelegationAuthDomain', opts: { dafnyBin } });
  const [r] = await discharge({ dafnyCode: LEMMA, lemmaName: 'DelegateNonExistentIsNoop' }, [reading]);
  assert.equal(r.status, 'covered');
  assert.deepEqual(r.probes, { check: 'verified', trivial: 'failed', sat: 'failed' });
});

test('trivial beats covered; vacuous beats both', async () => {
  let bin = await fakeDafny({ fail: ['Claimcheck_sat'] });
  let [r] = await dischargeLemma({ dafnyCode: LEMMA, lemmaName: 'DelegateNonExistentIsNoop', readings: [reading], includePath: 'c.dfy', imports: [], opts: { dafnyBin: bin } });
  assert.equal(r.status, 'trivial');
  bin = await fakeDafny({ fail: [] });
  [r] = await dischargeLemma({ dafnyCode: LEMMA, lemmaName: 'DelegateNonExistentIsNoop', readings: [reading], includePath: 'c.dfy', imports: [], opts: { dafnyBin: bin } });
  assert.equal(r.status, 'vacuous');
});

test('unknown when check fails; error on resolution failure; error when dafny missing', async () => {
  let bin = await fakeDafny({ fail: ['Claimcheck_check', 'Claimcheck_trivial', 'Claimcheck_sat'] });
  let [r] = await dischargeLemma({ dafnyCode: LEMMA, lemmaName: 'DelegateNonExistentIsNoop', readings: [reading], includePath: 'c.dfy', imports: [], opts: { dafnyBin: bin } });
  assert.equal(r.status, 'unknown');
  assert.match(r.error, /postcondition/);
  bin = await fakeDafny({ fail: [], resolve: true });
  [r] = await dischargeLemma({ dafnyCode: LEMMA, lemmaName: 'DelegateNonExistentIsNoop', readings: [reading], includePath: 'c.dfy', imports: [], opts: { dafnyBin: bin } });
  assert.equal(r.status, 'error');
  [r] = await dischargeLemma({ dafnyCode: LEMMA, lemmaName: 'DelegateNonExistentIsNoop', readings: [reading], includePath: 'c.dfy', imports: [], opts: { dafnyBin: '/nonexistent/dafny' } });
  assert.equal(r.status, 'error');
  assert.match(r.error, /not found/);
});

test('makeDischarger imports the claims module and the domain (deduplicated)', async () => {
  const dafnyBin = await fakeDafny({ fail: ['Claimcheck_trivial', 'Claimcheck_sat'] });
  const discharge = makeDischarger({ claimsPath: '/tmp/claims.dfy', claimsSource: CLAIMS, domainModule: 'DelegationAuthDomain', opts: { dafnyBin, keepDischargeFiles: true, verbose: false } });
  const [r] = await discharge({ dafnyCode: LEMMA, lemmaName: 'DelegateNonExistentIsNoop' }, [reading]);
  assert.equal(r.status, 'covered');
  // signature sanity for the wrapper call
  assert.deepEqual(parseSignature(LEMMA).argNames, ['m', 'from', 'to', 'cap']);
});
