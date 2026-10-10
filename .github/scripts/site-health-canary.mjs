// Canary for the fleet's public addresses: live sites and README links.
//
// Two classes of defect have each shipped across several repos without any
// check noticing, because both look healthy from inside the repo:
//
//   A site that declares its canonical address on a host it is not served on.
//   `site.url` becomes `metadataBase`, so a stale or speculative value turns
//   every page's `<link rel="canonical">` and `og:url` into a pointer at
//   another app or at a host with no DNS record. The page still renders, so
//   nothing in the repo's CI can tell.
//
//   A README or FLEET.md link to a host that no longer resolves, after a
//   domain moves or a project is renamed.
//
// SITES are every https URL on an `*.nsw.gov.au` or `*.github.io` host in
// the prose of FLEET.md (not in code spans), the register of where each repo is served. Each is fetched
// following redirects; the canonical and og:url of the page it lands on must
// name the host that served it (a `www.` prefix is ignored). A site that does
// not resolve, or answers 404/410/5xx, is reported too. 401, 403 and 429 are
// bot walls (Vercel's security checkpoint answers 429), not evidence either
// way, so they are logged and skipped.
//
// LINKS are the http(s) links in the prose of every non-archived org repo's
// README (code blocks and inline code are examples, so they are skipped). Only
// failures that cannot be a bot wall or a blip are reported: a host that
// does not resolve, and a 404 or 410 confirmed by GET. Links into this org on
// github.com are skipped, because most of its repos are private and answer
// 404 to an anonymous request.
//
// Needs the sync GitHub App to read private repos' READMEs; the site checks
// are anonymous on purpose, to see what a search engine sees.
//
// Repo-local to nswds-devops — NOT synced to consumers.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ORG = 'digitalnsw'
const TIMEOUT_MS = 20_000
const CONCURRENCY = 8
const USER_AGENT = 'nswds-devops-site-health-canary (+https://github.com/digitalnsw/nswds-devops)'

/** Hosts FLEET.md serves sites from. Badges, npm and docs links are not sites. */
const SITE_HOST = /(^|\.)nsw\.gov\.au$|\.github\.io$/

/** Statuses that mean "something refused a bot", not "the page is gone". */
const BOT_WALL = new Set([401, 403, 429])

/** Trailing characters that end a URL in prose rather than belong to it. */
const TRAILING = /[).,;:!?'"`*_\]>]+$/

const sameHost = (a, b) => a.replace(/^www\./, '') === b.replace(/^www\./, '')

/** Every distinct https site URL FLEET.md lists, in order of first mention. */
export function siteUrls(markdown) {
  // An address in a code span is quoted, not listed: FLEET.md writes a repo's
  // unresolvable `site.url` that way to record that it has no DNS record.
  const prose = markdown.replace(/`[^`\n]*`/g, '')
  const seen = new Set()
  for (const raw of prose.match(/https:\/\/[^\s|)`<>\]]+/g) ?? []) {
    const href = raw.replace(TRAILING, '')
    let url
    try {
      url = new URL(href)
    } catch {
      continue
    }
    if (SITE_HOST.test(url.hostname)) seen.add(url.href)
  }
  return [...seen]
}

/** The absolute canonical and og:url hrefs a page declares, as written. */
export function declaredAddresses(html) {
  const found = []
  for (const tag of html.match(/<(?:link|meta)\b[^>]*>/gi) ?? []) {
    const attr = (name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1]
    const isCanonical = /^canonical$/i.test(attr('rel') ?? '')
    const isOgUrl = /^og:url$/i.test(attr('property') ?? '')
    const value = isCanonical ? attr('href') : isOgUrl ? attr('content') : undefined
    if (value === undefined) continue
    // A relative canonical (`./`) resolves against the page itself, so it can
    // never name another host.
    if (!/^https?:\/\//i.test(value)) continue
    found.push({ kind: isCanonical ? 'canonical' : 'og:url', href: value })
  }
  return found
}

/** Every distinct http(s) link in a README worth checking. */
export function readmeLinks(markdown) {
  // Code is examples, not links: a `curl https://site.nsw.gov.au/` in a fenced
  // block or an inline span names a placeholder the reader substitutes.
  const prose = markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '')
  const seen = new Set()
  for (const raw of prose.match(/https?:\/\/[^\s<>"'`)\]]+/g) ?? []) {
    const href = raw.replace(TRAILING, '')
    let url
    try {
      url = new URL(href)
    } catch {
      continue
    }
    const host = url.hostname
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') continue
    // Reserved for documentation (RFC 2606); never meant to resolve.
    if (/(^|\.)example\.(com|org|net)$|\.(example|test|invalid|localhost)$/.test(host)) continue
    // Template placeholders such as https://<project>.vercel.app.
    if (/[{}<>]/.test(decodeURI(href))) continue
    if (host === 'github.com' && url.pathname.toLowerCase().startsWith(`/${ORG}/`)) continue
    url.hash = ''
    seen.add(url.href)
  }
  return [...seen]
}

/** A fetch failure that means the host does not exist (as opposed to a blip). */
export function isUnresolvable(error) {
  const code = error?.cause?.code ?? error?.code
  return code === 'ENOTFOUND'
}

async function get(href, method = 'GET') {
  return fetch(href, {
    method,
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*;q=0.8' },
  })
}

/** Checks one site: reachable, and declaring its canonical on its own host. */
export async function checkSite(href, fetchPage = get) {
  let res
  try {
    res = await fetchPage(href)
  } catch (error) {
    if (isUnresolvable(error)) return { href, problem: 'does not resolve' }
    return { href, skipped: `request failed (${error?.cause?.code ?? error?.name ?? 'error'})` }
  }
  if (BOT_WALL.has(res.status)) return { href, skipped: `HTTP ${res.status} (bot wall)` }
  if (!res.ok) return { href, problem: `HTTP ${res.status}` }
  const served = new URL(res.url || href).hostname
  const html = await res.text()
  const wrong = declaredAddresses(html).filter((d) => !sameHost(new URL(d.href).hostname, served))
  if (wrong.length === 0) return { href, ok: true }
  return {
    href,
    problem: `served on ${served} but declares ${wrong.map((d) => `${d.kind} ${d.href}`).join(' and ')}`,
  }
}

/** Checks one README link: reported only if the host is gone or the page is. */
export async function checkLink(href, fetchPage = get) {
  try {
    let res = await fetchPage(href, 'HEAD')
    // Plenty of servers answer HEAD with 404 or 405 and GET with the page.
    if (res.status === 404 || res.status === 410 || res.status === 405) res = await fetchPage(href)
    if (res.status === 404 || res.status === 410) return { href, problem: `HTTP ${res.status}` }
    return { href, ok: true }
  } catch (error) {
    if (isUnresolvable(error)) return { href, problem: 'does not resolve' }
    return { href, ok: true }
  }
}

async function pool(items, worker) {
  const results = []
  let next = 0
  const run = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run))
  return results
}

