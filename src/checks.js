// Turn scan data into scored checks. Every check says how many points it is
// worth, how many it got, why, and how to fix what it found. The weights add
// up to 100 and are documented in the README; change both together.

import { SEARCH_CRAWLERS, TRAINING_CRAWLERS, OTHER_CRAWLERS, AI_CRAWLERS } from "./crawlers.js"
import { REPO_URL, VERSION } from "./fetch.js"
import { countWords, jsonLdNodes, jsonLdTypes, sentences } from "./html.js"
import { droppedWildcardRules, isAllowed, wildcardGroups } from "./robots.js"

/**
 * @typedef {import("./scan.js").ScanData} ScanData
 * @typedef {import("./scan.js").PageData} PageData
 * @typedef {"pass" | "warn" | "fail" | "info" | "skip"} CheckStatus
 * @typedef {{
 *   id: string,
 *   category: string,
 *   title: string,
 *   status: CheckStatus,
 *   severity: "error" | "warning" | null,
 *   points: number,
 *   maxPoints: number,
 *   summary: string,
 *   details: string[],
 *   fix: string | null,
 *   learnMore: string
 * }} Check
 * @typedef {import("./crawlers.js").Crawler & {
 *   state: "allowed" | "partial" | "blocked",
 *   earned: number,
 *   blockedPaths: string[],
 *   rule: { line: number, text: string, group: string } | null
 * }} CrawlerResult
 */

export const CATEGORIES = Object.freeze([
  { id: "crawlers", title: "AI crawler access", maxPoints: 35 },
  { id: "indexing", title: "Indexing", maxPoints: 20 },
  { id: "rendering", title: "Readable without JavaScript", maxPoints: 20 },
  { id: "structured-data", title: "Structured data", maxPoints: 10 },
  { id: "answers", title: "Answer-ready content", maxPoints: 10 },
  { id: "discovery", title: "Discovery files", maxPoints: 5 }
])

const DOCS = `${REPO_URL}#`

/** @param {Partial<Check> & Pick<Check, "id" | "category" | "title" | "maxPoints">} base @returns {Check} */
function make(base) {
  return {
    status: "pass",
    severity: null,
    points: base.maxPoints,
    summary: "",
    details: [],
    fix: null,
    learnMore: `${DOCS}${base.id}`,
    ...base
  }
}

/** @param {number} n @param {string} one @param {string} [many] */
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** @param {string[]} items */
function list(items) {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

/** @param {string} text @param {number} max */
function clip(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`
}

/** @param {PageData} page */
const ok = page => page.status >= 200 && page.status < 300

/** @param {number} max @param {number[]} scores values between 0 and 1 */
function share(max, scores) {
  if (!scores.length) return 0
  return Math.round((max * scores.reduce((a, b) => a + b, 0)) / scores.length)
}

// ---------------------------------------------------------------- crawlers

/**
 * @param {ScanData} data
 * @returns {CrawlerResult[]}
 */
export function evaluateCrawlers(data) {
  const paths = [...new Set(data.pages.filter(ok).map(p => p.path))]
  if (!paths.length) paths.push(data.pages[0]?.path || "/")
  return AI_CRAWLERS.map(crawler => {
    if (data.robots.state === "unreachable") {
      return { ...crawler, state: "blocked", earned: 0, blockedPaths: paths, rule: null }
    }
    const parsed = data.robots.parsed
    if (!parsed) return { ...crawler, state: "allowed", earned: crawler.points, blockedPaths: [], rule: null }
    const decisions = paths.map(path => ({ path, decision: isAllowed(parsed, crawler.token, path) }))
    const blocked = decisions.filter(d => !d.decision.allowed)
    const homeBlocked = !decisions[0].decision.allowed
    /** @type {CrawlerResult["state"]} */
    const state = !blocked.length ? "allowed" : homeBlocked || blocked.length === decisions.length ? "blocked" : "partial"
    const first = blocked[0]?.decision
    const rule = first?.rule
      ? {
          line: first.rule.line,
          text: `${first.rule.type === "allow" ? "Allow" : "Disallow"}: ${first.rule.value}`,
          group: first.source === "named" ? crawler.token : "*"
        }
      : null
    const earned = state === "allowed" ? crawler.points : state === "partial" ? Math.floor(crawler.points / 2) : 0
    return { ...crawler, state, earned, blockedPaths: blocked.map(b => b.path), rule }
  })
}

/** @param {CrawlerResult} c @param {ScanData} data */
function whyBlocked(c, data) {
  if (data.robots.state === "unreachable") return "robots.txt could not be loaded"
  if (!c.rule) return "robots.txt"
  return `robots.txt line ${c.rule.line} "${c.rule.text}" in the ${c.rule.group === "*" ? "User-agent: * group" : `group for User-agent: ${c.rule.group}`}`
}

/**
 * A robots.txt group that lets these crawlers in. It repeats the `*` group's
 * own rules, because a crawler with a named group ignores `*` entirely, and
 * an "Allow: /" alone would open paths you meant to keep closed.
 * @param {ScanData} data
 * @param {string[]} tokens
 */
export function allowSnippet(data, tokens) {
  const parsed = data.robots.parsed
  const rules = (parsed ? wildcardGroups(parsed) : [])
    .flatMap(g => g.rules)
    .filter(r => r.value && !(r.type === "disallow" && /^\/\*?\$?$/.test(r.value)))
  const lines = tokens.map(t => `User-agent: ${t}`)
  if (!rules.some(r => r.type === "disallow")) lines.push("Allow: /")
  else lines.push(...rules.map(r => `${r.type === "allow" ? "Allow" : "Disallow"}: ${r.value}`))
  return lines.join("\n")
}

/**
 * @param {CrawlerResult[]} blocked
 * @param {ScanData} data
 */
function crawlerFix(blocked, data) {
  if (data.robots.state === "unreachable") {
    return `Make ${data.robots.url} load with HTTP 200 (or 404 if you have no rules). Crawlers that follow RFC 9309 treat a robots.txt that fails with a 5xx error as a full block.`
  }
  const viaOwnGroup = blocked.filter(c => c.rule && c.rule.group !== "*")
  const viaWildcard = blocked.filter(c => !c.rule || c.rule.group === "*")
  const parts = []
  if (viaOwnGroup.length) {
    parts.push(
      `Remove the Disallow rule from each crawler's own group in robots.txt: ${list(viaOwnGroup.map(c => `${c.token} (line ${c.rule?.line})`))}.`
    )
  }
  if (viaWildcard.length) {
    parts.push(
      `Add this group to robots.txt. It repeats your other rules, because a crawler that has its own group ignores the User-agent: * group:\n\n${allowSnippet(
        data,
        viaWildcard.map(c => c.token)
      )}`
    )
  }
  return parts.join("\n\n")
}

