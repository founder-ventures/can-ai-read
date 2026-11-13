import { test } from "node:test"
import assert from "node:assert/strict"
import { HTML, TEXT, fixture, goodSite, mockSite } from "./site.js"
import { main, parseArgs, parseHeader } from "../src/cli.js"

function capture() {
  let out = ""
  let err = ""
  return {
    stdout: { write: (/** @type {string} */ s) => (out += s), isTTY: false },
    stderr: { write: (/** @type {string} */ s) => (err += s) },
    get out() {
      return out
    },
    get err() {
      return err
    }
  }
}

test("parses options", () => {
  const a = parseArgs(["example.com", "--pages", "3", "--fail-under=70", "--header", "X-Token: abc", "--json", "--paths", "/a, /b", "--preview"])
  assert.equal(a.url, "example.com")
  assert.equal(a.pages, 3)
  assert.equal(a.failUnder, 70)
  assert.deepEqual(a.headers, { "x-token": "abc" })
  assert.deepEqual(a.paths, ["/a", "/b"])
  assert.equal(a.json, true)
  assert.equal(a.preview, true)
})

test("rejects bad options", () => {
  assert.throws(() => parseArgs(["--pages", "9", "x.com"]), /0 to 8/)
  assert.throws(() => parseArgs(["--fail-under", "abc", "x.com"]), /whole number/)
  assert.throws(() => parseArgs(["--nope", "x.com"]), /Unknown option/)
  assert.throws(() => parseArgs(["a.com", "b.com"]), /Only one URL/)
  assert.throws(() => parseArgs(["a.com", "--json", "--markdown"]), /not both/)
  assert.throws(() => parseArgs(["a.com", "--baseline"]), /needs a value/)
  assert.throws(() => parseHeader("no colon"), /Name: value/)
})

test("exit 0 and a readable report for a good site", async () => {
  const io = capture()
  const code = await main(["https://example.com", "--no-color"], { ...io, fetch: goodSite().fetch, env: {} })
  assert.equal(code, 0)
  assert.match(io.out, /Score 100\/100/)
  assert.match(io.out, /https:\/\/tryrankwise\.com\/report\/example\.com\?ref=can-ai-read-cli/)
  assert.ok(!io.out.includes("\x1b["), "no colors when asked")
})

test("exit 1 when there are errors", async () => {
  const io = capture()
  const site = goodSite({ "https://example.com/robots.txt": { body: fixture("robots/ai-blocked.txt"), headers: TEXT } })
  const code = await main(["https://example.com"], { ...io, fetch: site.fetch, env: {} })
  assert.equal(code, 1)
  assert.match(io.out, /Fix first/)
})

test("exit 1 below --fail-under, even without errors", async () => {
  const io = capture()
  const site = goodSite({ "https://example.com/llms.txt": { status: 404 } })
  const code = await main(["https://example.com", "--fail-under", "99"], { ...io, fetch: site.fetch, env: {} })
  assert.equal(code, 1)
})

test("exit 2 when the site does not respond or the input is bad", async () => {
  const io = capture()
  const site = mockSite({ "https://down.example/": new TypeError("fetch failed") })
  assert.equal(await main(["down.example"], { ...io, fetch: site.fetch, env: {} }), 2)
  assert.match(io.err, /Could not reach/)
  const io2 = capture()
  assert.equal(await main(["ftp://example.com"], { ...io2, env: {} }), 2)
  assert.match(io2.err, /Only http and https/)
  const io3 = capture()
  assert.equal(await main([], { ...io3, env: {} }), 2)
})

test("--json prints the full report", async () => {
  const io = capture()
  await main(["https://example.com", "--json"], { ...io, fetch: goodSite().fetch, env: {} })
  const report = JSON.parse(io.out)
  assert.equal(report.score, 100)
  assert.equal(report.tool.name, "can-ai-read")
  assert.equal(report.checks.length, 15)
  assert.ok(!io.out.includes("tryrankwise"), "no promotion inside JSON")
})

test("--markdown prints Markdown", async () => {
  const io = capture()
  await main(["https://example.com", "--markdown"], { ...io, fetch: goodSite().fetch, env: {} })
  assert.match(io.out, /^## can-ai-read: 100\/100/)
  assert.match(io.out, /\| AI crawler access \| 35\/35 \|/)
})

test("--baseline exits 1 only on regressions", async () => {
  const io = capture()
  const prod = goodSite()
  const worse = goodSite({ "https://example.com/robots.txt": { body: "User-agent: *\nDisallow: /\n", headers: TEXT } })
  /** @type {typeof globalThis.fetch} */
  const fetch = (url, init) => (String(url).startsWith("https://www.example.com") ? worse.fetch(String(url).replace("www.", ""), init) : prod.fetch(url, init))
  const code = await main(["https://www.example.com", "--baseline", "https://example.com", "--no-color"], { ...io, fetch, env: {} })
  assert.equal(code, 1)
  assert.match(io.out, /regressions?/)

  const io2 = capture()
  const same = await main(["https://example.com", "--baseline", "https://example.com"], { ...io2, fetch: goodSite().fetch, env: {} })
  assert.equal(same, 0)
  assert.match(io2.out, /No regressions/)
})

test("colors follow NO_COLOR, FORCE_COLOR and the terminal", async () => {
  const io = capture()
  await main(["https://example.com", "--pages", "0"], { ...io, fetch: goodSite().fetch, env: { FORCE_COLOR: "1" } })
  assert.ok(io.out.includes("\x1b["))
  const io2 = capture()
  await main(["https://example.com", "--pages", "0"], { ...io2, fetch: goodSite().fetch, env: { NO_COLOR: "", FORCE_COLOR: "1" } })
  assert.ok(!io2.out.includes("\x1b["))
})

test("--help and --version", async () => {
  const io = capture()
  assert.equal(await main(["--help"], { ...io, env: {} }), 0)
  assert.match(io.out, /Exit codes/)
  const io2 = capture()
  assert.equal(await main(["--version"], { ...io2, env: {} }), 0)
  assert.match(io2.out, /^\d+\.\d+\.\d+\n$/)
})

test("an SPA prints the JavaScript problem first", async () => {
  const io = capture()
  const spa = { body: fixture("spa.html"), headers: HTML }
  const site = goodSite({ "https://example.com/": spa, "https://example.com/pricing": spa, "https://example.com/blog/late-payments": spa })
  const code = await main(["https://example.com", "--no-color"], { ...io, fetch: site.fetch, env: {} })
  assert.equal(code, 1)
  const fixes = io.out.slice(io.out.indexOf("Fix first"))
  assert.match(fixes, /1\. Text in the server HTML \(\+20\)/)
})
