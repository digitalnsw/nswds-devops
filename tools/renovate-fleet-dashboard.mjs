#!/usr/bin/env node
/**
 * Renovate fleet dashboard — one page for every repo in the org.
 *
 * Renovate's own Dependency Dashboard is per-repository by design (it is just an
 * issue in each repo), so a fleet of 29 repos means 29 places to look. This
 * script collapses them into a single HTML page.
 *
 * The reason it reports run health and not just pending updates: a Renovate run
 * can die before it ever writes the dashboard. The npm EOVERRIDE case is the one
 * that has bitten this fleet — a package pinned both as a direct dependency and
 * as a literal override makes `npm install <pkg>@<new>` fail with EOVERRIDE,
 * Renovate throws lockfile-error, and the whole repository run aborts *before*
 * ensureDependencyDashboard(). No branch, no PR, no error comment, no red check.
 * The dashboard keeps whatever it last said, and a ticked checkbox stays ticked.
 * That killed reviewers, engagement and awards for a week in August 2026 while
 * all three looked green.
 *
 * So a view built only on "what updates are pending" reports a dead repo as
 * healthy. The two signals that do catch it, both derivable from the issue alone:
 *
 *   1. A ticked checkbox. Ticking asks Renovate to act, and a live run unticks it.
 *      One that survives is a run that is not completing.
 *   2. A dashboard that has stopped being rewritten while items sit pending.
 *
 * Neither is authoritative on its own — Renovate only PATCHes the issue when the
 * body actually changes, so a genuinely idle repo is legitimately stale. Both are
 * heuristics that decide where to look, which is why every row deep-links to the
 * Mend web portal, where the real job log lives.
 *
 * Usage:
 *   node tools/renovate-fleet-dashboard.mjs [--org digitalnsw] [--out <path>] [--json <path>]
 *
 * Requires the GitHub CLI, authenticated (`gh auth status`). No npm dependencies.
 */

import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULTS = {
  org: 'digitalnsw',
  out: 'renovate-fleet-dashboard.html',
  json: '',
  concurrency: 6,
  // Fleet membership is whatever the file-sync map says it is. Reading it from
  // main means onboarding a repo (ONBOARDING.md step 5) puts it on this page
  // automatically, with no second list to drift.
  fleetConfig: 'digitalnsw/nswds-devops/.github/sync.yml',
  // Lock file maintenance is automerged on a monthly schedule (see default.json),
  // so it sits in Awaiting Schedule in every repo between runs and reports as
  // work when there is nothing to decide. Hidden by default; see shouldIgnore
  // for the cases where it is shown anyway.
  ignore: ['lock file maintenance'],
};

/** Dashboard sections Renovate can emit, in the order it emits them. */
const SECTIONS = [
  { name: 'Repository problems', severity: 'alert' },
  { name: 'Config Migration Needed', severity: 'warn' },
  { name: 'Errored', severity: 'alert' },
  // Rate-limiting is prConcurrentLimit (5, set in default.json) working as
  // configured — a queue, not a fault. Treating it as a problem made 17 repos
  // read as "Attention" for behaving correctly. A queue that never drains is
  // still caught, by the dashboard-staleness rule below.
  { name: 'Rate-Limited', severity: 'info' },
  { name: 'Rate Limited', severity: 'info' },
  { name: 'Edited/Blocked', severity: 'warn' },
  { name: 'Pending Approval', severity: 'info' },
  { name: 'Awaiting Schedule', severity: 'info' },
  { name: 'Pending Status Checks', severity: 'info' },
  { name: 'Open', severity: 'info' },
  { name: 'Ignored or Blocked', severity: 'info' },
  { name: 'Detected Dependencies', severity: 'muted' },
];

const SECTION_SEVERITY = new Map(SECTIONS.map((s) => [s.name, s.severity]));

/**
 * Sections in which an ignored item is surfaced anyway, derived from SECTIONS so
 * the help text and the footer cannot drift from what shouldIgnore actually does.
 * They did drift once: Rate-Limited was reclassified from warn to info and three
 * prose sites kept claiming it still overrode the filter.
 *
 * "Repository problems" is alert-severity but excluded — it is parsed as plain
 * bullets, never as checkboxes, so it never reaches shouldIgnore.
 */
const IGNORE_OVERRIDE_SECTIONS = SECTIONS.filter(
  (s) => (s.severity === 'alert' || s.severity === 'warn') && s.name !== 'Repository problems',
).map((s) => s.name);

/**
 * Checkbox markers that trigger a bulk action rather than representing a single
 * pending update. They are controls, not work, and must not inflate counts.
 */
const META_CHECKBOX_MARKERS = [
  'create-all-rate-limited-prs',
  'create-all-awaiting-schedule-prs',
  'approve-all-pending-prs',
  'rebase-all-open-prs',
  'manual job',
  'config-migration-branch',
];

const STALE_WARN_DAYS = 21;
const STALE_ALERT_DAYS = 8;
const OLD_PR_WARN_DAYS = 14;