/** @param {CrawlerResult[]} evals @param {ScanData} data @returns {Check} */
function searchCrawlersCheck(evals, data) {
  const mine = evals.filter(e => SEARCH_CRAWLERS.some(c => c.token === e.token))
  const max = mine.reduce((a, c) => a + c.points, 0)
  const points = mine.reduce((a, c) => a + c.earned, 0)
  const blocked = mine.filter(c => c.state !== "allowed")
  const check = make({ id: "search-crawlers", category: "crawlers", title: "Search and answer crawlers", maxPoints: max, points })
  if (!blocked.length) {
    check.summary = `All ${mine.length} allowed: ${list(mine.map(c => c.token))}`
    return check
  }
  const critical = blocked.some(c => c.critical && c.state === "blocked")
  check.status = critical ? "fail" : "warn"
  check.severity = critical ? "error" : "warning"
  check.summary = `${list(blocked.map(c => c.token))} ${blocked.length === 1 ? "is" : "are"} blocked`
  for (const c of blocked) {
    const where = c.state === "partial" ? ` on ${list(c.blockedPaths)}` : ""
    check.details.push(`${c.token} (${c.powers}) is blocked${where} by ${whyBlocked(c, data)}. -${c.points - c.earned}`)
  }
  if (blocked.some(c => c.role === "user")) {
    check.details.push("OpenAI and Perplexity say robots.txt may not apply to fetches a user starts. A block still tells them you do not want those visits.")
  }
  check.fix = crawlerFix(blocked, data)
  return check
}

/** @param {CrawlerResult[]} evals @param {ScanData} data @returns {Check} */
function trainingCrawlersCheck(evals, data) {
  const mine = evals.filter(e => TRAINING_CRAWLERS.some(c => c.token === e.token))
  const max = mine.reduce((a, c) => a + c.points, 0)
  const points = mine.reduce((a, c) => a + c.earned, 0)
  const blocked = mine.filter(c => c.state !== "allowed")
  const check = make({ id: "training-crawlers", category: "crawlers", title: "Training crawlers", maxPoints: max, points })
  if (!blocked.length) {
    check.summary = `All ${mine.length} allowed: ${list(mine.map(c => c.token))}`
    return check
  }
  check.status = "warn"
  check.severity = "warning"
  check.summary = `${list(blocked.map(c => c.token))} ${blocked.length === 1 ? "is" : "are"} blocked`
  for (const c of blocked) {
    check.details.push(`${c.token} (${c.powers}) is blocked by ${whyBlocked(c, data)}. -${c.points - c.earned}`)
  }
  check.details.push(
    "Blocking training crawlers is a legitimate choice and never fails the run. It does not remove you from ChatGPT, Claude or Perplexity search, which use the crawlers above."
  )
  if (blocked.some(c => c.token === "Google-Extended")) {
    check.details.push("Google-Extended also controls grounding in Gemini Apps. Google says it does not affect inclusion in Google Search, and names Googlebot's rules as the control for AI Overviews.")
  }
  const how = crawlerFix(blocked, data)
  check.fix = `If the block is deliberate, keep it. To let models learn from your public pages, ${how.charAt(0).toLowerCase()}${how.slice(1)}`
  return check
}

/** @param {CrawlerResult[]} evals @param {ScanData} data @returns {Check} */
function robotsFileCheck(evals, data) {
  const check = make({ id: "robots-txt", category: "crawlers", title: "robots.txt file", maxPoints: 0, points: 0 })
  check.status = "info"
  const { robots } = data
  if (robots.state === "unreachable") {
    check.status = "fail"
    check.severity = "error"
    check.summary = robots.status ? `Could not load (HTTP ${robots.status})` : `Could not load (${robots.error || "no response"})`
    check.details.push("Crawlers that follow RFC 9309 treat an unreachable robots.txt as a full block, so every crawler counts as blocked.")
    check.fix = `Make ${robots.url} return HTTP 200 with your rules, or 404 if you have none.`
    return check
  }
  if (robots.state === "missing") {
    check.summary = `Not found (HTTP ${robots.status}). Every crawler may fetch every page.`
    check.fix = "Optional: add a robots.txt with a Sitemap: line so crawlers find your sitemap."
  } else if (robots.parsed) {
    const parsed = robots.parsed
    check.summary = `Found: ${plural(parsed.groups.length, "group")}, ${plural(parsed.sitemaps.length, "sitemap line")}`
    if (parsed.looksLikeHtml) {
      check.status = "warn"
      check.severity = "warning"
      check.summary = "Returns an HTML page, so crawlers find no rules in it"
      check.fix = "Serve a plain-text robots.txt. Single-page apps often return index.html for every path; add a real file or route for /robots.txt."
    }
    const notable = parsed.issues.filter(i => i.severity !== "info" && i.code !== "looks_like_html").slice(0, 4)
    for (const issue of notable) {
      check.details.push(`${issue.line ? `Line ${issue.line}: ` : ""}${issue.text}`)
      if (check.status === "info") {
        check.status = "warn"
        check.severity = "warning"
      }
    }
    for (const issue of parsed.issues.filter(i => i.code === "noindex_directive").slice(0, 1)) {
      check.details.push(`Line ${issue.line}: ${issue.text}`)
    }
    const trap = droppedWildcardRules(
      parsed,
      AI_CRAWLERS.map(c => c.token)
    )
    if (trap.length) {
      check.status = "warn"
      check.severity = "warning"
      const tokens = trap.map(t => t.token)
      const example = trap[0].dropped[0]
      check.details.push(
        `${list(tokens)} ${tokens.length === 1 ? "has its own group, so it ignores" : "have their own groups, so they ignore"} the Disallow rules in User-agent: * (for example "Disallow: ${example.value}" on line ${example.line}). Under RFC 9309 a crawler obeys only its most specific group.`
      )
      check.fix = `If those paths should stay closed to AI crawlers too, repeat the Disallow lines inside each named group.`
    }
    for (const signal of parsed.contentSignals.slice(0, 2)) {
      check.details.push(`Content-Signal: ${signal}`)
    }
  }
  const otherBlocked = evals.filter(e => OTHER_CRAWLERS.some(c => c.token === e.token) && e.state !== "allowed")
  if (otherBlocked.length) {
    check.details.push(`Also blocked (not scored): ${list(otherBlocked.map(c => c.token))}.`)
  }
  const homeHeaders = data.pages[0]?.headers ?? {}
  if (/cloudflare/i.test(homeHeaders.server || "") || homeHeaders["cf-ray"]) {
    check.details.push(
      "This site is served through Cloudflare, which can block AI crawlers at the edge. robots.txt does not show that block, so also check the AI crawler settings in your Cloudflare dashboard."
    )
  }
  if (!check.summary) check.summary = "Checked"
  return check
}

