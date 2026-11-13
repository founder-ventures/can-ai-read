import { test } from "node:test"
import assert from "node:assert/strict"
import { HTML, TEXT, fixture, goodSite, mockSite } from "./site.js"
import { check, compare, UnreachableError, USER_AGENT } from "../src/index.js"
import { normalizeUrl, pickPages } from "../src/scan.js"
import { parseXRobotsTag } from "../src/checks.js"

/** @param {import("../src/checks.js").Report} r @param {string} id */
const byId = (r, id) => {
  const found = r.checks.find(c => c.id === id)
  assert.ok(found, `no check ${id}`)
  return found
}

test("a well-built site scores 100 with no errors", async () => {
  const site = goodSite()
  const r = await check("example.com", { fetch: site.fetch })
  assert.equal(r.score, 100, r.checks.filter(c => c.points < c.maxPoints).map(c => `${c.id}: ${c.summary}`).join("; "))
  assert.equal(r.errors, 0)
  assert.equal(r.warnings, 0)
  assert.equal(r.maxScore, 100)
  assert.equal(r.categories.reduce((a, c) => a + c.maxPoints, 0), 100)
  assert.deepEqual(r.pages.map(p => p.path), ["/", "/pricing", "/blog/late-payments"])
  assert.match(byId(r, "says-what-it-is").summary, /Acme is an invoicing tool/)
})

test("every check's points add up to the score and never exceed their maximum", async () => {
  const r = await check("https://example.com", { fetch: goodSite().fetch })
  for (const c of r.checks) assert.ok(c.points >= 0 && c.points <= c.maxPoints, c.id)
  assert.equal(r.checks.reduce((a, c) => a + c.points, 0), r.score)
})

