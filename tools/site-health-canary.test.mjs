// Guards for site-health-canary.mjs: what it reads as a site or a link, how it
// reads a page's declared address, and which outcomes it reports. The network
// is replaced by a fake fetch, so every case is deterministic.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  checkLink,
  checkSite,
  declaredAddresses,
  isUnresolvable,
  readmeLinks,
  siteUrls,
} from '../.github/scripts/site-health-canary.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const page = (url, html, status = 200) => async () => ({
  url,
  status,
  ok: status >= 200 && status < 300,
  text: async () => html,
})
const unresolvable = async () => {
  throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
}

test('siteUrls takes nsw.gov.au and github.io sites from table cells and prose', () => {
  const md = [
    '| `a` | App | https://app.digital.nsw.gov.au | x |',
    '| `b` | Pages | GitHub Pages (https://digitalnsw.github.io/images/) | x |',
    'Vercel: `web` (https://ui.digital.nsw.gov.au), `storybook`',
    '[![npm](https://img.shields.io/npm/v/@nswds/ui?label=)](https://www.npmjs.com/package/@nswds/ui)',
    'Confluence (GDS space, https://dsia.atlassian.net/wiki)',
    'https://app.digital.nsw.gov.au again',
  ].join('\n')
  assert.deepEqual(siteUrls(md), [
    'https://app.digital.nsw.gov.au/',
    'https://digitalnsw.github.io/images/',
    'https://ui.digital.nsw.gov.au/',
  ])
})

test('siteUrls skips an address quoted in a code span', () => {
  const md = '| `agile` | App | — (its `site.url`, `https://agile.digital.nsw.gov.au`, has no DNS record) |'
  assert.deepEqual(siteUrls(md), [])
})

test('siteUrls reads the real register and finds its live sites', () => {
  const urls = siteUrls(readFileSync(path.join(root, 'FLEET.md'), 'utf8'))
  assert.ok(urls.length >= 10, `only ${urls.length} sites found in FLEET.md`)
  for (const url of urls) assert.match(new URL(url).hostname, /nsw\.gov\.au$|github\.io$/)
})

test('declaredAddresses reads absolute canonical and og:url, in either attribute order', () => {
  const html = `<head>
    <link rel="canonical" href="https://risk.digital.nsw.gov.au">
    <meta content="https://risk.digital.nsw.gov.au" property="og:url">
    <link rel="icon" href="https://elsewhere.example/icon.png">
  </head>`
  assert.deepEqual(declaredAddresses(html), [
    { kind: 'canonical', href: 'https://risk.digital.nsw.gov.au' },
    { kind: 'og:url', href: 'https://risk.digital.nsw.gov.au' },
  ])
})

test('declaredAddresses ignores a relative canonical, which resolves against the page', () => {
  assert.deepEqual(declaredAddresses('<link rel="canonical" href="./">'), [])
})

test('checkSite reports a canonical on another host (the risk-guidance defect)', async () => {
  const html = '<link rel="canonical" href="https://risk.digital.nsw.gov.au">'
  const result = await checkSite(
    'https://ictrisk.digital.nsw.gov.au',
    page('https://ictrisk.digital.nsw.gov.au/', html),
  )
  assert.match(result.problem, /served on ictrisk\.digital\.nsw\.gov\.au but declares canonical/)
})

test('checkSite compares against the host it landed on after redirects', async () => {
  const html = '<link rel="canonical" href="https://design.nsw.gov.au/sign-in">'
  const result = await checkSite(
    'https://design.digital.nsw.gov.au',
    page('https://design.nsw.gov.au/sign-in', html),
  )
  assert.equal(result.ok, true)
})

test('checkSite treats www and the bare host as the same host', async () => {
  const html = '<link rel="canonical" href="https://www.digital.nsw.gov.au/">'
  const result = await checkSite('https://digital.nsw.gov.au', page('https://digital.nsw.gov.au/', html))
  assert.equal(result.ok, true)
})

test('checkSite reports a declared address that is not a valid URL, rather than throwing', async () => {
  const html = '<link rel="canonical" href="https://%">'
  const result = await checkSite('https://x.nsw.gov.au', page('https://x.nsw.gov.au/', html))
  assert.equal(result.problem, 'served on x.nsw.gov.au but declares canonical https://% (not a valid URL)')
})

test('checkSite skips a site whose body fails to arrive, rather than throwing', async () => {
  const stalled = async () => ({
    url: 'https://x.nsw.gov.au/',
    status: 200,
    ok: true,
    text: async () => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    },
  })
  const result = await checkSite('https://x.nsw.gov.au', stalled)
  assert.equal(result.problem, undefined)
  assert.equal(result.skipped, 'request failed (TimeoutError)')
})

test('checkSite reports a site that does not resolve or is gone, and skips a bot wall', async () => {
  assert.equal((await checkSite('https://gone.nsw.gov.au', unresolvable)).problem, 'does not resolve')
  assert.equal((await checkSite('https://x.nsw.gov.au', page('https://x.nsw.gov.au/', '', 404))).problem, 'HTTP 404')
  const wall = await checkSite('https://x.nsw.gov.au', page('https://x.nsw.gov.au/', '', 429))
  assert.equal(wall.problem, undefined)
  assert.match(wall.skipped, /429/)
})