// ---------------------------------------------------------------- indexing

/** @param {ScanData} data @returns {Check} */
function pagesLoadCheck(data) {
  const check = make({ id: "pages-load", category: "indexing", title: "Pages load", maxPoints: 5 })
  const [home] = data.pages
  const good = data.pages.filter(ok).length
  check.points = share(5, data.pages.map(p => (ok(p) ? 1 : 0)))
  if (!ok(home)) {
    check.points = 0
    check.status = "fail"
    check.severity = "error"
    check.summary = `The page returned HTTP ${home.status}`
    check.fix = "Make the page return HTTP 200. Crawlers do not index or quote error pages."
    if (home.status === 401) {
      check.details.push("HTTP 401 means the page needs a login. For a protected preview deployment, pass your bypass token with --header (for Vercel: x-vercel-protection-bypass).")
    } else if (home.status === 403 || home.status === 429) {
      check.details.push(
        `HTTP ${home.status} usually comes from bot protection or a firewall. It blocked this tool, and it may block AI crawlers too. Check your CDN or firewall rules for AI crawler user agents.`
      )
    }
  } else {
    check.summary = `${good} of ${data.pages.length} ${data.pages.length === 1 ? "page returns" : "pages return"} HTTP 200`
  }
  if (home.redirects.length) {
    const chain = [...home.redirects, home.finalUrl].join(" -> ")
    check.details.push(`Redirects: ${chain}`)
    if (home.redirects.length >= 3) {
      check.details.push(`${home.redirects.length} redirects before the page loads. Link and list the final URL directly.`)
      if (check.status === "pass") {
        check.status = "warn"
        check.severity = "warning"
      }
    }
  }
  for (const page of data.pages.slice(1)) {
    if (!ok(page)) check.details.push(`${page.path} returned ${page.status ? `HTTP ${page.status}` : page.error || "no response"}`)
    else if (page.contentType && !/html/i.test(page.contentType)) check.details.push(`${page.path} is served as ${page.contentType}`)
  }
  if (check.status === "pass" && good < data.pages.length) {
    check.status = "warn"
    check.severity = "warning"
    check.fix = "Fix or remove links to pages that return errors."
  }
  for (const skip of data.skipped) check.details.push(`Not checked: ${skip.path} (${skip.reason})`)
  return check
}

const SNIPPET_KEYS = /^(max-snippet|max-image-preview|max-video-preview|unavailable_after)$/i

/**
 * Split an X-Robots-Tag value into directives, each scoped to all crawlers
 * or to the one named before it ("googlebot: noindex").
 * @param {string} value
 * @returns {{ scope: string, directive: string }[]}
 */
export function parseXRobotsTag(value) {
  /** @type {{ scope: string, directive: string }[]} */
  const out = []
  let scope = "all"
  for (const part of (value || "").split(",")) {
    const token = part.trim()
    if (!token) continue
    const m = /^([a-z0-9_-]+)\s*:\s*(.*)$/i.exec(token)
    if (m && !SNIPPET_KEYS.test(m[1])) {
      scope = m[1].toLowerCase()
      if (m[2].trim()) out.push({ scope, directive: m[2].trim().toLowerCase() })
    } else {
      out.push({ scope, directive: token.toLowerCase().replace(/\s+/g, "") })
    }
  }
  return out
}

/**
 * Every robots directive that applies to a page, from meta tags and headers.
 * @param {PageData} page
 * @returns {{ scope: string, directive: string, source: "meta" | "header" }[]}
 */
export function pageDirectives(page) {
  /** @type {{ scope: string, directive: string, source: "meta" | "header" }[]} */
  const out = []
  for (const meta of page.facts?.metaRobots ?? []) {
    const scope = meta.name === "robots" ? "all" : meta.name
    for (const d of meta.content.split(",")) {
      const directive = d.trim().toLowerCase().replace(/\s+/g, "")
      if (directive) out.push({ scope, directive, source: "meta" })
    }
  }
  for (const d of parseXRobotsTag(page.headers["x-robots-tag"] || "")) out.push({ ...d, source: "header" })
  return out
}