async function main() {
  const token = process.env.GH_TOKEN
  if (!token) {
    console.error('::error::GH_TOKEN is required')
    process.exit(1)
  }

  const api = async (path, { raw = false } = {}) => {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
        'user-agent': USER_AGENT,
      },
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`)
    return raw ? res.text() : res.json()
  }

  // Sites, from the register.
  const fleet = readFileSync(new URL('../../FLEET.md', import.meta.url), 'utf8')
  const sites = siteUrls(fleet)
  console.log(`Checking ${sites.length} sites listed in FLEET.md`)
  const siteResults = await pool(sites, (href) => checkSite(href))

  // README links, from every non-archived repo.
  const repos = []
  for (let page = 1; ; page++) {
    const batch = await api(`/orgs/${ORG}/repos?per_page=100&page=${page}&type=all`)
    if (!batch?.length) break
    repos.push(...batch.filter((r) => !r.archived).map((r) => r.name))
    if (batch.length < 100) break
  }
  const linkedFrom = new Map()
  for (const name of repos) {
    const readme = await api(`/repos/${ORG}/${name}/readme`, { raw: true })
    for (const href of readmeLinks(readme ?? '')) {
      linkedFrom.set(href, [...(linkedFrom.get(href) ?? []), name])
    }
  }
  console.log(`Checking ${linkedFrom.size} distinct links in ${repos.length} READMEs`)
  const linkResults = await pool([...linkedFrom.keys()], (href) => checkLink(href))

  const badSites = siteResults.filter((r) => r.problem)
  const badLinks = linkResults.filter((r) => r.problem)
  for (const r of siteResults) {
    console.log(`  [site] ${r.problem ? 'FAIL' : r.skipped ? 'skip' : 'ok  '} ${r.href} ${r.problem ?? r.skipped ?? ''}`)
  }
  for (const r of badLinks) {
    console.log(`  [link] FAIL ${r.href} ${r.problem} (in ${linkedFrom.get(r.href).join(', ')})`)
  }

  const drifted = badSites.length + badLinks.length > 0
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `drifted=${drifted}\n`)
  if (!drifted) {
    console.log('Every listed site answers on its own canonical host, and no README link is dead.')
    return
  }

  const section = (title, rows) => (rows.length ? `\n## ${title}\n\n${rows.join('\n')}\n` : '')
  const body = `The weekly site health canary found ${ORG} addresses that are wrong or gone.

A site whose canonical names another host tells search engines and link previews that every page lives somewhere else. The usual cause is a stale \`site.url\` (it becomes \`metadataBase\`), fixed in the repo's \`lib/site\` module. A site or link that does not resolve usually means a domain moved or a project was renamed.
${section(
  'Sites (from FLEET.md)',
  badSites.map((r) => `- ${r.href}: ${r.problem}`),
)}${section(
  'README links',
  badLinks.map((r) => `- ${r.href}: ${r.problem}, in ${linkedFrom.get(r.href).map((n) => `\`${n}\``).join(', ')}`),
)}
Bot walls (401, 403, 429) and network blips are not reported. Close this issue once the run is clean; the next run opens a fresh one if anything is still wrong.
`
  const bodyFile = join(tmpdir(), 'site-health-canary.md')
  writeFileSync(bodyFile, body)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `body_file=${bodyFile}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
