import { test } from "node:test"
import assert from "node:assert/strict"
import { fixture } from "./site.js"
import { analyzeHtml, countWords, decodeEntities, jsonLdTypes, sentences, tokenize } from "../src/html.js"

test("reads title, description, canonical, site name and JSON-LD from a real page", () => {
  const f = analyzeHtml(fixture("good/home.html"))
  assert.equal(f.lang, "en")
  assert.equal(f.title, "Acme Invoicing | Invoices for freelancers")
  assert.match(f.metaDescription ?? "", /^Acme sends invoices/)
  assert.equal(f.ogSiteName, "Acme")
  assert.deepEqual(f.canonicals, ["https://example.com/"])
  assert.equal(f.jsonLd.length, 1)
  assert.equal(f.jsonLd[0].error, null)
  assert.deepEqual(jsonLdTypes(f.jsonLd[0].data), ["Organization", "WebSite"])
  assert.equal(f.h1Count, 1)
  assert.equal(f.h2Count, 4)
  assert.ok(f.links.includes("/pricing"))
  assert.equal(f.scriptCount, 2)
})

test("counts visible words and leaves out scripts, styles and head", () => {
  const f = analyzeHtml(fixture("good/home.html"))
  assert.ok(f.visibleWords > 150, `got ${f.visibleWords}`)
  assert.ok(!f.visibleText.includes("color: red"))
  assert.ok(!f.visibleText.includes("schema.org"))
  assert.ok(f.mainWords < f.visibleWords)
  assert.ok(!f.mainText.includes("All rights reserved"))
})

test("finds the opening sentence after the H1", () => {
  const f = analyzeHtml(fixture("good/home.html"))
  assert.equal(f.openingText, "Acme is an invoicing tool that sends invoices and chases late payments for freelancers.")
})

test("finds hero text inside a header element", () => {
  const f = analyzeHtml("<body><nav><a href=/>Home page link text here</a></nav><header><h1>Acme</h1><div>Acme turns receipts into tax-ready reports.</div></header></body>")
  assert.equal(f.openingText, "Acme turns receipts into tax-ready reports.")
})

test("spots an empty single-page-app shell", () => {
  const f = analyzeHtml(fixture("spa.html"))
  assert.equal(f.emptyMountId, "root")
  assert.equal(f.noscriptAsksForJs, true)
  assert.ok(f.visibleWords < 5)
})

test("a mount point with server-rendered content is not flagged", () => {
  const f = analyzeHtml('<div id="__next"><main><h1>Hello</h1><p>Rendered on the server.</p></main></div>')
  assert.equal(f.emptyMountId, null)
})

test("keeps invalid JSON-LD with its parse error", () => {
  const f = analyzeHtml('<script type="application/ld+json">{"@type": "Organization",}</script><script type="application/ld+json"><!-- {"@type":"WebSite"} --></script>')
  assert.equal(f.jsonLd.length, 2)
  assert.ok(f.jsonLd[0].error)
  assert.equal(f.jsonLd[1].error, null)
})

test("collects nested and array JSON-LD types", () => {
  const data = [{ "@type": ["Organization", "Brand"], founder: { "@type": "Person" } }, { "@graph": [{ "@type": "https://schema.org/WebSite" }] }]
  assert.deepEqual(jsonLdTypes(data), ["Organization", "Brand", "Person", "WebSite"])
})

test("meta robots tags for all crawlers and named crawlers are captured", () => {
  const f = analyzeHtml('<meta name="robots" content="NoIndex, follow"><meta name="GPTBot" content="noindex"><meta name="viewport" content="width=device-width">')
  assert.deepEqual(f.metaRobots, [
    { name: "robots", content: "noindex, follow" },
    { name: "gptbot", content: "noindex" }
  ])
})

test("handles > inside quoted attributes, comments and entities", () => {
  const events = tokenize('<a title="a > b" href="/x">Go &amp; see</a><!-- <p>hidden</p> -->')
  assert.equal(events[0].type, "open")
  assert.equal(/** @type {any} */ (events[0]).attrs.title, "a > b")
  const f = analyzeHtml('<p data-nosnippet>Fish &amp; chips &#8211; &#x2192; &nbsp;done</p><!-- <p>not this</p> -->')
  assert.equal(f.visibleText, "Fish & chips \u2013 \u2192 done")
  assert.equal(f.dataNosnippetCount, 1)
  assert.equal(decodeEntities("&unknown; &lt;b&gt;"), "&unknown; <b>")
})

test("text blocks keep headings and paragraphs apart", () => {
  const f = analyzeHtml("<h2>What each one is</h2><p>SOC 2 is an attestation framework.</p>")
  assert.deepEqual(f.textBlocks, ["What each one is", "SOC 2 is an attestation framework."])
})

test("counts words in Latin and CJK text", () => {
  assert.equal(countWords("Acme sends invoices, fast."), 4)
  assert.equal(countWords("请求的网页"), 3)
  assert.equal(countWords(""), 0)
})

test("splits sentences", () => {
  assert.deepEqual(sentences("Acme is great. It sends invoices! Does it? Yes."), ["Acme is great.", "It sends invoices!", "Does it?", "Yes."])
})