/** @param {ScanData} data @returns {Check} */
function noindexCheck(data) {
  const check = make({ id: "noindex", category: "indexing", title: "No noindex", maxPoints: 8 })
  const pages = data.pages.filter(ok)
  if (!pages.length) return skip(check)
  /** @type {number[]} */
  const scores = []
  let homeBlocked = false
  let previewIgnored = false
  pages.forEach((page, index) => {
    const hits = pageDirectives(page).filter(d => d.directive === "noindex" || d.directive === "none")
    let score = 1
    for (const hit of hits) {
      const label = hit.source === "header" ? `X-Robots-Tag: ${hit.scope === "all" ? "" : `${hit.scope}: `}${hit.directive}` : `<meta name="${hit.scope === "all" ? "robots" : hit.scope}" content="${hit.directive}">`
      if (hit.scope === "all" && hit.source === "header" && data.preview) {
        previewIgnored = true
        continue
      }
      if (hit.scope === "all" || hit.scope === "googlebot") {
        score = 0
        if (index === 0) homeBlocked = true
        check.details.push(`${page.path}: ${label} keeps it out of search indexes${hit.scope === "googlebot" ? " (Google, including AI Overviews)" : ""}.`)
      } else {
        score = Math.min(score, 0.5)
        check.details.push(`${page.path}: ${label} tells ${hit.scope} not to index it.`)
      }
    }
    scores.push(score)
  })
  check.points = share(8, scores)
  if (previewIgnored) {
    check.details.push(
      "X-Robots-Tag: noindex on this preview deployment was not counted. Vercel, Netlify and Cloudflare Pages add it outside production on purpose."
    )
  }
  if (check.points === 8) {
    check.summary = `No noindex on ${plural(pages.length, "page")}`
    return check
  }
  check.status = homeBlocked ? "fail" : "warn"
  check.severity = homeBlocked ? "error" : "warning"
  check.summary = homeBlocked ? "The page is marked noindex" : "Some pages are marked noindex"
  check.fix =
    "Remove noindex from pages you want AI engines to find and quote. Check meta robots tags in your templates and X-Robots-Tag headers in your server, CDN or framework config."
  return check
}

/** @param {ScanData} data @returns {Check} */
function snippetCheck(data) {
  const check = make({ id: "snippets", category: "indexing", title: "Snippets allowed", maxPoints: 4 })
  const pages = data.pages.filter(ok)
  if (!pages.length) return skip(check)
  /** @type {number[]} */
  const scores = []
  let homeBlocked = false
  pages.forEach((page, index) => {
    let score = 1
    for (const d of pageDirectives(page)) {
      if (d.scope !== "all" && d.scope !== "googlebot") continue
      const m = /^max-snippet:(-?\d+)$/.exec(d.directive)
      if (d.directive === "nosnippet" || (m && Number(m[1]) === 0)) {
        score = 0
        if (index === 0) homeBlocked = true
        check.details.push(`${page.path}: ${d.directive} stops Google from showing text from this page, including in AI Overviews and AI Mode.`)
      } else if (m && Number(m[1]) > 0 && Number(m[1]) < 50) {
        score = Math.min(score, 0.5)
        check.details.push(`${page.path}: ${d.directive} limits snippets to ${m[1]} characters.`)
      }
    }
    if (page.facts?.dataNosnippetCount) {
      check.details.push(`${page.path}: ${plural(page.facts.dataNosnippetCount, "element")} marked data-nosnippet (fine on a banner, harmful on your main content).`)
    }
    scores.push(score)
  })
  check.points = share(4, scores)
  if (check.points === 4) {
    check.summary = "No nosnippet or tight max-snippet rules"
    return check
  }
  check.status = homeBlocked ? "fail" : "warn"
  check.severity = "warning"
  check.summary = "Snippet rules limit what AI features can quote"
  check.fix = "Remove nosnippet and max-snippet limits from pages you want quoted. Google names these rules as the controls for AI Overviews and AI Mode."
  check.learnMore = "https://developers.google.com/search/docs/appearance/ai-features"
  return check
}

/** @param {ScanData} data @returns {Check} */
function canonicalCheck(data) {
  const check = make({ id: "canonical", category: "indexing", title: "Canonical URLs", maxPoints: 3 })
  const pages = data.pages.filter(p => ok(p) && p.facts)
  if (!pages.length) return skip(check)
  const hosts = new Set(data.siteHosts)
  /** @type {number[]} */
  const scores = []
  for (const page of pages) {
    const tags = page.facts?.canonicals ?? []
    /** @type {URL[]} */
    const resolved = []
    for (const t of tags) {
      try {
        resolved.push(new URL(t, page.finalUrl))
      } catch {
        check.details.push(`${page.path}: canonical "${t}" is not a valid URL`)
      }
    }
    const distinct = [...new Set(resolved.map(u => u.href))]
    if (!tags.length) {
      scores.push(0.5)
      check.details.push(`${page.path}: no canonical tag`)
      continue
    }
    if (distinct.length !== 1) {
      scores.push(distinct.length ? 0.5 : 0)
      if (distinct.length > 1) check.details.push(`${page.path}: ${distinct.length} different canonical tags`)
      continue
    }
    const target = resolved[0]
    const pagePath = new URL(page.finalUrl).pathname.replace(/\/+$/, "") || "/"
    const targetPath = target.pathname.replace(/\/+$/, "") || "/"
    if (!hosts.has(target.hostname.toLowerCase())) {
      scores.push(0)
      check.details.push(`${page.path}: canonical points to another site: ${target.href}`)
    } else if (pagePath !== "/" && targetPath === "/") {
      scores.push(0)
      check.details.push(`${page.path}: canonical points to the homepage, so engines may drop this page`)
    } else if (target.protocol === "http:" && new URL(page.finalUrl).protocol === "https:") {
      scores.push(0.5)
      check.details.push(`${page.path}: canonical uses http:// on an https:// page`)
    } else {
      scores.push(1)
      if (targetPath !== pagePath) check.details.push(`${page.path}: canonical is ${target.pathname} (fine if that is the main version)`)
    }
  }
  check.points = share(3, scores)
  if (check.points === 3) {
    check.summary = `${plural(pages.length, "page")} with a clean canonical`
    return check
  }
  check.status = check.points === 0 ? "fail" : "warn"
  check.severity = "warning"
  check.summary = "Canonical tags are missing or point elsewhere"
  check.fix =
    'Give each page one <link rel="canonical" href="..."> with its own absolute URL. A canonical that points to another page or site asks engines to use that one instead.'
  check.learnMore = "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls"
  return check
}