function helpText() {
  return [
    'Usage: renovate-fleet-dashboard.mjs [options]',
    '',
    '  --org <org>          GitHub org to scan (default: digitalnsw)',
    '  --out <file.html>    HTML output path (default: renovate-fleet-dashboard.html)',
    '  --json <file.json>   also write the parsed data as JSON',
    '  --concurrency <n>    parallel gh calls, positive integer (default: 6)',
    '  --ignore <text>      hide dashboard items containing <text>, case-insensitive.',
    '                       Repeatable. The first use replaces the default',
    `                       (${DEFAULTS.ignore.map((p) => `"${p}"`).join(', ')}).`,
    '                       Ignored items are still shown when ticked, or when they',
    `                       appear in a ${IGNORE_OVERRIDE_SECTIONS.join(' / ')} section.`,
    '  --no-ignore          hide nothing; list every item',
    '',
  ].join('\n');
}

/**
 * Parse argv, rejecting malformed input rather than limping on with it.
 *
 * Every one of these used to be accepted silently, and the quiet ones were the
 * dangerous ones:
 *
 *   --ignore --out out.html   consumed "--out" as the ignore pattern, so the
 *                             output path was dropped and the run wrote to the
 *                             default file, exit code 0, no warning.
 *   --concurrency foo         NaN workers, so Array.from({length: NaN}) built an
 *                             empty pool and the run died later on an unrelated
 *                             "Cannot read properties of undefined" .
 *   --out                     undefined path, thrown deep inside writeFile.
 *
 * A value starting with "--" is therefore treated as a missing value. No Renovate
 * item title begins with a double dash, so nothing legitimate is refused.
 *
 * Throws on bad input; main() turns that into exit 1. --help still exits 0 here.
 */
function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  let ignoreOverridden = false;

  const valueFor = (flag, raw) => {
    if (raw === undefined || raw.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    return raw;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--org') opts.org = valueFor(arg, argv[++i]);
    else if (arg === '--out') opts.out = valueFor(arg, argv[++i]);
    else if (arg === '--json') opts.json = valueFor(arg, argv[++i]);
    else if (arg === '--concurrency') {
      const raw = valueFor(arg, argv[++i]);
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`--concurrency must be a positive integer, got "${raw}"`);
      }
      opts.concurrency = parsed;
    } else if (arg === '--ignore') {
      // First --ignore replaces the default; later ones add to it.
      if (!ignoreOverridden) {
        opts.ignore = [];
        ignoreOverridden = true;
      }
      opts.ignore.push(valueFor(arg, argv[++i]));
    } else if (arg === '--no-ignore') {
      opts.ignore = [];
      ignoreOverridden = true;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(helpText());
      process.exit(0);
    } else {
      // Silently ignoring an unrecognised flag means a typo like `--ignor x`
      // changes nothing and reports success — the same failure class as above.
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return opts;
}

