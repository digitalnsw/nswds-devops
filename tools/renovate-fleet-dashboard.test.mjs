import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessHealth,
  countDetectedDependencies,
  helpText,
  IGNORE_OVERRIDE_SECTIONS,
  isDashboardIssue,
  parseArgs,
  parseCheckboxes,
  parseFleetFromSyncConfig,
  parseProblems,
  shouldIgnore,
  splitSections,
} from './renovate-fleet-dashboard.mjs';

/**
 * A dashboard in every failure state at once. Modelled on the real body shape
 * observed in digitalnsw/nswds-email, with the sections the fleet is not
 * currently exhibiting bolted on.
 */
const BROKEN_BODY = `This issue lists Renovate updates and detected dependencies.<br>[View this repository on the Mend.io Web Portal](https://developer.mend.io/github/digitalnsw/example).

## Repository problems

These problems occurred while renovating this repository.

-   \`WARN\`: Package lookup failures
-   \`ERROR\`: Failed to update lock file

## Errored

These updates encountered an error and will be retried.

 - [ ] <!-- unlimit-branch=renovate/postcss-8.x -->chore(deps): update dependency postcss to v8.5.26

## Rate-Limited

These updates are currently rate-limited.

 - [ ] <!-- unlimit-branch=renovate/react-19.x -->chore(deps): update react monorepo
 - [ ] <!-- create-all-rate-limited-prs -->🔐 **Create all rate-limited PRs at once** 🔐

## Edited/Blocked

These updates have been manually edited.

 - [ ] <!-- rebase-branch=renovate/tailwind-4.x -->chore(deps): update tailwindcss

## Awaiting Schedule

 - [x] <!-- unschedule-branch=renovate/all-minor-patch -->chore(deps): update all non-major dependencies
 - [ ] <!-- unschedule-branch=renovate/lock-file-maintenance -->chore(deps): lock file maintenance
 - [ ] <!-- create-all-awaiting-schedule-prs -->🔐 **Create all awaiting schedule PRs at once** 🔐

## Ignored or Blocked

 - [ ] <!-- recreate-branch=renovate/typescript-7.x -->chore(deps): update dependency typescript to v7

## Not A Real Header

 - [ ] <!-- unschedule-branch=renovate/spoofed -->this must not become its own section

## Detected Dependencies

<details><summary>npm (3)</summary>
<blockquote>

<details><summary>package.json (3)</summary>

 - \`react 19.2.0\`
 - \`next 16.2.11\`
 - \`typescript 5.9.3\`

</details>
</blockquote>
</details>
`;

const sections = splitSections(BROKEN_BODY);

test('splits only real Renovate section headers', () => {
  assert.ok(sections.has('Repository problems'));
  assert.ok(sections.has('Errored'));
  assert.ok(sections.has('Rate-Limited'));
  assert.ok(sections.has('Edited/Blocked'));
  assert.ok(sections.has('Awaiting Schedule'));
  assert.ok(sections.has('Ignored or Blocked'));
  assert.ok(sections.has('Detected Dependencies'));
  assert.equal(sections.has('Not A Real Header'), false);
});

test('a spoofed header stays inside the preceding section', () => {
  // The bogus "## Not A Real Header" content must be absorbed by Ignored or
  // Blocked rather than silently vanishing or inventing a section.
  const ignored = parseCheckboxes(sections.get('Ignored or Blocked'));
  assert.equal(ignored.length, 2);
  assert.ok(ignored.some((i) => i.title.includes('typescript to v7')));
  assert.ok(ignored.some((i) => i.title.includes('must not become its own section')));
});

test('parses checkbox state and strips HTML comment markers', () => {
  const awaiting = parseCheckboxes(sections.get('Awaiting Schedule'));
  assert.equal(awaiting.length, 3);

  const ticked = awaiting.find((i) => i.checked);
  assert.ok(ticked, 'expected the ticked checkbox to be detected');
  assert.equal(ticked.title, 'chore(deps): update all non-major dependencies');
  assert.equal(ticked.branch, 'renovate/all-minor-patch');
  assert.equal(ticked.isMeta, false);
});

test('bulk-action checkboxes are flagged as meta so they never inflate counts', () => {
  const awaiting = parseCheckboxes(sections.get('Awaiting Schedule'));
  const meta = awaiting.filter((i) => i.isMeta);
  assert.equal(meta.length, 1);
  assert.ok(meta[0].marker.startsWith('create-all-awaiting-schedule-prs'));

  const rateLimited = parseCheckboxes(sections.get('Rate-Limited'));
  assert.equal(rateLimited.filter((i) => i.isMeta).length, 1);
  assert.equal(rateLimited.filter((i) => !i.isMeta).length, 1);
});

test('parses repository problems as plain bullets, not checkboxes', () => {
  const problems = parseProblems(sections.get('Repository problems'));
  assert.equal(problems.length, 2);
  assert.ok(problems[0].includes('Package lookup failures'));
  assert.ok(problems[1].includes('Failed to update lock file'));
});