// ---------------------------------------------------------------- rendering

/** @param {ScanData} data @returns {Check} */
function serverTextCheck(data) {
  const check = make({ id: "server-text", category: "rendering", title: "Text in the server HTML", maxPoints: 20 })
  const pages = data.pages.filter(p => ok(p) && p.facts)
  if (!pages.length) return skip(check)
  /** @type {number[]} */
  const scores = []
  let homeEmpty = false
  pages.forEach((page, index) => {
    const facts = /** @type {import("./html.js").HtmlFacts} */ (page.facts)
    const words = facts.visibleWords
    const score = words >= 100 ? 1 : words >= 50 ? 0.75 : 0
    if (index === 0 && score === 0) homeEmpty = true
    scores.push(score)
    const signals = []
    if (facts.emptyMountId) signals.push(`#${facts.emptyMountId} is empty`)
    if (facts.noscriptAsksForJs) signals.push("a <noscript> message asks for JavaScript")
    check.details.push(`${page.path}: ${plural(words, "word")} of text${signals.length ? `; ${signals.join("; ")}` : ""}`)
  })
  check.points = share(20, scores)
  if (check.points === 20) {
    check.summary = `Content is in the HTML on ${plural(pages.length, "page")}`
    check.details = check.details.slice(0, 3)
    return check
  }
  check.status = homeEmpty ? "fail" : "warn"
  check.severity = homeEmpty ? "error" : "warning"
  check.summary = homeEmpty
    ? "The page is nearly empty without JavaScript"
    : "Some pages have little text without JavaScript"
  check.details.push(
    "Vercel's study of AI crawler traffic (December 2024) found that the major AI crawlers it measured (OpenAI, Anthropic, Meta, ByteDance, Perplexity) do not run JavaScript. Text that only appears after scripts run is invisible to them."
  )
  check.fix = `Render the main content into the HTML on the server: server-side rendering, static generation or prerendering. To test it, look for a sentence from your page in the raw HTML: curl -s ${pages[0].finalUrl} | grep "a sentence from your page"`
  check.learnMore = "https://vercel.com/blog/the-rise-of-the-ai-crawler"
  return check
}

// ---------------------------------------------------------------- structured data

const ORG_TYPES = new Set(
  [
    "Organization", "Corporation", "OnlineBusiness", "OnlineStore", "LocalBusiness", "NGO",
    "EducationalOrganization", "GovernmentOrganization", "MedicalOrganization", "NewsMediaOrganization",
    "SportsOrganization", "Store", "Restaurant", "ProfessionalService", "LegalService", "Attorney",
    "Dentist", "Physician", "FinancialService", "RealEstateAgent", "HomeAndConstructionBusiness",
    "AutomotiveBusiness", "LodgingBusiness", "Hotel", "HealthAndBeautyBusiness", "FoodEstablishment",
    "Person", "Brand"
  ].map(t => t.toLowerCase())
)
const ARTICLE_TYPES = new Set(["article", "blogposting", "newsarticle", "techarticle", "scholarlyarticle", "report"])

/** @param {string} t */
const isOrg = t => ORG_TYPES.has(t.toLowerCase()) || /(business|organization|service|store)$/i.test(t)

/** @param {ScanData} data @returns {Check} */
function jsonLdCheck(data) {
  const check = make({ id: "json-ld", category: "structured-data", title: "JSON-LD structured data", maxPoints: 10 })
  const pages = data.pages.filter(p => ok(p) && p.facts)
  if (!pages.length) return skip(check)
  let valid = 0
  let invalid = 0
  /** @type {Set<string>} */
  const allTypes = new Set()
  /** @type {string[]} */
  const suggestions = []
  let homeIdentity = 0
  pages.forEach((page, index) => {
    const facts = /** @type {import("./html.js").HtmlFacts} */ (page.facts)
    const types = []
    facts.jsonLd.forEach((block, i) => {
      if (block.error) {
        invalid++
        check.details.push(`${page.path}: JSON-LD block ${i + 1} is not valid JSON (${clip(block.error, 80)})`)
        return
      }
      valid++
      types.push(...jsonLdTypes(block.data))
    })
    const unique = [...new Set(types)]
    unique.forEach(t => allTypes.add(t))
    check.details.push(`${page.path}: ${unique.length ? unique.join(", ") : "no JSON-LD"}${facts.microdata ? " (plus microdata, not scored)" : ""}`)
    const lower = unique.map(t => t.toLowerCase())
    if (index === 0) {
      if (unique.some(isOrg)) homeIdentity = 4
      else if (lower.includes("website")) homeIdentity = 2
      if (!lower.includes("website")) suggestions.push("Add WebSite to the homepage with your site name and URL.")
      const org = facts.jsonLd
        .filter(b => !b.error)
        .flatMap(b => jsonLdNodes(b.data))
        .find(n => [].concat(/** @type {any} */ (n["@type"])).some(t => typeof t === "string" && isOrg(t)))
      if (!org) suggestions.push("Add Organization (or LocalBusiness, or Person) with name, url, logo and sameAs links to your profiles.")
      else {
        const missing = ["name", "url", "logo", "sameAs"].filter(k => !org[k])
        if (missing.length) suggestions.push(`Your ${org["@type"]} has no ${list(missing)}. Add ${missing.length === 1 ? "it" : "them"} so engines can tie the brand to its profiles.`)
      }
    } else {
      const articleLike = /\/(blog|news|articles?|posts?|guides?|insights)\/./i.test(page.path)
      if (articleLike && !lower.some(t => ARTICLE_TYPES.has(t))) suggestions.push(`${page.path} looks like an article. Add Article or BlogPosting with author and dates.`)
      if (!lower.includes("breadcrumblist") && page.path.split("/").filter(Boolean).length > 1) {
        suggestions.push(`${page.path}: add BreadcrumbList to show where the page sits in the site.`)
      }
    }
  })
  check.points = (valid ? 4 : 0) + (valid && !invalid ? 2 : 0) + homeIdentity
  for (const s of suggestions.slice(0, 4)) check.details.push(`Suggestion: ${s}`)
  if (check.points === 10) {
    check.summary = [...allTypes].slice(0, 6).join(", ")
    return check
  }
  check.status = check.points === 0 ? "fail" : "warn"
  check.severity = "warning"
  if (!valid && !invalid) check.summary = "No JSON-LD found"
  else if (invalid) check.summary = `${plural(invalid, "block")} with invalid JSON`
  else if (!homeIdentity) check.summary = "No Organization or WebSite on the start page"
  else check.summary = "WebSite found, no Organization"
  check.fix =
    'Add a <script type="application/ld+json"> block with Organization and WebSite to your homepage, and the type that fits each page (Article, Product, SoftwareApplication, LocalBusiness). Validate it with https://validator.schema.org.'
  check.learnMore = "https://developers.google.com/search/docs/appearance/structured-data/organization"
  return check
}

