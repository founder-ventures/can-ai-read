import { test } from "node:test"
import assert from "node:assert/strict"
import { TEXT, fixture, goodSite } from "./site.js"
import { check } from "../src/index.js"
import { COMMENT_MARKER, fixesFirst, formatMarkdown, formatText, rankwiseLink } from "../src/report.js"

test("the Rankwise link names the site and carries the ref tag", () => {
  assert.equal(rankwiseLink("https://www.acme.com/pricing", "can-ai-read-cli"), "https://tryrankwise.com/report/acme.com?ref=can-ai-read-cli")
  for (const local of ["http://localhost:3000/", "http://127.0.0.1:8080", "https://acme-git-x.vercel.app/", "https://pr-3--acme.netlify.app", "http://acme.test/"]) {
    assert.equal(rankwiseLink(local, "x"), "https://tryrankwise.com/?ref=x", local)
  }
})

test("text output has every category and no color codes when color is off", async () => {
  const r = await check("https://example.com", { fetch: goodSite().fetch })
  const text = formatText(r, { color: false })
  for (const title of ["AI crawler access", "Indexing", "Readable without JavaScript", "Structured data", "Answer-ready content", "Discovery files"]) {
    assert.ok(text.includes(title), title)
  }
  assert.ok(!text.includes("\x1b["))
  assert.ok(!text.includes("\u2014"), "no em dashes")
  assert.match(text, /This report covers readiness/)
})

test("fixes are ordered by errors first, then by points lost", async () => {
  const site = goodSite({ "https://example.com/robots.txt": { body: fixture("robots/ai-blocked.txt"), headers: TEXT } })
  const r = await check("https://example.com", { fetch: site.fetch })
  const order = fixesFirst(r.checks).map(c => c.id)
  assert.equal(order[0], "search-crawlers")
  assert.equal(order[1], "training-crawlers")
})

test("markdown has the comment marker, a table and the fix snippet in a code block", async () => {
  const site = goodSite({ "https://example.com/robots.txt": { body: "User-agent: *\nDisallow: /\n", headers: TEXT } })
  const r = await check("https://example.com", { fetch: site.fetch })
  const md = formatMarkdown(r, { ref: "can-ai-read-pr" })
  assert.ok(md.startsWith(COMMENT_MARKER))
  assert.match(md, /\| Area \| Points \|/)
  assert.match(md, / {2}```\n {2}User-agent: Googlebot\n {2}User-agent: OAI-SearchBot/)
  assert.match(md, /ref=can-ai-read-pr/)
  assert.ok(!md.includes("\u2014"), "no em dashes")
  assert.ok(!formatMarkdown(r, { marker: false }).includes(COMMENT_MARKER))
})

test("table cells escape pipes", async () => {
  const r = await check("https://example.com", { fetch: goodSite().fetch, pages: 0 })
  const md = formatMarkdown(r)
  const row = md.split("\n").find(l => l.includes("Title and description"))
  assert.ok(row)
  assert.equal(row.split(/(?<!\\)\|/).length, 6)
})

test("the type declarations and the runtime exports match", async () => {
  const { readFileSync } = await import("node:fs")
  const api = await import("../src/index.js")
  const dts = readFileSync(new URL("../types/index.d.ts", import.meta.url), "utf8")
  const declared = [...dts.matchAll(/^export (?:function|const|class) (\w+)/gm)].map(m => m[1]).sort()
  assert.deepEqual(Object.keys(api).sort(), [...new Set(declared)].sort())
})

test("markdown shows HTML tags in fixes as code so GitHub does not strip them", async () => {
  const home = fixture("good/home.html").replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, "")
  const r = await check("https://example.com", { pages: 0, fetch: goodSite({ "https://example.com/": { body: home, headers: { "content-type": "text/html" } } }).fetch })
  const md = formatMarkdown(r)
  assert.ok(md.includes('`<script type="application/ld+json">`'))
  assert.ok(!/[^`]<script/.test(md))
})