test('readmeLinks keeps external links and drops local, reserved, placeholder and in-org GitHub links', () => {
  const md = [
    'Documentation: https://app.designsystem.nsw.gov.au',
    '[Storybook](https://storybook.digital.nsw.gov.au/?path=/docs).',
    '<https://www.npmjs.com/package/@nswds/app>',
    'Run at http://localhost:3000 or http://127.0.0.1:3101',
    'See https://example.com and https://app.example.org/x',
    'Deploys to https://<project>.vercel.app',
    'Source: https://github.com/digitalnsw/nswds-app/blob/main/README.md',
    'Upstream: https://github.com/vercel/next.js#readme',
  ].join('\n')
  assert.deepEqual(readmeLinks(md), [
    'https://app.designsystem.nsw.gov.au/',
    'https://storybook.digital.nsw.gov.au/?path=/docs',
    'https://www.npmjs.com/package/@nswds/app',
    'https://github.com/vercel/next.js',
  ])
})

test('readmeLinks skips fenced code blocks and inline code, which hold examples', () => {
  const md = [
    'Docs: https://docs.nsw.gov.au/',
    '```sh',
    "curl -sA 'facebookexternalhit/1.1' https://site.nsw.gov.au/ | grep og:",
    '```',
    'Set `url: https://your-site.nsw.gov.au` in `lib/site.ts`.',
  ].join('\n')
  assert.deepEqual(readmeLinks(md), ['https://docs.nsw.gov.au/'])
})

test('readmeLinks closes a fence only where CommonMark does', () => {
  const md = [
    'Docs: https://docs.nsw.gov.au/',
    // A longer fence quoting a shorter one: the inner ``` lines are content.
    '````md',
    '```sh',
    'curl https://quoted.nsw.gov.au/',
    '```',
    'https://still-quoted.nsw.gov.au/',
    '````',
    // A closer cannot carry an info string, and ~~~ cannot close ```.
    '```',
    '```js',
    '~~~',
    'https://info-string.nsw.gov.au/',
    '```',
    // A fence indented inside a list item is still code.
    '- Step one:',
    '   ```sh',
    '   curl https://in-list.nsw.gov.au/',
    '   ```',
    // Nested deeper than CommonMark's three spaces of top-level indent.
    '  - Step two:',
    '        ```sh',
    '        curl https://in-nested-list.nsw.gov.au/',
    '        ```',
    'After: https://after.nsw.gov.au/',
  ].join('\n')
  assert.deepEqual(readmeLinks(md), ['https://docs.nsw.gov.au/', 'https://after.nsw.gov.au/'])
})

test('readmeLinks treats an unclosed fence as code to the end of the README', () => {
  const md = ['Docs: https://docs.nsw.gov.au/', '```sh', 'curl https://unclosed.nsw.gov.au/'].join('\n')
  assert.deepEqual(readmeLinks(md), ['https://docs.nsw.gov.au/'])
})

test('readmeLinks keeps a link with a malformed percent escape, rather than throwing', () => {
  assert.deepEqual(readmeLinks('See https://docs.nsw.gov.au/%ZZ and https://ui.digital.nsw.gov.au/'), [
    'https://docs.nsw.gov.au/%ZZ',
    'https://ui.digital.nsw.gov.au/',
  ])
})

test('readmeLinks drops a link cut short by a raw angle-bracket placeholder', () => {
  const md = [
    'Preview: https://app-<env>.vercel.app',
    'Edit: https://x.vercel.app/<id>/edit',
    'Share: https://digitalnsw.github.io/share/<path>',
    'Autolink: <https://ui.digital.nsw.gov.au/>',
  ].join('\n')
  assert.deepEqual(readmeLinks(md), ['https://ui.digital.nsw.gov.au/'])
})

test('readmeLinks drops brace placeholders, written raw or percent-encoded', () => {
  const md = 'Deploys to https://{project}.vercel.app and https://x.vercel.app/%7Bid%7D/edit'
  assert.deepEqual(readmeLinks(md), [])
})

test('checkLink reports a dead host and a confirmed 404, and nothing a bot wall returns', async () => {
  assert.equal((await checkLink('https://app.designsystem.nsw.gov.au', unresolvable)).problem, 'does not resolve')
  assert.equal((await checkLink('https://x.test/gone', page('', '', 404))).problem, 'HTTP 404')
  assert.equal((await checkLink('https://x.test/wall', page('', '', 403))).ok, true)
})

test('checkLink confirms a HEAD 404 with GET before reporting it', async () => {
  const calls = []
  const fake = async (href, method = 'GET') => {
    calls.push(method)
    return { status: method === 'HEAD' ? 404 : 200, ok: method !== 'HEAD' }
  }
  assert.equal((await checkLink('https://x.test/page', fake)).ok, true)
  assert.deepEqual(calls, ['HEAD', 'GET'])
})

test('isUnresolvable is true only for a host that does not exist', () => {
  assert.equal(isUnresolvable({ cause: { code: 'ENOTFOUND' } }), true)
  assert.equal(isUnresolvable({ cause: { code: 'ECONNRESET' } }), false)
  assert.equal(isUnresolvable({ cause: { code: 'EAI_AGAIN' } }), false)
  assert.equal(isUnresolvable({ name: 'TimeoutError' }), false)
})