// ---------------------------------------------------------------- answers

const THROAT_CLEARING = [
  "in today's", "in today’s", "in this article", "in this post", "in this guide", "in this blog",
  "when it comes to", "have you ever", "are you looking", "are you wondering", "ever wondered",
  "it's no secret", "it’s no secret", "we all know", "as you may know", "let's dive", "let’s dive",
  "let's take a look", "let’s take a look", "let's explore", "let’s explore", "welcome to", "imagine",
  "picture this", "in the world of", "in the realm of", "with the rise of", "in recent years",
  "there are many", "there is no doubt", "it's important to", "it’s important to", "first of all",
  "nowadays", "these days", "in der heutigen", "in diesem artikel", "heutzutage", "dans cet article",
  "de nos jours", "en este artículo", "hoy en día", "in dit artikel", "tegenwoordig"
]

/** @param {ScanData} data @returns {Check} */
function titleDescriptionCheck(data) {
  const check = make({ id: "title-description", category: "answers", title: "Title and description", maxPoints: 4 })
  const pages = data.pages.filter(p => ok(p) && p.facts)
  if (!pages.length) return skip(check)
  /** @type {number[]} */
  const scores = []
  const titles = new Map()
  for (const page of pages) {
    const facts = /** @type {import("./html.js").HtmlFacts} */ (page.facts)
    let s = 0
    const title = facts.title || ""
    if (!title) check.details.push(`${page.path}: no <title>`)
    else if (title.length < 10 || title.length > 70) {
      s += 1
      check.details.push(`${page.path}: title is ${title.length} characters (aim for 10 to 70): "${clip(title, 80)}"`)
    } else s += 2
    const desc = facts.metaDescription || ""
    if (!desc) check.details.push(`${page.path}: no meta description`)
    else if (desc.length < 50 || desc.length > 170) {
      s += 1
      check.details.push(`${page.path}: meta description is ${desc.length} characters (aim for 50 to 170)`)
    } else s += 2
    if (title) titles.set(title, (titles.get(title) || 0) + 1)
    scores.push(s / 4)
  }
  for (const [title, count] of titles) if (count > 1) check.details.push(`${count} pages share the title "${clip(title, 60)}"`)
  check.points = share(4, scores)
  if (check.points === 4) {
    check.summary = `Present and sized well on ${plural(pages.length, "page")}`
    return check
  }
  check.status = check.points <= 1 ? "fail" : "warn"
  check.severity = "warning"
  check.summary = "Missing or poorly sized on some pages"
  check.fix = "Give every page a unique <title> that names the page and the brand, and a meta description that answers what the page is about in one or two sentences."
  return check
}

/** @param {ScanData} data @returns {Check} */
function headingsCheck(data) {
  const check = make({ id: "headings", category: "answers", title: "One H1 per page", maxPoints: 2 })
  const pages = data.pages.filter(p => ok(p) && p.facts)
  if (!pages.length) return skip(check)
  const scores = pages.map(page => {
    const n = page.facts?.h1Count ?? 0
    if (n !== 1) check.details.push(`${page.path}: ${n === 0 ? "no H1" : `${n} H1s`}`)
    return n === 1 ? 1 : n > 1 ? 0.5 : 0
  })
  check.points = share(2, scores)
  if (check.points === 2) {
    const h1 = pages[0].facts?.headings.find(h => h.level === 1)?.text
    check.summary = h1 ? `"${clip(h1, 70)}"` : "One H1 on every page"
    return check
  }
  check.status = check.points === 0 ? "fail" : "warn"
  check.severity = "warning"
  check.summary = "Pages without exactly one H1"
  check.fix = "Give each page one H1 that states what the page is about, then use H2s for sections."
  return check
}

