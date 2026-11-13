import { test } from "node:test"
import assert from "node:assert/strict"
import { fixture } from "./site.js"
import { validateLlmsTxt } from "../src/llms-txt.js"
import { parseSitemap } from "../src/sitemap.js"

test("a well-formed llms.txt passes", () => {
  const r = validateLlmsTxt(fixture("llms-good.txt"))
  assert.equal(r.valid, true)
  assert.equal(r.title, "Acme")
  assert.match(r.summary ?? "", /^Acme is an invoicing tool/)
  assert.deepEqual(r.sections, [
    { title: "Product", links: 2 },
    { title: "Optional", links: 1 }
  ])
  assert.equal(r.linkCount, 3)
  assert.equal(r.issues.filter(i => i.severity !== "info").length, 0)
})

test("llms.txt without an H1 and with bare list items fails", () => {
  const r = validateLlmsTxt(fixture("llms-bad.txt"))
  assert.equal(r.valid, false)
  assert.ok(r.issues.some(i => i.severity === "error" && /H1/.test(i.text)))
  assert.equal(r.issues.filter(i => /markdown link/.test(i.text)).length, 2)
})

test("an HTML page served as llms.txt fails", () => {
  const r = validateLlmsTxt("<!DOCTYPE html><html><body><div id=root></div></body></html>")
  assert.equal(r.valid, false)
  assert.match(r.issues[0].text, /HTML page/)
})

test("an empty llms.txt fails, and a second H1 is a warning", () => {
  assert.equal(validateLlmsTxt("  \n").valid, false)
  const r = validateLlmsTxt("# Acme\n\n# Again\n\n## Docs\n- [A](https://a.example)\n")
  assert.equal(r.valid, true)
  assert.ok(r.issues.some(i => i.severity === "warning" && /one H1/.test(i.text)))
})

test("a urlset sitemap lists its URLs", () => {
  const r = parseSitemap(fixture("sitemap.xml"))
  assert.equal(r.kind, "urlset")
  assert.equal(r.error, null)
  assert.equal(r.urls.length, 4)
  assert.equal(r.urls[3], "https://example.com/blog/a-b&c")
})

test("a sitemap index lists its child sitemaps", () => {
  const r = parseSitemap(fixture("sitemap-index.xml"))
  assert.equal(r.kind, "sitemapindex")
  assert.deepEqual(r.urls, ["https://example.com/sitemap-pages.xml", "https://example.com/sitemap-posts.xml"])
})

test("HTML or other XML is not a sitemap", () => {
  assert.equal(parseSitemap("<!doctype html><html></html>").looksLikeHtml, true)
  assert.equal(parseSitemap("<?xml version='1.0'?><rss></rss>").kind, null)
  assert.match(parseSitemap('<urlset xmlns="x"></urlset>').error ?? "", /no URLs/)
})
