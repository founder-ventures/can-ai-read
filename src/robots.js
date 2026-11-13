// robots.txt parsing and matching per RFC 9309, the Robots Exclusion
// Protocol (https://www.rfc-editor.org/rfc/rfc9309.html).
//
// Where the RFC leaves a detail open, this follows Google's open-source
// parser, because most crawlers copy it:
//   - A group is one or more consecutive User-agent lines plus the rules
//     after them. A User-agent line after a rule starts a new group.
//     Sitemap and unknown lines do not end a group.
//   - A crawler obeys exactly one group: the one naming its product token
//     (case-insensitive). Several groups naming it are merged. With no named
//     group it falls back to the `*` group(s). With neither, all is allowed.
//   - The longest matching rule wins. On a tie, Allow wins.
//   - `*` matches any run of characters. `$` at the end anchors the pattern.
//   - /robots.txt itself is always allowed.
//
// The matcher uses indexOf over pattern segments, never a RegExp built from
// the file, so a hostile pattern cannot cause catastrophic backtracking.

/**
 * @typedef {{ type: "allow" | "disallow", value: string, line: number }} RobotsRule
 * @typedef {{ userAgents: string[], line: number, rules: RobotsRule[] }} RobotsGroup
 * @typedef {{ code: string, severity: "error" | "warning" | "info", line: number | null, text: string }} RobotsIssue
 * @typedef {{
 *   groups: RobotsGroup[],
 *   sitemaps: string[],
 *   contentSignals: string[],
 *   issues: RobotsIssue[],
 *   lineCount: number,
 *   looksLikeHtml: boolean
 * }} ParsedRobots
 * @typedef {{
 *   allowed: boolean,
 *   rule: RobotsRule | null,
 *   source: "named" | "wildcard" | "none"
 * }} RobotsDecision
 */

/** RFC 9309 asks parsers to handle at least 500 KiB. */
export const ROBOTS_MAX_BYTES = 500 * 1024

/** Misspellings Google's parser accepts. Other crawlers may not. */
const TYPOS = {
  useragent: "user-agent",
  "user agent": "user-agent",
  "user-agents": "user-agent",
  dissallow: "disallow",
  dissalow: "disallow",
  disalow: "disallow",
  diasllow: "disallow",
  disallaw: "disallow",
  "site-map": "sitemap"
}

const KNOWN = new Set([
  "user-agent",
  "allow",
  "disallow",
  "sitemap",
  "crawl-delay",
  "host",
  "clean-param",
  "request-rate",
  "visit-time",
  "content-signal",
  "content-usage",
  "noindex"
])

/**
 * The product token a User-agent value names, lowercased. Google keeps the
 * leading run of letters, `_` and `-`, so "Googlebot/2.1" names "googlebot".
 * @param {string} value
 */
export function productToken(value) {
  const trimmed = value.trim()
  if (trimmed === "*") return "*"
  const match = trimmed.match(/^[A-Za-z_-]+/)
  return match ? match[0].toLowerCase() : ""
}

/**
 * Parse a robots.txt body.
 * @param {string} text
 * @returns {ParsedRobots}
 */
export function parseRobots(text) {
  const body = (text || "").replace(/^﻿/, "")
  const lines = body.split(/\r\n|\r|\n/)
  /** @type {RobotsGroup[]} */
  const groups = []
  /** @type {string[]} */
  const sitemaps = []
  /** @type {string[]} */
  const contentSignals = []
  /** @type {RobotsIssue[]} */
  const issues = []
  /** @type {RobotsGroup | null} */
  let current = null
  let lastWasAgent = false

  const head = body.slice(0, 1000).trimStart().toLowerCase()
  const looksLikeHtml =
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    /<(?:head|body|script)\b/.test(head)
  if (looksLikeHtml) {
    issues.push({
      code: "looks_like_html",
      severity: "error",
      line: null,
      text: "The file is an HTML page. Crawlers find no rules in it."
    })
  }

  lines.forEach((raw, index) => {
    const lineNo = index + 1
    const line = raw.replace(/#.*$/, "").trim()
    if (!line) return
    const colon = line.indexOf(":")
    if (colon === -1) {
      if (!looksLikeHtml) {
        issues.push({
          code: "missing_colon",
          severity: "warning",
          line: lineNo,
          text: raw.trim()
        })
      }
      return
    }
    let key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (TYPOS[key]) {
      issues.push({
        code: "typo_directive",
        severity: "warning",
        line: lineNo,
        text: `"${line.slice(0, colon).trim()}" should be "${TYPOS[key]}". Google accepts it, other crawlers may not.`
      })
      key = TYPOS[key]
    }

    if (key === "user-agent") {
      if (!value) {
        issues.push({
          code: "empty_user_agent",
          severity: "warning",
          line: lineNo,
          text: raw.trim()
        })
        return
      }
      if (!current || !lastWasAgent) {
        current = { userAgents: [], line: lineNo, rules: [] }
        groups.push(current)
      }
      current.userAgents.push(value)
      lastWasAgent = true
      return
    }

    if (key === "allow" || key === "disallow") {
      lastWasAgent = false
      if (!current) {
        issues.push({
          code: "rule_before_user_agent",
          severity: "warning",
          line: lineNo,
          text: `${raw.trim()} comes before any User-agent line, so no crawler applies it.`
        })
        return
      }
      if (value && !value.startsWith("/") && !value.startsWith("*")) {
        issues.push({
          code: "pattern_without_slash",
          severity: "warning",
          line: lineNo,
          text: `"${value}" should start with "/".`
        })
      }
      current.rules.push({ type: key, value, line: lineNo })
      return
    }

    if (key === "sitemap") {
      if (value) sitemaps.push(value)
      return
    }
    if (key === "content-signal") {
      if (value) contentSignals.push(value)
      return
    }
    if (key === "noindex") {
      issues.push({
        code: "noindex_directive",
        severity: "info",
        line: lineNo,
        text: "Noindex in robots.txt is not supported by Google and has no effect."
      })
      return
    }
    if (!KNOWN.has(key) && !looksLikeHtml) {
      issues.push({
        code: "unknown_directive",
        severity: "info",
        line: lineNo,
        text: raw.trim()
      })
    }
  })

  return {
    groups,
    sitemaps,
    contentSignals,
    issues,
    lineCount: lines.length,
    looksLikeHtml
  }
}

/**
 * Percent-encode what RFC 9309 says must be encoded and upper-case existing
 * escapes, so "/caf%c3%a9" and "/café" compare equal.
 * @param {string} value
 */
function normalizeEncoding(value) {
  let out = ""
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === "%" && /^[0-9a-fA-F]{2}$/.test(value.slice(i + 1, i + 3))) {
      out += "%" + value.slice(i + 1, i + 3).toUpperCase()
      i += 2
      continue
    }
    const code = ch.charCodeAt(0)
    if (code > 0x7e || code < 0x21) {
      const cp = value.codePointAt(i) ?? code
      const chars = String.fromCodePoint(cp)
      for (const byte of new TextEncoder().encode(chars)) {
        out += "%" + byte.toString(16).toUpperCase().padStart(2, "0")
      }
      i += chars.length - 1
      continue
    }
    out += ch
  }
  return out
}

