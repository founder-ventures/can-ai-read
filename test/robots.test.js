import { test } from "node:test"
import assert from "node:assert/strict"
import { fixture } from "./site.js"
import { droppedWildcardRules, groupsFor, isAllowed, parseRobots, patternMatches, productToken } from "../src/robots.js"

test("a named group overrides the * group (RFC 9309 2.2.1)", () => {
  const parsed = parseRobots(fixture("robots/ai-blocked.txt"))
  assert.equal(isAllowed(parsed, "GPTBot", "/").allowed, false)
  assert.equal(isAllowed(parsed, "ClaudeBot", "/pricing").allowed, false)
  assert.equal(isAllowed(parsed, "OAI-SearchBot", "/").allowed, false)
  assert.equal(isAllowed(parsed, "Googlebot", "/").allowed, true)
  assert.equal(isAllowed(parsed, "Googlebot", "/admin/users").allowed, false)
  const d = isAllowed(parsed, "PerplexityBot", "/x")
  assert.equal(d.source, "named")
  assert.equal(d.rule?.line, 9)
})

test("token matching is case-insensitive and ignores versions", () => {
  assert.equal(productToken("Googlebot/2.1"), "googlebot")
  assert.equal(productToken(" * "), "*")
  const parsed = parseRobots("User-agent: gptbot/1.0\nDisallow: /\n")
  assert.equal(isAllowed(parsed, "GPTBot", "/").allowed, false)
})

test("consecutive User-agent lines share one group, and a User-agent after a rule starts a new one", () => {
  const parsed = parseRobots("User-agent: a\nUser-agent: b\nDisallow: /x\nUser-agent: c\nDisallow: /y\n")
  assert.equal(parsed.groups.length, 2)
  assert.deepEqual(parsed.groups[0].userAgents, ["a", "b"])
  assert.equal(isAllowed(parsed, "b", "/x").allowed, false)
  assert.equal(isAllowed(parsed, "c", "/x").allowed, true)
})

test("groups naming the same crawler are merged", () => {
  const parsed = parseRobots("User-agent: GPTBot\nDisallow: /a\n\nUser-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /b\n")
  assert.equal(isAllowed(parsed, "GPTBot", "/a").allowed, false)
  assert.equal(isAllowed(parsed, "GPTBot", "/b").allowed, false)
  assert.equal(isAllowed(parsed, "GPTBot", "/c").allowed, true)
})

test("the longest match wins, and Allow wins a tie", () => {
  const parsed = parseRobots("User-agent: *\nDisallow: /docs\nAllow: /docs/public\nDisallow: /same\nAllow: /same\n")
  assert.equal(isAllowed(parsed, "x", "/docs/private").allowed, false)
  assert.equal(isAllowed(parsed, "x", "/docs/public/page").allowed, true)
  assert.equal(isAllowed(parsed, "x", "/same").allowed, true)
})

test("* and $ work as RFC 9309 describes", () => {
  assert.equal(patternMatches("/*.pdf$", "/files/report.pdf"), true)
  assert.equal(patternMatches("/*.pdf$", "/files/report.pdf?x=1"), false)
  assert.equal(patternMatches("/private*/", "/private-area/x"), true)
  assert.equal(patternMatches("/a*b*c", "/axxbyyc"), true)
  assert.equal(patternMatches("/a*b*c", "/axxcyyb"), false)
  assert.equal(patternMatches("/exact$", "/exact"), true)
  assert.equal(patternMatches("/exact$", "/exactly"), false)
  assert.equal(patternMatches("*", "/anything"), true)
})

test("an empty Disallow allows everything, and /robots.txt is always allowed", () => {
  const open = parseRobots("User-agent: *\nDisallow:\n")
  assert.equal(isAllowed(open, "GPTBot", "/").allowed, true)
  const closed = parseRobots("User-agent: *\nDisallow: /\n")
  assert.equal(isAllowed(closed, "GPTBot", "/robots.txt").allowed, true)
  assert.equal(isAllowed(closed, "GPTBot", "/").allowed, false)
})

test("no matching group means everything is allowed", () => {
  const parsed = parseRobots("User-agent: Googlebot\nDisallow: /\n")
  const d = isAllowed(parsed, "GPTBot", "/")
  assert.equal(d.allowed, true)
  assert.equal(d.source, "none")
})

test("percent-encoding is normalised before matching", () => {
  const parsed = parseRobots("User-agent: *\nDisallow: /caf%c3%a9\n")
  assert.equal(isAllowed(parsed, "x", "/café").allowed, false)
  assert.equal(isAllowed(parsed, "x", "/caf%C3%A9/menu").allowed, false)
})

test("sitemaps, Content-Signal lines and issues are collected", () => {
  const parsed = parseRobots(
    "﻿Disallow: /early\nUser-agent: *\nDissallow: /typo\nContent-Signal: search=yes, ai-train=no\nnonsense line\nSitemap: https://example.com/sitemap.xml\nNoindex: /x\n"
  )
  assert.deepEqual(parsed.sitemaps, ["https://example.com/sitemap.xml"])
  assert.deepEqual(parsed.contentSignals, ["search=yes, ai-train=no"])
  const codes = parsed.issues.map(i => i.code)
  assert.ok(codes.includes("rule_before_user_agent"))
  assert.ok(codes.includes("typo_directive"))
  assert.ok(codes.includes("missing_colon"))
  assert.ok(codes.includes("noindex_directive"))
  // The typo is still applied, as Google does.
  assert.equal(isAllowed(parsed, "x", "/typo").allowed, false)
})

test("an HTML page served as robots.txt is flagged and has no rules", () => {
  const parsed = parseRobots("<!doctype html><html><head><title>App</title></head><body><div id=root></div></body></html>")
  assert.equal(parsed.looksLikeHtml, true)
  assert.equal(parsed.groups.length, 0)
  assert.equal(parsed.issues[0].code, "looks_like_html")
})

test("a named group that drops the * group's Disallow rules is detected", () => {
  const parsed = parseRobots(fixture("robots/trap.txt"))
  const trap = droppedWildcardRules(parsed, ["GPTBot", "ClaudeBot"])
  assert.equal(trap.length, 1)
  assert.equal(trap[0].token, "GPTBot")
  assert.deepEqual(trap[0].dropped.map(r => r.value), ["/admin/", "/private/"])
  // A group that repeats the rules is fine.
  const fixed = parseRobots("User-agent: *\nDisallow: /admin/\n\nUser-agent: GPTBot\nDisallow: /admin/\nAllow: /\n")
  assert.equal(droppedWildcardRules(fixed, ["GPTBot"]).length, 0)
})

test("groupsFor falls back to * and reports where the rules came from", () => {
  const parsed = parseRobots(fixture("robots/good.txt"))
  assert.equal(groupsFor(parsed, "GPTBot").source, "wildcard")
  assert.equal(groupsFor(parsed, "*").groups.length, 1)
})

test("a hostile pattern cannot cause slow matching", () => {
  const parsed = parseRobots(`User-agent: *\nDisallow: /${"a*".repeat(200)}b\n`)
  const started = Date.now()
  assert.equal(isAllowed(parsed, "x", `/${"a".repeat(20000)}`).allowed, true)
  assert.ok(Date.now() - started < 500)
})