async function gh(args) {
  // Dashboards carry every detected dependency, so bodies run large.
  const { stdout } = await execFileAsync('gh', args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

async function ghJson(args) {
  const stdout = await gh(args);
  const trimmed = stdout.trim();
  return trimmed ? JSON.parse(trimmed) : null;
}

/** Run tasks with a bounded worker pool, preserving input order in the output. */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Split a dashboard body into its `## ` sections.
 *
 * Only headers Renovate actually emits are treated as sections. Anything else at
 * `## ` level is left with the preceding section, so a dependency named like a
 * header cannot invent one.
 */
function splitSections(body) {
  const lines = body.split('\n');
  const sections = new Map();
  let current = null;
  let buffer = [];

  const flush = () => {
    if (current) sections.set(current, buffer.join('\n'));
    buffer = [];
  };

  for (const line of lines) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match && SECTION_SEVERITY.has(match[1])) {
      flush();
      current = match[1];
    } else if (current) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

/** Extract checkbox items from a section body. */
function parseCheckboxes(sectionBody) {
  const items = [];
  const lineRe = /^\s*-\s\[( |x|X)\]\s*(.*)$/;

  for (const line of sectionBody.split('\n')) {
    const match = lineRe.exec(line);
    if (!match) continue;

    const checked = match[1].toLowerCase() === 'x';
    const raw = match[2];
    const marker = /<!--\s*(.*?)\s*-->/.exec(raw)?.[1] ?? '';
    const isMeta = META_CHECKBOX_MARKERS.some((m) => marker.startsWith(m));
    const title = raw
      .replace(/<!--.*?-->/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Renovate names the branch in the marker, e.g. unschedule-branch=renovate/foo
    const branch = /=(.+)$/.exec(marker)?.[1] ?? '';

    items.push({ checked, title, marker, branch, isMeta });
  }
  return items;
}

/**
 * Should this item be hidden from the listing and the pending count?
 *
 * An ignore pattern means "this is routine, do not make me read it", not "never
 * tell me about this". Two cases override it, because in both the item has
 * stopped being routine:
 *
 *   - the checkbox is ticked, which means a run was asked to act and has not;
 *   - the item sits in a section that is itself a problem — the alert- and
 *     warn-severity ones, listed in IGNORE_OVERRIDE_SECTIONS.
 *
 * Rate-Limited is deliberately NOT one of them: it is prConcurrentLimit (5, set
 * in default.json) queueing work as configured, not a fault.
 *
 * Lock file maintenance is the motivating case: it is automerged monthly, so it
 * is noise in Awaiting Schedule — but a lock file maintenance PR that has errored
 * or gone stale means automerge is not working, which is exactly what you want
 * to hear about.
 */
function shouldIgnore(item, sectionName, patterns) {
  if (!patterns.length) return false;
  if (item.checked) return false;

  const severity = SECTION_SEVERITY.get(sectionName);
  if (severity === 'alert' || severity === 'warn') return false;

  const title = item.title.toLowerCase();
  return patterns.some((pattern) => title.includes(pattern.toLowerCase()));
}

/** Count the dependencies listed under Detected Dependencies. */
function countDetectedDependencies(sectionBody) {
  if (!sectionBody) return 0;
  return sectionBody.split('\n').filter((l) => /^\s*-\s+`[^`]+`/.test(l)).length;
}

/** Repository problems are plain bullets, not checkboxes. */
function parseProblems(sectionBody) {
  if (!sectionBody) return [];
  return sectionBody
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-') && !/^-\s\[/.test(l))
    .map((l) => l.replace(/^-\s*/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Read fleet membership out of the repo-file-sync map.
 *
 * Scope has to come from the fleet's own definition, not from a heuristic like
 * "has a package.json" — the org contains npm repos that are deliberately not
 * fleet members, and treating those as unmanaged Renovate gaps produces false
 * positives that make the status column worth ignoring.
 *
 * Only `repos: |` block scalars are read, so a repo name mentioned in prose or a
 * comment elsewhere in the file cannot enrol itself.
 */
function parseFleetFromSyncConfig(yaml) {
  const repos = new Set();
  let blockIndent = null;

  for (const line of yaml.split('\n')) {
    if (/^\s*-?\s*repos:\s*\|/.test(line)) {
      blockIndent = line.search(/\S/);
      continue;
    }
    if (blockIndent === null) continue;
    if (!line.trim()) continue;

    const indent = line.search(/\S/);
    if (indent <= blockIndent) {
      blockIndent = null;
      continue;
    }
    const match = /^([\w.-]+\/[\w.-]+)$/.exec(line.trim());
    if (match) repos.add(match[1]);
  }
  return repos;
}

async function loadFleet(fleetConfig) {
  const slash = fleetConfig.indexOf('/', fleetConfig.indexOf('/') + 1);
  const repo = fleetConfig.slice(0, slash);
  const path = fleetConfig.slice(slash + 1);

  const yaml = await gh([
    'api',
    `repos/${repo}/contents/${path}`,
    '-H',
    'Accept: application/vnd.github.raw',
  ]);

  const fleet = parseFleetFromSyncConfig(yaml);
  // The sync source repo is a fleet member too; it just never appears in its own
  // distribution list.
  fleet.add(repo);
  return fleet;
}

/**
 * Is this the live Dependency Dashboard the search pointed at?
 *
 * `gh search issues` reads an eventually-consistent index, so the number it
 * returns can name an issue that has since been closed or renamed. Verifying
 * matters because the fallback is not neutral: a repo with no dashboard is
 * reported as a `gap` — "Renovate is not reporting" — and inventing that alert
 * from a stale search result would undermine the one thing this page is for.
 */
function isDashboardIssue(issue) {
  return Boolean(issue) && issue.state === 'open' && issue.title === 'Dependency Dashboard';
}

function daysSince(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return (Date.now() - then) / 86_400_000;
}

/**
 * Decide a health verdict from the parsed dashboard.
 *
 * Ordered worst-first so the caller can surface the single most important reason.
 */
function assessHealth(repo) {
  const reasons = [];
  let level = 'ok';

  const escalate = (next) => {
    const rank = { ok: 0, info: 1, unsynced: 2, warn: 3, alert: 4 };
    if (rank[next] > rank[level]) level = next;
  };

  if (!repo.dashboard) {
    // Only reachable for fleet members, since non-members are never collected.
    return {
      level: 'gap',
      reasons: ['In the sync fleet but has no Dependency Dashboard — Renovate is not reporting.'],
    };
  }

  if (!repo.inFleet) {
    // Renovate runs here, but the repo is outside the file-sync map, so it does
    // not receive the shared preset, CI gates or release config. Worth seeing.
    escalate('unsynced');
    reasons.push('Renovate-managed but not in the sync fleet — no shared preset or CI gates.');
  }

  if (repo.problems.length > 0) {
    escalate('alert');
    reasons.push(`Renovate reported ${repo.problems.length} repository problem(s).`);
  }

  if (repo.sectionCounts['Errored'] > 0) {
    escalate('alert');
    reasons.push(`${repo.sectionCounts['Errored']} update(s) errored.`);
  }

  const stale = repo.dashboardAgeDays;
  if (repo.stuckCheckboxes.length > 0) {
    // A tick is a request; a completing run clears it. Survival past a run cycle
    // is the signature of an aborting run — see the EOVERRIDE note up top.
    if (stale !== null && stale > STALE_ALERT_DAYS) {
      escalate('alert');
      reasons.push(
        `${repo.stuckCheckboxes.length} checkbox(es) ticked and untouched for ${Math.floor(stale)}d — run may be aborting before it writes the dashboard.`,
      );
    } else {
      escalate('info');
      reasons.push(
        `${repo.stuckCheckboxes.length} checkbox(es) ticked — expected to clear on the next run.`,
      );
    }
  }

  if (repo.sectionCounts['Edited/Blocked'] > 0) {
    escalate('warn');
    reasons.push(`${repo.sectionCounts['Edited/Blocked']} PR(s) edited or blocked.`);
  }

  if (repo.sectionCounts['Config Migration Needed'] > 0) {
    escalate('warn');
    reasons.push('Config migration needed.');
  }

  if (stale !== null && stale > STALE_WARN_DAYS && repo.pendingCount > 0) {
    escalate('warn');
    reasons.push(
      `Dashboard unchanged for ${Math.floor(stale)}d with ${repo.pendingCount} item(s) pending.`,
    );
  }

  if (repo.oldestPrAgeDays !== null && repo.oldestPrAgeDays > OLD_PR_WARN_DAYS) {
    escalate('warn');
    reasons.push(`Oldest open Renovate PR is ${Math.floor(repo.oldestPrAgeDays)}d old.`);
  }

  if (reasons.length === 0) {
    reasons.push(
      repo.pendingCount > 0
        ? `${repo.pendingCount} update(s) pending, nothing stuck.`
        : 'Nothing pending.',
    );
  }

  return { level, reasons };
}

async function collectRepo(nameWithOwner, dashboardsByRepo, fleet, ignorePatterns = []) {
  const dashboard = dashboardsByRepo.get(nameWithOwner) ?? null;

  const repo = {
    nameWithOwner,
    name: nameWithOwner.split('/')[1] ?? nameWithOwner,
    dashboard: dashboard ? { number: dashboard.number, url: dashboard.html_url } : null,
    dashboardUpdatedAt: dashboard?.updated_at ?? null,
    dashboardAgeDays: daysSince(dashboard?.updated_at),
    mendUrl: `https://developer.mend.io/github/${nameWithOwner}`,
    sections: {},
    sectionCounts: {},
    problems: [],
    stuckCheckboxes: [],
    detectedDependencies: 0,
    pendingCount: 0,
    openPrs: [],
    oldestPrAgeDays: null,
    inFleet: fleet.has(nameWithOwner),
    ignoredCount: 0,
  };

  if (dashboard?.body) {
    const sections = splitSections(dashboard.body);

    for (const { name } of SECTIONS) {
      const body = sections.get(name);
      if (body === undefined) {
        repo.sectionCounts[name] = 0;
        continue;
      }

      if (name === 'Detected Dependencies') {
        repo.detectedDependencies = countDetectedDependencies(body);
        repo.sectionCounts[name] = repo.detectedDependencies;
        continue;
      }

      if (name === 'Repository problems') {
        repo.problems = parseProblems(body);
        repo.sectionCounts[name] = repo.problems.length;
        continue;
      }

      const parsed = parseCheckboxes(body).filter((i) => !i.isMeta);
      const items = parsed.filter((i) => !shouldIgnore(i, name, ignorePatterns));
      repo.ignoredCount += parsed.length - items.length;

      repo.sections[name] = items;
      repo.sectionCounts[name] = items.length;
      repo.stuckCheckboxes.push(
        ...items.filter((i) => i.checked).map((i) => ({ section: name, title: i.title })),
      );
    }

    // "Ignored or Blocked" is a standing list of things deliberately not updated,
    // not work in flight, so it stays out of the pending total.
    repo.pendingCount = Object.entries(repo.sectionCounts)
      .filter(
        ([name]) =>
          name !== 'Detected Dependencies' &&
          name !== 'Repository problems' &&
          name !== 'Ignored or Blocked',
      )
      .reduce((sum, [, count]) => sum + count, 0);
  }

  try {
    const prs = await ghJson([
      'pr',
      'list',
      '--repo',
      nameWithOwner,
      '--state',
      'open',
      '--app',
      'renovate',
      '--limit',
      '100',
      '--json',
      'number,title,createdAt,url,isDraft',
    ]);
    repo.openPrs = prs ?? [];
    const ages = repo.openPrs.map((p) => daysSince(p.createdAt)).filter((d) => d !== null);
    repo.oldestPrAgeDays = ages.length ? Math.max(...ages) : null;
  } catch {
    // A repo we cannot read PRs for should not sink the whole run.
    repo.openPrs = [];
  }

  const health = assessHealth(repo);
  repo.health = health.level;
  repo.reasons = health.reasons;
  return repo;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const HEALTH_ORDER = { alert: 0, gap: 1, warn: 2, unsynced: 3, info: 4, ok: 5 };
const HEALTH_LABEL = {
  alert: 'Investigate',
  gap: 'Not reporting',
  warn: 'Attention',
  unsynced: 'Outside fleet',
  info: 'Pending',
  ok: 'Healthy',
};

function renderHtml(allRepos, meta) {
  const repos = allRepos;

  const sorted = [...repos].sort((a, b) => {
    const byHealth = HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health];
    if (byHealth !== 0) return byHealth;
    if (b.pendingCount !== a.pendingCount) return b.pendingCount - a.pendingCount;
    return a.name.localeCompare(b.name);
  });

  const tally = sorted.reduce((acc, r) => {
    acc[r.health] = (acc[r.health] ?? 0) + 1;
    return acc;
  }, {});

  const totals = {
    repos: sorted.length,
    pending: sorted.reduce((s, r) => s + r.pendingCount, 0),
    openPrs: sorted.reduce((s, r) => s + r.openPrs.length, 0),
    deps: sorted.reduce((s, r) => s + r.detectedDependencies, 0),
    ignored: sorted.reduce((s, r) => s + (r.ignoredCount ?? 0), 0),
  };

  const needsAttention = sorted.filter(
    (r) => r.health === 'alert' || r.health === 'gap' || r.health === 'warn',
  ).length;

  const summaryCards = [
    { label: 'Repos in scope', value: totals.repos },
    { label: 'Need attention', value: needsAttention },
    { label: 'Pending updates', value: totals.pending },
    { label: 'Open Renovate PRs', value: totals.openPrs },
    { label: 'Tracked dependencies', value: totals.deps },
  ];

  const pendingSectionNames = SECTIONS.map((s) => s.name).filter(
    (n) => n !== 'Detected Dependencies' && n !== 'Repository problems',
  );

  const rows = sorted
    .map((repo) => {
      const badges = pendingSectionNames
        .filter((name) => repo.sectionCounts[name] > 0)
        .map(
          (name) =>
            `<span class="chip chip--${SECTION_SEVERITY.get(name)}">${escapeHtml(name)} ${repo.sectionCounts[name]}</span>`,
        )
        .join('');

      const items = pendingSectionNames
        .flatMap((name) =>
          (repo.sections[name] ?? []).map(
            (item) =>
              `<li><span class="item-section">${escapeHtml(name)}</span> ${escapeHtml(item.title)}${
                item.checked ? ' <span class="chip chip--alert">ticked</span>' : ''
              }</li>`,
          ),
        )
        .join('');

      const problems = repo.problems.length
        ? `<div class="problems"><strong>Repository problems</strong><ul>${repo.problems
            .map((p) => `<li>${escapeHtml(p)}</li>`)
            .join('')}</ul></div>`
        : '';

      const prs = repo.openPrs.length
        ? `<div class="prs"><strong>Open PRs</strong><ul>${repo.openPrs
            .map(
              (p) =>
                `<li><a href="${escapeHtml(p.url)}">#${p.number}</a> ${escapeHtml(p.title)} <span class="muted">${Math.floor(daysSince(p.createdAt) ?? 0)}d</span></li>`,
            )
            .join('')}</ul></div>`
        : '';

      const age =
        repo.dashboardAgeDays === null ? '—' : `${Math.floor(repo.dashboardAgeDays)}d ago`;

      const detail =
        items || problems || prs
          ? `<tr class="detail detail--${repo.health}"><td colspan="5"><div class="detail-inner">${problems}${
              items ? `<div class="items"><strong>Dashboard items</strong><ul>${items}</ul></div>` : ''
            }${prs}</div></td></tr>`
          : '';

      return `<tr class="row row--${repo.health}">
  <td class="repo">
    <a href="${escapeHtml(repo.dashboard?.url ?? `https://github.com/${repo.nameWithOwner}`)}">${escapeHtml(repo.name)}</a>
    <a class="mend" href="${escapeHtml(repo.mendUrl)}" title="Authoritative run log on the Mend portal">Mend&nbsp;↗</a>
  </td>
  <td><span class="status status--${repo.health}">${HEALTH_LABEL[repo.health]}</span></td>
  <td class="reasons">${repo.reasons.map((r) => `<div>${escapeHtml(r)}</div>`).join('')}</td>
  <td class="chips">${badges || '<span class="muted">—</span>'}</td>
  <td class="age">${age}</td>
</tr>${detail}`;
    })
    .join('\n');

  // The doctype and charset are for the standalone file, which is the usual way
  // this is read (`open renovate-fleet-dashboard.html`): without a doctype the
  // page parses in quirks mode, and the content carries em dashes, middots and
  // arrows that a local file with no declared encoding leaves to browser
  // sniffing. When the same file is published as an Artifact the host supplies
  // its own skeleton, and a second doctype inside <body> is a parse error whose
  // token the HTML5 parser discards — harmless there, correct here.
  return `<!doctype html>
<meta charset="utf-8">
<title>Renovate fleet dashboard — ${escapeHtml(meta.org)}</title>
<style>
  :root {
    /* Neutrals carry a slight cool bias so they sit with the steel-blue accent
       rather than reading as an untouched default grey. */
    --bg: #f7f9fb;
    --surface: #ffffff;
    --border: #e0e6ec;
    --text: #14181d;
    --muted: #5f6b78;
    --accent: #2b5c9a;
    --alert-bg: #fdeceb; --alert-fg: #a32218; --alert-bd: #f2c4c0;
    --warn-bg: #fdf3e2;  --warn-fg: #8a5a12; --warn-bd: #f0dcb4;
    --info-bg: #eaf1f9;  --info-fg: #2b5c9a; --info-bd: #c9dcf0;
    --ok-bg: #eaf4ec;    --ok-fg: #2c6b3f;  --ok-bd: #c6e2cf;
    --muted-bg: #f1f0ed; --muted-fg: #6b6862; --muted-bd: #e0ded9;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #12161b;
      --surface: #1a1f26;
      --border: #2e3742;
      --text: #e8edf2;
      --muted: #9aa7b4;
      --accent: #8ab4e8;
      --alert-bg: #3a1e1c; --alert-fg: #f2a9a2; --alert-bd: #5c2f2b;
      --warn-bg: #362a17;  --warn-fg: #e8c184; --warn-bd: #55421f;
      --info-bg: #1c2a3c;  --info-fg: #9dc2ea; --info-bd: #2f4459;
      --ok-bg: #1b2f22;    --ok-fg: #9ed4ae;  --ok-bd: #2d4a36;
      --muted-bg: #26262c; --muted-fg: #a2a0a8; --muted-bd: #3a3a42;
    }
  }
  :root[data-theme="dark"] {
    --bg: #12161b;
    --surface: #1a1f26;
    --border: #2e3742;
    --text: #e8edf2;
    --muted: #9aa7b4;
    --accent: #8ab4e8;
    --alert-bg: #3a1e1c; --alert-fg: #f2a9a2; --alert-bd: #5c2f2b;
    --warn-bg: #362a17;  --warn-fg: #e8c184; --warn-bd: #55421f;
    --info-bg: #1c2a3c;  --info-fg: #9dc2ea; --info-bd: #2f4459;
    --ok-bg: #1b2f22;    --ok-fg: #9ed4ae;  --ok-bd: #2d4a36;
    --muted-bg: #26262c; --muted-fg: #a2a0a8; --muted-bd: #3a3a42;
  }

  /* Almost every value on this page is a package spec, branch name, repo slug or
     count, so the data face is monospace and the sans is reserved for prose. */
  :root {
    --sans: ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }

  body {
    margin: 0;
    padding: 2rem 1.25rem 4rem;
    background: var(--bg);
    color: var(--text);
    font: 15px/1.55 var(--sans);
  }
  .wrap { max-width: 1180px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin: 0 0 .35rem; letter-spacing: -.01em; }
  .sub { color: var(--muted); margin: 0 0 1.75rem; font-size: .92rem; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .muted { color: var(--muted); }

  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: .75rem; margin-bottom: 1.5rem; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: .85rem 1rem; }
  .card .n { font-size: 1.6rem; font-weight: 600; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .card .l { color: var(--muted); font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; }

  .note { background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 8px; padding: .8rem 1rem; margin-bottom: 1.5rem; font-size: .88rem; color: var(--muted); }
  .note strong { color: var(--text); }

  .table-scroll { overflow-x: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; }
  table { border-collapse: collapse; width: 100%; min-width: 860px; }
  th { text-align: left; font-size: .74rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); padding: .7rem .9rem; border-bottom: 1px solid var(--border); font-weight: 600; }
  td { padding: .7rem .9rem; border-bottom: 1px solid var(--border); vertical-align: top; font-size: .9rem; }
  tr:last-child td { border-bottom: none; }
  .repo a { font-weight: 600; font-family: var(--mono); font-size: .88rem; }
  .repo .mend { display: block; font-family: var(--sans); font-size: .75rem; font-weight: 400; color: var(--muted); }
  .reasons div { margin-bottom: .2rem; }
  .age { white-space: nowrap; color: var(--muted); font-variant-numeric: tabular-nums; font-family: var(--mono); font-size: .82rem; }

  /* Severity reads from the row's own form, so a page of green scans in one pass
     and anything that needs attention breaks the pattern before you read a word. */
  .row td:first-child { border-left: 3px solid transparent; }
  .row--alert td:first-child, .row--gap td:first-child { border-left-color: var(--alert-fg); }
  .row--warn td:first-child { border-left-color: var(--warn-fg); }
  .row--unsynced td:first-child { border-left-color: var(--info-fg); }
  .row--ok td:first-child { border-left-color: var(--ok-bd); }
  .row--warn td { background: color-mix(in srgb, var(--warn-bg) 22%, transparent); }
  .row--alert td, .row--gap td { background: color-mix(in srgb, var(--alert-bg) 26%, transparent); }

  .status { display: inline-block; padding: .12rem .5rem; border-radius: 999px; font-size: .76rem; font-weight: 600; white-space: nowrap; border: 1px solid; }
  .status--alert { background: var(--alert-bg); color: var(--alert-fg); border-color: var(--alert-bd); }
  .status--warn { background: var(--warn-bg); color: var(--warn-fg); border-color: var(--warn-bd); }
  .status--info { background: var(--info-bg); color: var(--info-fg); border-color: var(--info-bd); }
  .status--ok { background: var(--ok-bg); color: var(--ok-fg); border-color: var(--ok-bd); }
  .status--gap { background: var(--alert-bg); color: var(--alert-fg); border-color: var(--alert-bd); }
  .status--unsynced { background: var(--info-bg); color: var(--info-fg); border-color: var(--info-bd); }

  .chip { display: inline-block; padding: .08rem .45rem; border-radius: 5px; font-size: .72rem; font-family: var(--mono); margin: 0 .25rem .25rem 0; border: 1px solid; white-space: nowrap; }
  .chip--alert { background: var(--alert-bg); color: var(--alert-fg); border-color: var(--alert-bd); }
  .chip--warn { background: var(--warn-bg); color: var(--warn-fg); border-color: var(--warn-bd); }
  .chip--info { background: var(--info-bg); color: var(--info-fg); border-color: var(--info-bd); }
  .chip--muted { background: var(--muted-bg); color: var(--muted-fg); border-color: var(--muted-bd); }

  .detail td { padding-top: 0; border-left: 3px solid transparent; }
  .detail--alert td, .detail--gap td { border-left-color: var(--alert-fg); background: color-mix(in srgb, var(--alert-bg) 26%, transparent); }
  .detail--warn td { border-left-color: var(--warn-fg); background: color-mix(in srgb, var(--warn-bg) 22%, transparent); }
  .detail--unsynced td { border-left-color: var(--info-fg); }
  .detail--ok td { border-left-color: var(--ok-bd); }
  .detail-inner { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); font-size: .84rem; }
  .detail-inner strong { display: block; font-family: var(--sans); font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin-bottom: .3rem; }
  .detail-inner ul { margin: 0; padding-left: 1.1rem; font-family: var(--mono); font-size: .78rem; }
  .detail-inner li { margin-bottom: .25rem; }
  .item-section { color: var(--muted); font-family: var(--sans); font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; margin-right: .3rem; }
  .problems { grid-column: 1 / -1; }
  .row--alert .repo a:first-child { color: var(--alert-fg); }

  footer { margin-top: 2rem; color: var(--muted); font-size: .82rem; }
</style>

<div class="wrap">
  <h1>Renovate fleet dashboard</h1>
  <p class="sub">${escapeHtml(meta.org)} · ${totals.repos} repositories · generated ${escapeHtml(meta.generatedAt)}</p>

  <div class="cards">
    ${summaryCards.map((c) => `<div class="card"><div class="n">${c.value}</div><div class="l">${escapeHtml(c.label)}</div></div>`).join('')}
  </div>

  <div class="note">
    <strong>Read this before trusting a green row.</strong> Renovate writes the Dependency Dashboard at the
    <em>end</em> of a run, so a run that aborts early leaves the last good dashboard in place — no PR, no error
    comment, no red check. This page infers run health from two proxies: checkboxes that stay ticked, and a
    dashboard that stops changing while work is pending. Neither is authoritative, because Renovate only rewrites
    the issue when the body actually changes and a genuinely idle repo is legitimately quiet.
    The real job log lives on the Mend portal — the <em>Mend&nbsp;↗</em> link on each row.
  </div>

  <div class="table-scroll">
    <table>
      <thead>
        <tr><th>Repository</th><th>Status</th><th>Assessment</th><th>Dashboard sections</th><th>Updated</th></tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>

  <footer>
    ${Object.entries(tally)
      .sort((a, b) => HEALTH_ORDER[a[0]] - HEALTH_ORDER[b[0]])
      .map(([k, v]) => `${v} ${HEALTH_LABEL[k].toLowerCase()}`)
      .join(' · ')}
    ${
      totals.ignored
        ? `<br><span class="muted">${totals.ignored} routine item${totals.ignored === 1 ? '' : 's'}
           hidden by ignore filter${meta.ignore.length === 1 ? '' : 's'}
           ${meta.ignore.map((p) => `<code>${escapeHtml(p)}</code>`).join(', ')} —
           shown anyway when ticked, or when in
           ${escapeHtml(IGNORE_OVERRIDE_SECTIONS.join(' / '))}.
           Re-run with <code>--no-ignore</code> to list them.</span>`
        : ''
    }
    <br><span class="muted">Scope is the ${meta.fleetSize} repos in the file-sync map
    (<code>${escapeHtml(meta.fleetConfig)}</code>) plus any repo Renovate reports on. Other org
    repos are out of scope and not listed.</span>
    <br>Generated by <code>tools/renovate-fleet-dashboard.mjs</code> in digitalnsw/nswds-devops.
  </footer>
</div>
`;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    // A usage error should name the flag and show the flags, not surface as a
    // generic failure alongside real runtime errors.
    process.stderr.write(`${error.message}\n\n${helpText()}`);
    process.exit(1);
  }

  process.stderr.write(`Reading fleet membership from ${opts.fleetConfig}…\n`);

  // Two sources answering two questions: the sync map says who is in the fleet,
  // the issue search says where Renovate is actually reporting. The interesting
  // repos are the ones in one set but not the other.
  const [fleet, dashboardHits] = await Promise.all([
    loadFleet(opts.fleetConfig),
    ghJson([
      'search',
      'issues',
      '--owner',
      opts.org,
      '--state',
      'open',
      '--match',
      'title',
      'Dependency Dashboard',
      '--limit',
      '200',
      '--json',
      'repository,number,url,updatedAt,title',
    ]),
  ]);

  // Keep the issue number the search already returned: fetching that one issue
  // beats listing a page of issues and filtering by title, which both did more
  // API work and would silently miss a dashboard sitting past the first page.
  const dashboards = (dashboardHits ?? [])
    .filter((hit) => hit.title === 'Dependency Dashboard')
    .map((hit) => ({ nameWithOwner: hit.repository.nameWithOwner, number: hit.number }));

  const dashboardRepos = dashboards.map((d) => d.nameWithOwner);

  // Everything else in the org is out of scope by definition and is not listed.
  const allRepos = Array.from(new Set([...fleet, ...dashboardRepos])).sort();

  process.stderr.write(
    `Fleet: ${fleet.size} repos · dashboards found: ${dashboardRepos.length} · reporting on ${allRepos.length}.\n`,
  );

  // The search result omits issue bodies, so fetch each dashboard in full.
  const dashboardsByRepo = new Map();
  await pool(dashboards, opts.concurrency, async ({ nameWithOwner, number }) => {
    let issue = null;
    try {
      issue = await ghJson([
        'api',
        `repos/${nameWithOwner}/issues/${number}`,
        '--jq',
        '{number, html_url, updated_at, body, state, title}',
      ]);
    } catch {
      issue = null;
    }

    if (!isDashboardIssue(issue)) {
      // Say so rather than letting it become a silent `gap`.
      process.stderr.write(
        `  warning: ${nameWithOwner}#${number} is not a readable open Dependency Dashboard — treating as absent.\n`,
      );
      return;
    }
    dashboardsByRepo.set(nameWithOwner, issue);
  });

  const repos = await pool(allRepos, opts.concurrency, (nameWithOwner) =>
    collectRepo(nameWithOwner, dashboardsByRepo, fleet, opts.ignore),
  );

  const meta = {
    org: opts.org,
    fleetSize: fleet.size,
    fleetConfig: opts.fleetConfig,
    ignore: opts.ignore,
    generatedAt: new Date().toLocaleString('en-AU', {
      timeZone: 'Australia/Sydney',
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
  };

  const html = renderHtml(repos, meta);
  await writeFile(opts.out, html, 'utf8');
  process.stderr.write(`Wrote ${opts.out}\n`);

  if (opts.json) {
    await writeFile(opts.json, JSON.stringify({ meta, repos }, null, 2), 'utf8');
    process.stderr.write(`Wrote ${opts.json}\n`);
  }

  const attention = repos.filter(
    (r) => r.health === 'alert' || r.health === 'gap' || r.health === 'warn',
  );
  for (const repo of attention) {
    process.stderr.write(`  [${repo.health}] ${repo.name}: ${repo.reasons[0]}\n`);
  }
  process.stderr.write(
    attention.length === 1
      ? '1 repository needs attention.\n'
      : `${attention.length} repositories need attention.\n`,
  );
}

/**
 * Exported for tests. The failure-path parsing is the part that matters and the
 * fleet is usually green, so it cannot be exercised against live data.
 */
export {
  assessHealth,
  countDetectedDependencies,
  helpText,
  IGNORE_OVERRIDE_SECTIONS,
  isDashboardIssue,
  parseArgs,
  parseCheckboxes,
  parseFleetFromSyncConfig,
  parseProblems,
  renderHtml,
  shouldIgnore,
  splitSections,
};

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`renovate-fleet-dashboard failed: ${error.message}\n`);
    process.exit(1);
  });
}