/** @param {ScanData} data @returns {Check} */
function openingCheck(data) {
  const check = make({ id: "opening-sentence", category: "answers", title: "Direct opening sentence", maxPoints: 2 })
  const pages = data.pages.filter(p => ok(p) && p.facts)
  if (!pages.length) return skip(check)
  /** @type {number[]} */
  const scores = []
  for (const page of pages) {
    const opening = page.facts?.openingText
    if (!opening) continue
    const first = sentences(opening)[0] || opening
    const words = countWords(first)
    const lower = first.toLowerCase()
    const filler = THROAT_CLEARING.find(p => lower.startsWith(p))
    let score = 1
    let note = ""
    if (filler) {
      score = 0
      note = `opens with "${filler}"`
    } else if (words > 40) {
      score = 0
      note = `${words} words`
    } else if (words > 30) {
      score = 0.5
      note = `${words} words`
    }
    scores.push(score)
    check.details.push(`${page.path}: "${clip(first, 140)}"${note ? ` (${note})` : ""}`)
  }
  if (!scores.length) {
    check.points = 0
    check.status = "warn"
    check.severity = "warning"
    check.summary = "No text found right after the H1"
    check.fix = "Follow the H1 with one plain sentence that says what the page offers. AI answers often quote the first sentence under a heading."
    return check
  }
  check.points = share(2, scores)
  if (check.points === 2) {
    check.summary = "Pages open with a short, direct sentence"
    check.details = check.details.slice(0, 2)
    return check
  }
  check.status = check.points === 0 ? "fail" : "warn"
  check.severity = "warning"
  check.summary = "Opening sentences are long or slow to start"
  check.fix = "Start each page with the answer: one sentence of 30 words or fewer that says what it is, who it is for or what it costs. Cut warm-up phrases."
  return check
}

/** @param {ScanData} data */
function brandNames(data) {
  const names = new Set()
  const home = data.pages[0]
  const facts = home?.facts
  if (facts?.ogSiteName) names.add(facts.ogSiteName)
  for (const block of facts?.jsonLd ?? []) {
    if (block.error) continue
    for (const node of jsonLdNodes(block.data)) {
      const types = [].concat(/** @type {any} */ (node["@type"]))
      if (types.some(t => typeof t === "string" && (isOrg(t) || t === "WebSite")) && typeof node.name === "string") names.add(node.name)
    }
  }
  if (facts?.title) {
    for (const part of facts.title.split(/\s[|·•\u2013\u2014:-]\s/)) {
      if (part.trim().length >= 2 && part.trim().length <= 30) names.add(part.trim())
    }
  }
  if (home) {
    const label = new URL(home.finalUrl).hostname.replace(/^www\./, "").split(".")[0]
    if (label && label.length >= 2) names.add(label)
  }
  return [...names].filter(n => n.length >= 2 && n.length <= 40)
}