/**
 * Does a robots.txt pattern match a path (path plus query)?
 * @param {string} pattern
 * @param {string} path
 */
export function patternMatches(pattern, path) {
  let pat = normalizeEncoding(pattern)
  const target = normalizeEncoding(path)
  const anchored = pat.endsWith("$")
  if (anchored) pat = pat.slice(0, -1)
  const parts = pat.split("*")
  const first = parts[0]
  if (!target.startsWith(first)) return false
  let pos = first.length
  if (parts.length === 1) return anchored ? pos === target.length : true
  for (let i = 1; i < parts.length - 1; i++) {
    const idx = target.indexOf(parts[i], pos)
    if (idx === -1) return false
    pos = idx + parts[i].length
  }
  const last = parts[parts.length - 1]
  if (anchored) {
    return target.length - last.length >= pos && target.endsWith(last)
  }
  return target.indexOf(last, pos) !== -1
}

/**
 * The groups a crawler obeys.
 * @param {ParsedRobots} parsed
 * @param {string} token
 * @returns {{ groups: RobotsGroup[], source: "named" | "wildcard" | "none" }}
 */
export function groupsFor(parsed, token) {
  const wanted = token.toLowerCase()
  const named = parsed.groups.filter(g =>
    g.userAgents.some(ua => productToken(ua) === wanted)
  )
  if (named.length) return { groups: named, source: "named" }
  const wildcard = parsed.groups.filter(g =>
    g.userAgents.some(ua => productToken(ua) === "*")
  )
  if (wildcard.length) return { groups: wildcard, source: "wildcard" }
  return { groups: [], source: "none" }
}

/**
 * May `token` fetch `path` under these rules?
 * @param {ParsedRobots} parsed
 * @param {string} token crawler product token, for example "GPTBot"
 * @param {string} path path plus query, for example "/pricing?plan=pro"
 * @returns {RobotsDecision}
 */
export function isAllowed(parsed, token, path = "/") {
  const target = path || "/"
  const { groups, source } = groupsFor(parsed, token)
  if (target === "/robots.txt" || source === "none") {
    return { allowed: true, rule: null, source }
  }
  /** @type {RobotsRule | null} */
  let best = null
  let bestLength = -1
  for (const group of groups) {
    for (const rule of group.rules) {
      if (!rule.value) continue
      if (!patternMatches(rule.value, target)) continue
      const length = normalizeEncoding(rule.value).length
      if (
        length > bestLength ||
        (length === bestLength && rule.type === "allow" && best?.type !== "allow")
      ) {
        best = rule
        bestLength = length
      }
    }
  }
  return {
    allowed: !best || best.type === "allow",
    rule: best,
    source
  }
}

/**
 * The `User-agent: *` groups.
 * @param {ParsedRobots} parsed
 */
export function wildcardGroups(parsed) {
  return parsed.groups.filter(g => g.userAgents.some(ua => productToken(ua) === "*"))
}

/**
 * Named groups that silently drop the `*` group's Disallow rules. Under RFC
 * 9309 a crawler with a named group ignores `*` entirely, so a group like
 * "User-agent: GPTBot / Allow: /" opens every path the `*` group closes.
 * @param {ParsedRobots} parsed
 * @param {readonly string[]} tokens crawler tokens to inspect
 * @returns {{ token: string, dropped: RobotsRule[] }[]}
 */
export function droppedWildcardRules(parsed, tokens) {
  const wildDisallows = wildcardGroups(parsed)
    .flatMap(g => g.rules)
    .filter(r => r.type === "disallow" && r.value && r.value !== "/")
  if (!wildDisallows.length) return []
  const out = []
  for (const token of tokens) {
    const named = groupsFor(parsed, token)
    if (named.source !== "named") continue
    const dropped = wildDisallows.filter(rule => {
      const sample = rule.value.replace(/\*.*$/, "").replace(/\$$/, "") || "/"
      return isAllowed(parsed, token, sample).allowed
    })
    if (dropped.length) out.push({ token, dropped })
  }
  return out
}
