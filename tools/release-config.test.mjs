import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeCommits } from '@semantic-release/commit-analyzer';

import releaseConfig from '../release.config.mjs';

/**
 * What release does a given commit actually produce?
 *
 * These run the REAL config through the REAL analyzer rather than asserting on
 * the shape of `noteKeywords`, because the bug this file exists to prevent was
 * invisible at that level: the keyword list looked reasonable, and the damage
 * came from how the bundled parser interpreted it.
 *
 * semantic-release bundles conventional-commits-parser v6, which matches a note
 * keyword with NO COLON after it. With a bare `BREAKING` in the list, any body
 * line beginning with the ordinary English word "breaking" declared a breaking
 * change and took the rest of the sentence as its description. It shipped
 * digitalnsw/engagement v2.0.0 off a Renovate `fix(deps)` bump whose body said
 * the breaking changes did not affect that repo, and digitalnsw/nswds-email
 * v3.0.0 off a refactor. The engagement one stood for six weeks before anyone
 * noticed.
 *
 * Commitlint cannot stand in for this. It resolves parser v7, which requires
 * the colon, so it parses these messages differently from the tool that acts on
 * them and stays green either way.
 *
 * This config is synced to every group-1 repo, so a regression here is a
 * regression in twenty repositories at once.
 */
const pluginConfig = releaseConfig.plugins.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === '@semantic-release/commit-analyzer',
)[1];

const logger = { log() {}, error() {}, warn() {} };

function releaseTypeFor(message) {
  return analyzeCommits(pluginConfig, {
    commits: [{ hash: '0000000', message, subject: message.split('\n')[0] }],
    logger,
    cwd: process.cwd(),
  });
}

test('a wrapped line beginning with the word breaking is prose, not a trigger', async () => {
  // The exact shape that cost two false majors: an ordinary sentence about
  // breaking something, wrapped so the word lands at the start of a line.
  const message = [
    'refactor(app): pin the catch-all convention',
    '',
    'Checked all three ways: adding one fails, removing one fails, and',
    'breaking the derivation fails on the vacuity guard rather than passing.',
  ].join('\n');

  assert.notEqual(await releaseTypeFor(message), 'major');
});

test('nor does the phrase that actually cost engagement v2.0.0', async () => {
  // The real one. `breaking changes` matches the KEYWORD, so trimming the
  // keyword list was not enough: what makes this prose is the missing colon.
  // The sentence was saying nothing broke.
  for (const word of ['breaking', 'Breaking', 'BREAKING']) {
    const message = [
      'fix(deps): update dependency resend to v6',
      '',
      'The upstream notes list several changes.',
      word + ' changes across v5 and v6 do not affect this repo.',
    ].join('\n');

    assert.notEqual(await releaseTypeFor(message), 'major', word + ' changes must stay prose');
  }
});

test('a bulleted footer in a squashed body still counts', async () => {
  // A squashed PR body arrives with `* ` prefixes, which the leading
  // `[\s|*]*` in notesPattern exists to allow.
  const message = ['feat(api): move the endpoint', '', '* BREAKING CHANGE: the old path is gone.'].join(
    '\n',
  );

  assert.equal(await releaseTypeFor(message), 'major');
});

test('a lowercase footer still counts, deliberately', async () => {
  // Off-spec but unambiguous. Missing a real breaking change is worse than the
  // prose this costs, so notesPattern keeps the parser's case-insensitivity.
  const message = ['feat(api): move the endpoint', '', 'breaking change: the old path is gone.'].join(
    '\n',
  );

  assert.equal(await releaseTypeFor(message), 'major');
});

test('the Conventional Commits footers still declare a breaking change', async () => {
  for (const keyword of ['BREAKING CHANGE', 'BREAKING CHANGES', 'BREAKING-CHANGE']) {
    const message = [
      'feat(api): move the endpoint',
      '',
      keyword + ': the old path is gone.',
    ].join('\n');

    assert.equal(await releaseTypeFor(message), 'major', keyword + ' must release a major');
  }
});

test('the hyphenated synonym is prose unless it is a footer', async () => {
  // `BREAKING-CHANGE` is a keyword now, so the hyphenated phrase in ordinary
  // prose must stay prose — the colon is what separates the two.
  const message = [
    'fix(a): tidy the guard',
    '',
    'Some context first.',
    'breaking-change handling is unchanged here.',
  ].join('\n');

  assert.notEqual(await releaseTypeFor(message), 'major');
});

test('a bare BREAKING footer still counts, deliberately', async () => {
  // The keyword list keeps `BREAKING`. With the colon required it can no longer
  // match prose, and dropping it would silently stop honouring this form.
  const message = ['feat(api): move the endpoint', '', 'BREAKING: the old path is gone.'].join('\n');

  assert.equal(await releaseTypeFor(message), 'major');
});

test('the bang header still declares a breaking change', async () => {
  // Pins the OUTCOME, not the mechanism. The config comment says
  // breakingHeaderPattern was what made this work, and that was true when a
  // `feat!:` shipped as a minor in @nswds/tokens v2.33.0 (nswds-tokens#79) —
  // but on the current dependency set it no longer is: deleting the pattern
  // leaves these two assertions passing, because the conventionalcommits preset
  // now handles the bang itself. The pattern is kept as belt-and-braces for a
  // future version that stops doing so, which is exactly what these assertions
  // would catch.
  assert.equal(await releaseTypeFor('feat(api)!: drop the old endpoint'), 'major');
  assert.equal(await releaseTypeFor('feat!: drop the old endpoint'), 'major');
});

test('ordinary commits release what their type says', async () => {
  assert.equal(await releaseTypeFor('fix(a): correct the guard'), 'patch');
  assert.equal(await releaseTypeFor('feat(a): add the guard'), 'minor');
  assert.equal(await releaseTypeFor('style(a): reformat'), 'patch');
});