test('counts detected dependencies from backticked bullets only', () => {
  assert.equal(countDetectedDependencies(sections.get('Detected Dependencies')), 3);
});

// --- health assessment ---------------------------------------------------

const baseRepo = {
  dashboard: { number: 1, url: 'x' },
  problems: [],
  sectionCounts: {},
  stuckCheckboxes: [],
  dashboardAgeDays: 0,
  pendingCount: 0,
  oldestPrAgeDays: null,
  inFleet: true,
};

test('a stuck checkbox on a stale dashboard is an alert (the EOVERRIDE signature)', () => {
  const health = assessHealth({
    ...baseRepo,
    stuckCheckboxes: [{ section: 'Awaiting Schedule', title: 'x' }],
    dashboardAgeDays: 30,
    pendingCount: 3,
  });
  assert.equal(health.level, 'alert');
  assert.ok(health.reasons.some((r) => r.includes('aborting')));
});

test('a freshly ticked checkbox is only informational', () => {
  const health = assessHealth({
    ...baseRepo,
    stuckCheckboxes: [{ section: 'Awaiting Schedule', title: 'x' }],
    dashboardAgeDays: 1,
    pendingCount: 3,
  });
  assert.equal(health.level, 'info');
});

test('repository problems escalate to alert', () => {
  const health = assessHealth({ ...baseRepo, problems: ['ERROR: lockfile'] });
  assert.equal(health.level, 'alert');
});

test('a stale dashboard with pending work warns, but a quiet repo does not', () => {
  assert.equal(assessHealth({ ...baseRepo, dashboardAgeDays: 40, pendingCount: 2 }).level, 'warn');
  assert.equal(assessHealth({ ...baseRepo, dashboardAgeDays: 40, pendingCount: 0 }).level, 'ok');
});

test('an old open PR warns', () => {
  assert.equal(assessHealth({ ...baseRepo, oldestPrAgeDays: 30 }).level, 'warn');
});

test('a fleet member with no dashboard is a gap', () => {
  const health = assessHealth({ ...baseRepo, dashboard: null });
  assert.equal(health.level, 'gap');
  assert.ok(health.reasons[0].includes('not reporting'));
});

test('a Renovate repo outside the sync fleet is flagged, not hidden', () => {
  const health = assessHealth({ ...baseRepo, inFleet: false });
  assert.equal(health.level, 'unsynced');
  assert.ok(health.reasons[0].includes('not in the sync fleet'));
});

test('a real problem outranks being outside the fleet', () => {
  const health = assessHealth({ ...baseRepo, inFleet: false, problems: ['ERROR: lockfile'] });
  assert.equal(health.level, 'alert');
});

test('a clean repo is healthy', () => {
  assert.equal(assessHealth({ ...baseRepo }).level, 'ok');
});

// --- ignore filters ------------------------------------------------------

const IGNORE = ['lock file maintenance'];
const unticked = (title) => ({ title, checked: false });

test('a routine ignored item is hidden from a quiet section', () => {
  assert.equal(
    shouldIgnore(unticked('chore(deps): lock file maintenance'), 'Awaiting Schedule', IGNORE),
    true,
  );
});

test('matching is case-insensitive and substring-based', () => {
  assert.equal(
    shouldIgnore(unticked('Chore(deps): LOCK FILE MAINTENANCE'), 'Awaiting Schedule', IGNORE),
    true,
  );
});

test('a non-matching item is never hidden', () => {
  assert.equal(
    shouldIgnore(unticked('chore(deps): update dependency resend to v6.20.0'), 'Awaiting Schedule', IGNORE),
    false,
  );
});

test('a ticked ignored item is shown — automerge is not completing', () => {
  assert.equal(
    shouldIgnore(
      { title: 'chore(deps): lock file maintenance', checked: true },
      'Awaiting Schedule',
      IGNORE,
    ),
    false,
  );
});

test('an ignored item in a problem section is shown', () => {
  for (const section of ['Errored', 'Edited/Blocked', 'Config Migration Needed']) {
    assert.equal(
      shouldIgnore(unticked('chore(deps): lock file maintenance'), section, IGNORE),
      false,
      `${section} must not be suppressed`,
    );
  }
});

test('rate-limiting is a queue, not a problem, so it does not force an item back into view', () => {
  // prConcurrentLimit is 5 by design; hitting it is the config working.
  assert.equal(
    shouldIgnore(unticked('chore(deps): lock file maintenance'), 'Rate-Limited', IGNORE),
    true,
  );
  assert.equal(assessHealth({ ...baseRepo, sectionCounts: { 'Rate-Limited': 3 } }).level, 'ok');
});

test('no patterns means nothing is hidden', () => {
  assert.equal(
    shouldIgnore(unticked('chore(deps): lock file maintenance'), 'Awaiting Schedule', []),
    false,
  );
});

// --- argument parsing ----------------------------------------------------