/** @param {string} s */
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** @param {ScanData} data @returns {Check} */
function definitionCheck(data) {
  const check = make({ id: "says-what-it-is", category: "answers", title: "Says what it is", maxPoints: 2 })
  const pages = data.pages.filter(p => ok(p) && p.facts)
  if (!pages.length) return skip(check)
  const names = brandNames(data)
  const alt = names.map(escapeRe).join("|")
  const strongRe = names.length ? new RegExp(`(?:^|[^\\p{L}])(?:${alt})\\s+(?:is|are)\\s+(?:a|an|the|your|our)?\\s*[\\p{L}\\p{N}]`, "iu") : null
  const weakRe = names.length ? new RegExp(`^(?:the\\s+)?(?:${alt})\\s+(?:helps|lets|gives|makes|provides|offers|turns|builds)\\b`, "iu") : null
  const genericRe = /^(?:the\s+)?[\p{Lu}][\p{L}\p{N}&.' -]{1,40}\s+(?:is|are)\s+(?:a|an|the)\s+/u
  /** @type {{ s: string, path: string } | null} */
  let generic = null
  /** @type {{ s: string, path: string } | null} */
  let weak = null
  for (const page of pages) {
    const blocks = page.facts?.textBlocks ?? []
    for (const s of blocks.flatMap(b => sentences(b)).slice(0, 600)) {
      const words = countWords(s)
      if (words < 5 || words > 60) continue
      if (strongRe && strongRe.test(s)) {
        check.summary = `"${clip(s, 110)}"`
        check.details.push(`Found on ${page.path}`)
        return check
      }
      if (!weak && weakRe && weakRe.test(s)) weak = { s, path: page.path }
      if (!generic && genericRe.test(s)) generic = { s, path: page.path }
    }
  }
  if (weak) {
    check.summary = `"${clip(weak.s, 110)}"`
    check.details.push(`Found on ${weak.path}`)
    return check
  }
  if (generic) {
    check.points = 1
    check.status = "warn"
    check.severity = "warning"
    check.summary = `A definition, but not of your brand: "${clip(generic.s, 90)}"`
  } else {
    check.points = 0
    check.status = "fail"
    check.severity = "warning"
    check.summary = "No sentence says what the brand is"
  }
  if (names.length) check.details.push(`Looked for: ${list(names.slice(0, 4).map(n => `"${n} is..."`))}`)
  check.fix = `Add one plain sentence near the top of your homepage, in the HTML: "${names[0] || "Acme"} is a [category] that [does what] for [whom]." AI answers lift sentences like this when someone asks what you are.`
  return check
}

// ---------------------------------------------------------------- discovery

/** @param {ScanData} data @returns {Check} */
function sitemapCheck(data) {
  const check = make({ id: "sitemap", category: "discovery", title: "XML sitemap", maxPoints: 3 })
  const { sitemap } = data
  const hosts = new Set(data.siteHosts)
  if (sitemap.skipped) {
    check.points = 0
    check.status = "skip"
    check.summary = `Not checked: ${sitemap.skipped}`
    return check
  }
  if (!sitemap.result || sitemap.status < 200 || sitemap.status >= 300) {
    check.points = 0
    check.status = "warn"
    check.severity = "warning"
    check.summary = sitemap.status ? `${sitemap.url} returned HTTP ${sitemap.status}` : `${sitemap.url} did not load (${sitemap.error || "no response"})`
    check.fix = "Publish an XML sitemap of your public pages and list it in robots.txt with a line like Sitemap: https://example.com/sitemap.xml"
    return check
  }
  const r = sitemap.result
  if (r.error && !r.urls.length) {
    check.points = 0
    check.status = "fail"
    check.severity = "warning"
    check.summary = r.error
    check.fix = "Serve a valid XML sitemap (urlset or sitemapindex). If your app returns HTML for unknown paths, add a real route for it."
    return check
  }
  const offsite = r.urls.filter(u => {
    try {
      return !hosts.has(new URL(u).hostname.toLowerCase())
    } catch {
      return true
    }
  })
  check.summary =
    r.kind === "sitemapindex"
      ? `Sitemap index with ${plural(r.urls.length, "child sitemap")}`
      : `${plural(r.urls.length, "URL")} in ${new URL(sitemap.url).pathname}`
  if (offsite.length) check.details.push(`${plural(offsite.length, "URL")} on other hosts, for example ${clip(offsite[0], 80)}`)
  if (!sitemap.listedInRobots) {
    check.points = 2
    check.status = "warn"
    check.severity = "warning"
    check.details.push("Found at the default path. robots.txt does not list it.")
    check.fix = `Add "Sitemap: ${sitemap.url}" to robots.txt so every crawler finds it.`
  }
  return check
}

/** @param {ScanData} data @returns {Check} */
function llmsTxtCheck(data) {
  const check = make({ id: "llms-txt", category: "discovery", title: "llms.txt", maxPoints: 2 })
  const { llms } = data
  const honest = "No major AI search engine has said it reads llms.txt, so it carries 2 points. It is cheap to add and follows a proposed format (llmstxt.org)."
  if (llms.skipped) {
    check.points = 0
    check.status = "skip"
    check.summary = `Not checked: ${llms.skipped}`
    return check
  }
  if (!llms.result) {
    check.points = 0
    check.status = "warn"
    check.severity = "warning"
    check.summary = llms.status ? `Not found (HTTP ${llms.status})` : `Did not load (${llms.error || "no response"})`
    check.details.push(honest)
    check.fix = "Add /llms.txt: an H1 with your name, a one-line > summary, then H2 sections that list links to your key pages."
    check.learnMore = "https://llmstxt.org"
    return check
  }
  const r = llms.result
  const problems = r.issues.filter(i => i.severity !== "info")
  for (const issue of r.issues.slice(0, 4)) check.details.push(`${issue.line ? `Line ${issue.line}: ` : ""}${issue.text}`)
  if (!r.valid) {
    check.points = 0
    check.status = "fail"
    check.severity = "warning"
    check.summary = "Found, but not in llms.txt format"
  } else if (problems.length) {
    check.points = 1
    check.status = "warn"
    check.severity = "warning"
    check.summary = `"${clip(r.title || "", 50)}" with ${plural(problems.length, "problem")}`
  } else {
    check.summary = `"${clip(r.title || "", 50)}", ${plural(r.linkCount, "link")} in ${plural(r.sections.length, "section")}`
  }
  if (check.status !== "pass") {
    check.details.push(honest)
    check.fix = "Follow the format at https://llmstxt.org: an H1 first, an optional > summary, then H2 sections whose list items start with [Name](url)."
    check.learnMore = "https://llmstxt.org"
  }
  return check
}

/** @param {Check} check */
function skip(check) {
  check.points = 0
  check.status = "skip"
  check.summary = "Skipped: no page loaded"
  return check
}

// ---------------------------------------------------------------- report

/**
 * @typedef {{
 *   tool: { name: string, version: string },
 *   url: string,
 *   finalUrl: string,
 *   checkedAt: string,
 *   score: number,
 *   maxScore: number,
 *   errors: number,
 *   warnings: number,
 *   preview: boolean,
 *   categories: { id: string, title: string, points: number, maxPoints: number }[],
 *   checks: Check[],
 *   crawlers: { token: string, vendor: string, role: string, powers: string, state: string, points: number, maxPoints: number, rule: { line: number, text: string, group: string } | null }[],
 *   pages: { url: string, path: string, status: number, words: number | null, title: string | null }[],
 *   skipped: { path: string, reason: string }[],
 *   requests: { used: number, budget: number },
 *   durationMs: number
 * }} Report
 */

/**
 * Score scan data.
 * @param {ScanData} data
 * @returns {Report}
 */
export function buildReport(data) {
  const evals = evaluateCrawlers(data)
  const checks = [
    searchCrawlersCheck(evals, data),
    trainingCrawlersCheck(evals, data),
    robotsFileCheck(evals, data),
    pagesLoadCheck(data),
    noindexCheck(data),
    snippetCheck(data),
    canonicalCheck(data),
    serverTextCheck(data),
    jsonLdCheck(data),
    titleDescriptionCheck(data),
    headingsCheck(data),
    openingCheck(data),
    definitionCheck(data),
    sitemapCheck(data),
    llmsTxtCheck(data)
  ]
  const categories = CATEGORIES.map(c => ({
    ...c,
    points: checks.filter(k => k.category === c.id).reduce((a, k) => a + k.points, 0)
  }))
  const score = categories.reduce((a, c) => a + c.points, 0)
  return {
    tool: { name: "can-ai-read", version: VERSION },
    url: data.inputUrl,
    finalUrl: data.pages[0].finalUrl,
    checkedAt: new Date().toISOString(),
    score,
    maxScore: 100,
    errors: checks.filter(c => c.severity === "error").length,
    warnings: checks.filter(c => c.severity === "warning").length,
    preview: data.preview,
    categories,
    checks,
    crawlers: evals.map(e => ({
      token: e.token,
      vendor: e.vendor,
      role: e.role,
      powers: e.powers,
      state: e.state,
      points: e.earned,
      maxPoints: e.points,
      rule: e.rule
    })),
    pages: data.pages.map(p => ({
      url: p.finalUrl,
      path: p.path,
      status: p.status,
      words: p.facts ? p.facts.visibleWords : null,
      title: p.facts ? p.facts.title : null
    })),
    skipped: data.skipped,
    requests: data.requests,
    durationMs: data.durationMs
  }
}