test("requests are polite: a named User-Agent, the default budget of 6, the listed order", async () => {
  const site = goodSite()
  const r = await check("https://example.com", { fetch: site.fetch })
  assert.equal(r.requests.used, 6)
  assert.deepEqual(
    site.calls.map(c => c.url),
    [
      "https://example.com/",
      "https://example.com/robots.txt",
      "https://example.com/sitemap.xml",
      "https://example.com/llms.txt",
      "https://example.com/pricing",
      "https://example.com/blog/late-payments"
    ]
  )
  for (const call of site.calls) {
    assert.equal(call.headers["user-agent"], USER_AGENT)
    assert.match(call.headers["user-agent"], /^can-ai-read\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\//)
  }
})

test("--pages 0 checks only the URL and its files", async () => {
  const site = goodSite()
  const r = await check("https://example.com", { fetch: site.fetch, pages: 0 })
  assert.equal(r.pages.length, 1)
  assert.equal(r.requests.used, 4)
})

test("blocked search crawlers are an error, blocked training crawlers a warning", async () => {
  const site = goodSite({ "https://example.com/robots.txt": { body: fixture("robots/ai-blocked.txt"), headers: TEXT } })
  const r = await check("https://example.com", { fetch: site.fetch })
  const search = byId(r, "search-crawlers")
  assert.equal(search.status, "fail")
  assert.equal(search.severity, "error")
  assert.equal(search.points, 25 - 4 - 3)
  assert.match(search.summary, /OAI-SearchBot and PerplexityBot are blocked/)
  assert.match(search.details[0], /line 6 "Disallow: \/" in the group for User-agent: OAI-SearchBot/)
  assert.match(search.fix ?? "", /Remove the Disallow rule/)
  const training = byId(r, "training-crawlers")
  assert.equal(training.status, "warn")
  assert.equal(training.severity, "warning")
  assert.equal(training.points, 10 - 3 - 2)
  assert.ok(training.details.some(d => /legitimate choice/.test(d)))
  assert.equal(r.errors, 1)
  assert.equal(r.crawlers.find(c => c.token === "GPTBot")?.state, "blocked")
})

test("the fix for a * block repeats the site's other rules in the new group", async () => {
  const site = goodSite({
    "https://example.com/robots.txt": { body: "User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nDisallow: /admin/\n", headers: TEXT }
  })
  const r = await check("https://example.com", { fetch: site.fetch })
  const search = byId(r, "search-crawlers")
  assert.match(search.fix ?? "", /User-agent: OAI-SearchBot\nUser-agent: ChatGPT-User/)
  assert.match(search.fix ?? "", /Allow: \/$/)
  // Googlebot has its own group and is allowed, so it is not in the fix.
  assert.ok(!/User-agent: Googlebot/.test(search.fix ?? ""))
  // The site blocks every unnamed crawler, this tool included, so it fetched no extra pages.
  assert.equal(r.pages.length, 1)
  assert.ok(r.skipped.length >= 1)
})

test("partial blocks cost half the points", async () => {
  const site = goodSite({ "https://example.com/robots.txt": { body: "User-agent: PerplexityBot\nDisallow: /pricing\n", headers: TEXT } })
  const r = await check("https://example.com", { fetch: site.fetch })
  const perplexity = r.crawlers.find(c => c.token === "PerplexityBot")
  assert.equal(perplexity?.state, "partial")
  assert.equal(perplexity?.points, 1)
  assert.equal(byId(r, "search-crawlers").status, "warn")
})

test("an unreachable robots.txt counts as a full block and stops further fetches", async () => {
  const site = goodSite({ "https://example.com/robots.txt": { status: 503, body: "busy", headers: TEXT } })
  const r = await check("https://example.com", { fetch: site.fetch })
  assert.equal(byId(r, "robots-txt").severity, "error")
  assert.equal(byId(r, "search-crawlers").points, 0)
  assert.equal(byId(r, "training-crawlers").points, 0)
  assert.deepEqual(site.calls.map(c => c.url), ["https://example.com/", "https://example.com/robots.txt"])
  assert.equal(byId(r, "sitemap").status, "skip")
})

test("a missing robots.txt allows every crawler", async () => {
  const site = goodSite({ "https://example.com/robots.txt": { status: 404, body: "nope" } })
  const r = await check("https://example.com", { fetch: site.fetch })
  assert.equal(byId(r, "search-crawlers").points, 25)
  assert.equal(byId(r, "robots-txt").status, "info")
  assert.match(byId(r, "robots-txt").summary, /Not found/)
  // No Sitemap line, but /sitemap.xml exists: found, not listed.
  assert.equal(byId(r, "sitemap").points, 2)
})

test("the robots.txt trap is reported", async () => {
  const site = goodSite({ "https://example.com/robots.txt": { body: fixture("robots/trap.txt"), headers: TEXT } })
  const r = await check("https://example.com", { fetch: site.fetch })
  const robots = byId(r, "robots-txt")
  assert.equal(robots.status, "warn")
  assert.ok(robots.details.some(d => /GPTBot has its own group/.test(d)))
})

test("a client-rendered page is an error", async () => {
  const spa = { body: fixture("spa.html"), headers: HTML }
  const site = goodSite({
    "https://example.com/": spa,
    "https://example.com/pricing": spa,
    "https://example.com/blog/late-payments": spa
  })
  const r = await check("https://example.com", { fetch: site.fetch })
  const text = byId(r, "server-text")
  assert.equal(text.status, "fail")
  assert.equal(text.severity, "error")
  assert.equal(text.points, 0)
  assert.ok(text.details.some(d => /#root is empty/.test(d)))
  assert.equal(text.learnMore, "https://vercel.com/blog/the-rise-of-the-ai-crawler")
})

test("a server-rendered start page with client-rendered inner pages keeps partial points", async () => {
  const spa = { body: fixture("spa.html"), headers: HTML }
  const r = await check("https://example.com", { fetch: goodSite({ "https://example.com/pricing": spa }).fetch })
  const text = byId(r, "server-text")
  assert.equal(text.status, "warn")
  assert.equal(text.points, 13)
})

test("noindex on the page is an error, but a preview deployment's header is not counted", async () => {
  const meta = fixture("good/home.html").replace("<head>", '<head><meta name="robots" content="noindex">')
  const r1 = await check("https://example.com", { fetch: goodSite({ "https://example.com/": { body: meta, headers: HTML } }).fetch })
  assert.equal(byId(r1, "noindex").severity, "error")

  const header = { ...HTML, "x-robots-tag": "noindex" }
  const r2 = await check("https://example.com", { fetch: goodSite({ "https://example.com/": { body: fixture("good/home.html"), headers: header } }).fetch })
  assert.equal(byId(r2, "noindex").severity, "error")

  const r3 = await check("https://example.com", { preview: true, fetch: goodSite({ "https://example.com/": { body: fixture("good/home.html"), headers: header } }).fetch })
  assert.equal(byId(r3, "noindex").points, 8)
  assert.ok(byId(r3, "noindex").details.some(d => /preview deployment/.test(d)))

  const r4 = await check("https://example.com", { preview: true, fetch: goodSite({ "https://example.com/": { body: meta, headers: HTML } }).fetch })
  assert.equal(byId(r4, "noindex").severity, "error", "a meta noindex ships to production, so it always counts")
})

test("preview hosts are detected automatically", async () => {
  const host = "https://acme-git-feature-acme.vercel.app"
  const site = mockSite({
    [`${host}/`]: { body: fixture("good/home.html"), headers: { ...HTML, "x-robots-tag": "noindex" } }
  })
  const r = await check(host, { fetch: site.fetch, pages: 0 })
  assert.equal(r.preview, true)
  assert.equal(byId(r, "noindex").points, 8)
})

test("crawler-specific noindex and nosnippet are scored", async () => {
  const body = fixture("good/home.html").replace("<head>", '<head><meta name="GPTBot" content="noindex"><meta name="robots" content="max-snippet:0">')
  const r = await check("https://example.com", { pages: 0, fetch: goodSite({ "https://example.com/": { body, headers: HTML } }).fetch })
  assert.equal(byId(r, "noindex").points, 4)
  assert.equal(byId(r, "noindex").status, "warn")
  assert.equal(byId(r, "snippets").points, 0)
})

test("X-Robots-Tag values are split by crawler", () => {
  assert.deepEqual(parseXRobotsTag("noindex, googlebot: nosnippet, max-snippet: 20"), [
    { scope: "all", directive: "noindex" },
    { scope: "googlebot", directive: "nosnippet" },
    { scope: "googlebot", directive: "max-snippet:20" }
  ])
})

test("canonical problems are found", async () => {
  const pricing = fixture("good/pricing.html").replace("https://example.com/pricing", "https://example.com/")
  const post = fixture("good/blog-post.html").replace("https://example.com/blog/late-payments", "https://other.example.org/post")
  const r = await check("https://example.com", {
    fetch: goodSite({
      "https://example.com/pricing": { body: pricing, headers: HTML },
      "https://example.com/blog/late-payments": { body: post, headers: HTML }
    }).fetch
  })
  const canonical = byId(r, "canonical")
  assert.equal(canonical.points, 1)
  assert.ok(canonical.details.some(d => /points to the homepage/.test(d)))
  assert.ok(canonical.details.some(d => /another site/.test(d)))
})

test("a canonical pointing to the baseline host is fine when that host is part of the site", async () => {
  const host = "https://preview.example.net"
  const site = mockSite({ [`${host}/`]: { body: fixture("good/home.html"), headers: HTML } })
  const r = await check(host, { fetch: site.fetch, pages: 0, siteHosts: ["example.com"] })
  assert.equal(byId(r, "canonical").points, 3)
})

test("invalid JSON-LD and missing types cost points", async () => {
  const home = fixture("good/home.html").replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '<script type="application/ld+json">{"@type": "WebSite",}</script>')
  const r = await check("https://example.com", { pages: 0, fetch: goodSite({ "https://example.com/": { body: home, headers: HTML } }).fetch })
  const ld = byId(r, "json-ld")
  assert.equal(ld.points, 0)
  assert.match(ld.summary, /invalid JSON/)
})

test("llms.txt and sitemap problems are reported with honest weights", async () => {
  const site = goodSite({
    "https://example.com/llms.txt": { body: "<!doctype html><html><body>app</body></html>", headers: HTML },
    "https://example.com/sitemap.xml": { body: "<!doctype html><html></html>", headers: HTML }
  })
  const r = await check("https://example.com", { fetch: site.fetch })
  const llms = byId(r, "llms-txt")
  assert.equal(llms.maxPoints, 2)
  assert.equal(llms.points, 0)
  assert.ok(llms.details.some(d => /No major AI search engine has said it reads llms.txt/.test(d)))
  assert.equal(byId(r, "sitemap").points, 0)
})

test("pages robots.txt closes to this tool are skipped", async () => {
  const site = goodSite({
    "https://example.com/robots.txt": { body: "User-agent: can-ai-read\nDisallow: /pricing\nDisallow: /llms.txt\n\nUser-agent: *\nAllow: /\n", headers: TEXT }
  })
  const r = await check("https://example.com", { fetch: site.fetch })
  assert.ok(!site.calls.some(c => c.url.endsWith("/pricing")))
  assert.ok(!site.calls.some(c => c.url.endsWith("/llms.txt")))
  assert.equal(byId(r, "llms-txt").status, "skip")
  assert.ok(r.skipped.some(s => s.path === "/pricing"))
})

test("extra headers go only to the site being checked", async () => {
  const site = goodSite({
    "https://example.com/robots.txt": { body: "User-agent: *\nAllow: /\nSitemap: https://cdn.example.net/sitemap.xml\n", headers: TEXT },
    "https://cdn.example.net/sitemap.xml": { body: fixture("sitemap.xml"), headers: { "content-type": "application/xml" } }
  })
  await check("https://example.com", { fetch: site.fetch, headers: { "x-vercel-protection-bypass": "secret" } })
  const toSite = site.calls.filter(c => c.url.startsWith("https://example.com/"))
  const toCdn = site.calls.filter(c => c.url.startsWith("https://cdn.example.net/"))
  assert.ok(toSite.length > 0 && toSite.every(c => c.headers["x-vercel-protection-bypass"] === "secret"))
  assert.equal(toCdn.length, 1)
  assert.equal(toCdn[0].headers["x-vercel-protection-bypass"], undefined)
})

test("redirects are followed and reported", async () => {
  const site = goodSite({ "http://example.com/": { status: 301, headers: { location: "https://example.com/" } } })
  const r = await check("http://example.com", { fetch: site.fetch, pages: 0 })
  assert.equal(r.finalUrl, "https://example.com/")
  assert.ok(byId(r, "pages-load").details.some(d => d.includes("http://example.com/ -> https://example.com/")))
})

test("an error page and a 403 from bot protection are explained", async () => {
  const site = goodSite({ "https://example.com/": { status: 403, body: "Forbidden", headers: HTML } })
  const r = await check("https://example.com", { fetch: site.fetch })
  const load = byId(r, "pages-load")
  assert.equal(load.severity, "error")
  assert.ok(load.details.some(d => /bot protection/.test(d)))
})

test("a site that does not answer throws UnreachableError", async () => {
  const site = mockSite({ "https://example.com/": new TypeError("fetch failed") })
  await assert.rejects(check("https://example.com", { fetch: site.fetch }), UnreachableError)
})

test("the request budget is never exceeded", async () => {
  const site = goodSite()
  const r = await check("https://example.com", { fetch: site.fetch, pages: 2, maxRequests: 3 })
  assert.equal(site.calls.length, 3)
  assert.equal(r.requests.used, 3)
})

test("pickPages prefers a product page and a real post, and skips assets and login", () => {
  const paths = pickPages(
    ["/", "#top", "mailto:a@b.c", "/login", "/logo.png", "/blog", "/blog/post-one", "/pricing", "https://other.com/x", "/careers"],
    [],
    "https://example.com/",
    ["example.com", "www.example.com"],
    3
  )
  assert.deepEqual(paths, ["/pricing", "/blog/post-one", "/blog"])
})

test("compare fetches the same paths on both sides and finds regressions", async () => {
  const prod = goodSite()
  const preview = "https://acme-git-pr-1.vercel.app"
  const previewSite = mockSite({
    [`${preview}/`]: { body: fixture("good/home.html"), headers: { ...HTML, "x-robots-tag": "noindex" } },
    [`${preview}/robots.txt`]: { body: fixture("robots/ai-blocked.txt"), headers: TEXT },
    [`${preview}/pricing`]: { body: fixture("good/pricing.html"), headers: HTML }
  })
  /** @type {typeof globalThis.fetch} */
  const fetch = (url, init) => (String(url).startsWith(preview) ? previewSite.fetch(url, init) : prod.fetch(url, init))
  const cmp = await compare(preview, "https://example.com", { fetch })
  assert.equal(cmp.target.pages.length, 2)
  assert.deepEqual(cmp.baseline.pages.map(p => p.path), cmp.target.pages.map(p => p.path))
  const ids = cmp.regressions.map(r => r.id)
  assert.ok(ids.includes("search-crawlers"))
  assert.ok(ids.includes("training-crawlers"))
  assert.ok(!ids.includes("noindex"), "the preview's noindex header is expected")
  assert.ok(!ids.includes("canonical"), "a canonical to production is fine on a preview")
  assert.ok(cmp.crawlerChanges.some(c => c.token === "OAI-SearchBot" && c.before === "allowed" && c.after === "blocked"))
  assert.ok(cmp.scoreDelta < 0)
})

test("compare reports no regressions for identical sites", async () => {
  const cmp = await compare("https://example.com", "https://example.com", { fetch: goodSite().fetch })
  assert.equal(cmp.regressions.length, 0)
  assert.equal(cmp.scoreDelta, 0)
})

test("URLs without a scheme get https, local ones get http", () => {
  assert.equal(normalizeUrl("example.com"), "https://example.com/")
  assert.equal(normalizeUrl("localhost:3000/about#top"), "http://localhost:3000/about")
  assert.equal(normalizeUrl("127.0.0.1:8080"), "http://127.0.0.1:8080/")
  assert.throws(() => normalizeUrl("ftp://example.com"), /Only http and https/)
  assert.throws(() => normalizeUrl(""), /required/)
})