test('parses a well-formed argument list', () => {
  const opts = parseArgs([
    '--org', 'acme',
    '--out', 'out.html',
    '--json', 'out.json',
    '--concurrency', '3',
    '--ignore', 'foo',
    '--ignore', 'bar',
  ]);
  assert.equal(opts.org, 'acme');
  assert.equal(opts.out, 'out.html');
  assert.equal(opts.json, 'out.json');
  assert.equal(opts.concurrency, 3);
  // First --ignore replaces the default, the second appends.
  assert.deepEqual(opts.ignore, ['foo', 'bar']);
});

test('--no-ignore clears the default and takes no value', () => {
  assert.deepEqual(parseArgs(['--no-ignore']).ignore, []);
  assert.deepEqual(parseArgs(['--no-ignore', '--org', 'acme']).ignore, []);
});

test('a flag cannot swallow the following flag as its value', () => {
  // The dangerous case: this used to set ignore:["--out"], drop the output path
  // and write to the default file with exit code 0.
  assert.throws(() => parseArgs(['--ignore', '--out', 'x.html']), /--ignore requires a value/);
  assert.throws(() => parseArgs(['--out', '--json', 'x.json']), /--out requires a value/);
});

test('a trailing flag with no value is rejected', () => {
  for (const flag of ['--org', '--out', '--json', '--concurrency', '--ignore']) {
    assert.throws(() => parseArgs([flag]), new RegExp(`${flag} requires a value`), flag);
  }
});

test('--concurrency must be a positive integer', () => {
  for (const bad of ['foo', '0', '-1', '1.5', 'NaN', '']) {
    assert.throws(() => parseArgs(['--concurrency', bad]), /--concurrency/, `rejects ${bad}`);
  }
  assert.equal(parseArgs(['--concurrency', '1']).concurrency, 1);
  assert.equal(parseArgs(['--concurrency', '16']).concurrency, 16);
});

test('an unrecognised option is rejected rather than silently ignored', () => {
  assert.throws(() => parseArgs(['--ignor', 'x']), /unknown option: --ignor/);
  assert.throws(() => parseArgs(['stray']), /unknown option: stray/);
});

// --- documentation cannot drift from behaviour ---------------------------

test('IGNORE_OVERRIDE_SECTIONS matches the sections shouldIgnore actually overrides on', () => {
  const patterns = ['lock file maintenance'];
  const item = { title: 'chore(deps): lock file maintenance', checked: false };

  // Every listed section must surface an ignored item...
  for (const section of IGNORE_OVERRIDE_SECTIONS) {
    assert.equal(shouldIgnore(item, section, patterns), false, `${section} should override`);
  }
  // ...and the quiet ones must not.
  for (const section of ['Awaiting Schedule', 'Pending Status Checks', 'Rate-Limited', 'Open']) {
    assert.equal(shouldIgnore(item, section, patterns), true, `${section} should not override`);
  }
});

test('the help text names exactly those sections, and not Rate-Limited', () => {
  const help = helpText();
  for (const section of IGNORE_OVERRIDE_SECTIONS) {
    assert.ok(help.includes(section), `help should name ${section}`);
  }
  assert.equal(help.includes('Rate-Limited'), false);
  assert.equal(help.includes('Edited-Blocked'), false);
  // Repository problems is alert-severity but never reaches shouldIgnore.
  assert.equal(help.includes('Repository problems'), false);
});

// --- dashboard issue validation ------------------------------------------

test('only an open, correctly titled issue counts as a dashboard', () => {
  const ok = { state: 'open', title: 'Dependency Dashboard' };
  assert.equal(isDashboardIssue(ok), true);
  assert.equal(isDashboardIssue({ ...ok, state: 'closed' }), false);
  assert.equal(isDashboardIssue({ ...ok, title: 'Something else' }), false);
  assert.equal(isDashboardIssue(null), false);
  assert.equal(isDashboardIssue(undefined), false);
});

// --- fleet membership ----------------------------------------------------

const SYNC_YAML = `# Repo names in comments must not enrol: digitalnsw/not-a-member
group:
  # ── Group 1 ──
  - repos: |
      digitalnsw/reviewers
      digitalnsw/nswds-email
    files:
      - source: scripts/
        dest: scripts/
  - repos: |
      digitalnsw/nswds-ui
    files:
      - source: commit-types.mjs
        dest: commit-types.mjs
`;

test('reads members only from repos: block scalars', () => {
  const fleet = parseFleetFromSyncConfig(SYNC_YAML);
  assert.deepEqual(
    [...fleet].sort(),
    ['digitalnsw/nswds-email', 'digitalnsw/nswds-ui', 'digitalnsw/reviewers'],
  );
});

test('a repo named in a comment or a files: block cannot enrol itself', () => {
  const fleet = parseFleetFromSyncConfig(SYNC_YAML);
  assert.equal(fleet.has('digitalnsw/not-a-member'), false);
  // `source: scripts/` style lines sit at deeper indentation but are not slugs.
  assert.equal([...fleet].some((r) => r.includes('scripts')), false);
});
