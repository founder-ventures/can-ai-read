// Fetch what an AI crawler would fetch: the page, robots.txt, the sitemap,
// llms.txt and a few linked pages. No scoring happens here.

import { Fetcher, ROBOTS_TOKEN } from "./fetch.js"
import { analyzeHtml } from "./html.js"
import { parseRobots, isAllowed, ROBOTS_MAX_BYTES } from "./robots.js"
import { parseSitemap } from "./sitemap.js"
import { validateLlmsTxt } from "./llms-txt.js"

/**
 * @typedef {import("./fetch.js").FetchResult} FetchResult
 * @typedef {import("./html.js").HtmlFacts} HtmlFacts
 * @typedef {{
 *   requestedUrl: string,
 *   finalUrl: string,
 *   path: string,
 *   status: number,
 *   headers: Record<string, string>,
 *   redirects: string[],
 *   contentType: string,
 *   error: string | null,
 *   facts: HtmlFacts | null
 * }} PageData
 * @typedef {{
 *   url: string,
 *   status: number,
 *   state: "found" | "missing" | "unreachable",
 *   error: string | null,
 *   parsed: import("./robots.js").ParsedRobots | null
 * }} RobotsData
 * @typedef {{
 *   url: string,
 *   listedInRobots: boolean,
 *   status: number,
 *   error: string | null,
 *   result: import("./sitemap.js").SitemapResult | null,
 *   skipped: string | null
 * }} SitemapData
 * @typedef {{
 *   url: string,
 *   status: number,
 *   contentType: string,
 *   error: string | null,
 *   result: import("./llms-txt.js").LlmsTxtResult | null,
 *   skipped: string | null
 * }} LlmsData
 * @typedef {{
 *   inputUrl: string,
 *   origin: string,
 *   siteHosts: string[],
 *   preview: boolean,
 *   pages: PageData[],
 *   robots: RobotsData,
 *   sitemap: SitemapData,
 *   llms: LlmsData,
 *   skipped: { path: string, reason: string }[],
 *   requests: { used: number, budget: number },
 *   durationMs: number
 * }} ScanData
 */

/** A bad URL or option from the caller. */
export class InputError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = "InputError"
  }
}

export class UnreachableError extends Error {
  /** @param {string} url @param {string} reason */
  constructor(url, reason) {
    super(`Could not reach ${url}: ${reason}`)
    this.name = "UnreachableError"
    this.url = url
    this.reason = reason
  }
}

/**
 * Turn "example.com" into "https://example.com/".
 * @param {string} input
 */
export function normalizeUrl(input) {
  const raw = String(input || "").trim()
  if (!raw) throw new InputError("A URL is required, for example https://example.com")
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(raw)
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `${local ? "http" : "https"}://${raw}`
  let url
  try {
    url = new URL(withScheme)
  } catch {
    throw new InputError(`Not a valid URL: ${raw}`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InputError(`Only http and https URLs are supported: ${raw}`)
  }
  url.hash = ""
  return url.href
}

/** @param {string} host */
export function hostVariants(host) {
  const bare = host.toLowerCase().replace(/^www\./, "")
  return [bare, `www.${bare}`]
}

/**
 * Hosts where the platform adds X-Robots-Tag: noindex to non-production
 * deployments on purpose.
 * @param {string} host
 */
export function isPreviewHost(host) {
  return /\.(vercel\.app|netlify\.app|pages\.dev)$/i.test(host)
}

const ASSET = /\.(png|jpe?g|gif|webp|avif|svg|ico|pdf|zip|gz|mp4|webm|mp3|wav|css|js|mjs|json|xml|txt|rss|atom|woff2?|ttf|eot|dmg|exe)$/i
const SKIP_PATH = /(^|\/)(login|log-in|signin|sign-in|signup|sign-up|register|logout|cart|checkout|account|my-account|wp-admin|wp-login\.php|admin|cdn-cgi|auth|oauth|search)(\/|$)/i
const GROUP_PRODUCT = /(^|\/)(pricing|plans|about|about-us|company|product|products|features|services|solutions|how-it-works|platform|use-cases)(\/|$)/i
const GROUP_CONTENT = /(^|\/)(blog|docs|documentation|guide|guides|learn|help|faq|resources|articles?|news|posts?|knowledge|academy|support|library|insights)(\/|$)/i

/**
 * Choose which extra pages to check: one product-type page, one content page
 * (a real post beats an index), then whatever links come next.
 * @param {string[]} hrefs links from the start page, in page order
 * @param {string[]} sitemapUrls URLs from the sitemap, used as a fallback
 * @param {string} baseUrl the start page's final URL
 * @param {string[]} siteHosts hosts that count as this site
 * @param {number} count how many paths to return
 * @returns {string[]} paths (with query) relative to the site origin
 */
export function pickPages(hrefs, sitemapUrls, baseUrl, siteHosts, count) {
  if (count <= 0) return []
  const base = new URL(baseUrl)
  const hosts = new Set(siteHosts.map(h => h.toLowerCase()))
  const startPath = base.pathname.replace(/\/+$/, "") || "/"
  /** @param {string} href */
  const toPath = href => {
    if (!href || /^(mailto|tel|javascript|data|sms):/i.test(href) || href.startsWith("#")) return null
    let url
    try {
      url = new URL(href, base)
    } catch {
      return null
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (!hosts.has(url.hostname.toLowerCase())) return null
    if (ASSET.test(url.pathname) || SKIP_PATH.test(url.pathname)) return null
    if ([...url.searchParams.keys()].length > 1) return null
    const path = url.pathname.replace(/\/+$/, "") || "/"
    if (path === startPath) return null
    return path + url.search
  }
  /** @param {string[]} list */
  const unique = list => [...new Set(list.map(toPath).filter(/** @returns {p is string} */ p => !!p))]
  const fromLinks = unique(hrefs)
  const fromSitemap = unique(sitemapUrls.slice(0, 500))
  const depth = (/** @type {string} */ p) => p.split("?")[0].split("/").filter(Boolean).length

  /** @type {string[]} */
  const chosen = []
  const take = (/** @type {string | undefined} */ p) => {
    if (p && !chosen.includes(p) && chosen.length < count) chosen.push(p)
  }
  const pool = [...fromLinks, ...fromSitemap.filter(p => !fromLinks.includes(p))]
  take(
    pool
      .filter(p => GROUP_PRODUCT.test(p))
      .sort((a, b) => depth(a) - depth(b))[0]
  )
  take(
    pool
      .filter(p => GROUP_CONTENT.test(p))
      .sort((a, b) => Math.min(depth(b), 3) - Math.min(depth(a), 3))[0]
  )
  for (const p of pool) take(p)
  return chosen
}

/**
 * @param {FetchResult} res
 * @param {string} requestedUrl
 * @returns {PageData}
 */
function toPage(res, requestedUrl) {
  const contentType = res.headers["content-type"] || ""
  const isHtml = !contentType || /html|xml/i.test(contentType)
  const ok = res.status >= 200 && res.status < 300
  const final = new URL(res.finalUrl)
  return {
    requestedUrl,
    finalUrl: res.finalUrl,
    path: final.pathname + final.search,
    status: res.status,
    headers: res.headers,
    redirects: res.redirects,
    contentType,
    error: res.error,
    facts: ok && isHtml && res.body ? analyzeHtml(res.body) : null
  }
}

/**
 * Fetch everything the checks need for one site.
 * @param {string} input
 * @param {{
 *   pages?: number,
 *   paths?: string[],
 *   timeoutMs?: number,
 *   headers?: Record<string, string>,
 *   preview?: boolean | "auto",
 *   siteHosts?: string[],
 *   maxRequests?: number,
 *   fetch?: typeof globalThis.fetch,
 *   userAgent?: string
 * }} [options]
 * @returns {Promise<ScanData>}
 */
export async function scanSite(input, options = {}) {
  const started = Date.now()
  const inputUrl = normalizeUrl(input)
  const extra = Math.max(0, Math.min(8, options.paths ? options.paths.length : options.pages ?? 2))
  const budget = options.maxRequests ?? 4 + extra
  const fetcher = new Fetcher({
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
    maxRequests: budget,
    headers: options.headers,
    userAgent: options.userAgent
  })
  fetcher.trustOrigin(new URL(inputUrl).origin)

  // 1. The page the user asked for. It is fetched like a browser visit,
  //    because a person asked for it. Pages discovered later obey robots.txt.
  const homeRes = await fetcher.get(inputUrl, {
    accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"
  })
  if (homeRes.status === 0) {
    throw new UnreachableError(inputUrl, homeRes.error || "no response")
  }
  const home = toPage(homeRes, inputUrl)
  const final = new URL(home.finalUrl)
  const origin = final.origin
  fetcher.trustOrigin(origin)

  const siteHosts = [
    ...new Set([
      ...hostVariants(new URL(inputUrl).hostname),
      ...hostVariants(final.hostname),
      ...(options.siteHosts ?? []).flatMap(h => hostVariants(h))
    ])
  ]
  const preview =
    options.preview === true ||
    ((options.preview === undefined || options.preview === "auto") && isPreviewHost(final.hostname))

  // 2. robots.txt at the origin the content lives on.
  const robotsUrl = `${origin}/robots.txt`
  const robotsRes = await fetcher.get(robotsUrl, {
    accept: "text/plain,*/*;q=0.5",
    maxBytes: ROBOTS_MAX_BYTES
  })
  /** @type {RobotsData} */
  const robots = { url: robotsUrl, status: robotsRes.status, state: "missing", error: robotsRes.error, parsed: null }
  if (robotsRes.status >= 200 && robotsRes.status < 300) {
    robots.state = "found"
    robots.parsed = parseRobots(robotsRes.body)
  } else if (robotsRes.status === 0 || robotsRes.status === 429 || robotsRes.status >= 500) {
    robots.state = "unreachable"
  } else {
    robots.state = "missing"
  }

  /** @type {{ path: string, reason: string }[]} */
  const skipped = []
  /** May this tool fetch the path? An unreachable robots.txt means no. */
  const mayFetch = (/** @type {string} */ path) => {
    if (robots.state === "unreachable") return false
    if (!robots.parsed) return true
    return isAllowed(robots.parsed, ROBOTS_TOKEN, path).allowed
  }

  // 3. Sitemap: the first one robots.txt lists, else /sitemap.xml.
  const listed = (robots.parsed?.sitemaps ?? []).find(u => /^https?:\/\//i.test(u))
  const sitemapUrl = listed ?? `${origin}/sitemap.xml`
  /** @type {SitemapData} */
  const sitemap = { url: sitemapUrl, listedInRobots: !!listed, status: 0, error: null, result: null, skipped: null }
  const sitemapPath = new URL(sitemapUrl).pathname
  if (!listed && !mayFetch(sitemapPath)) {
    sitemap.skipped = "robots.txt does not allow this tool to fetch it"
  } else {
    const res = await fetcher.get(sitemapUrl, {
      accept: "application/xml,text/xml;q=0.9,*/*;q=0.5",
      maxBytes: 10 * 1024 * 1024
    })
    sitemap.status = res.status
    sitemap.error = res.error
    if (res.skipped) sitemap.skipped = res.error
    if (res.status >= 200 && res.status < 300) sitemap.result = parseSitemap(res.body)
  }

  // 4. llms.txt
  const llmsUrl = `${origin}/llms.txt`
  /** @type {LlmsData} */
  const llms = { url: llmsUrl, status: 0, contentType: "", error: null, result: null, skipped: null }
  if (!mayFetch("/llms.txt")) {
    llms.skipped = "robots.txt does not allow this tool to fetch it"
  } else {
    const res = await fetcher.get(llmsUrl, { accept: "text/markdown,text/plain;q=0.9,*/*;q=0.5", maxBytes: 1024 * 1024 })
    llms.status = res.status
    llms.error = res.error
    llms.contentType = res.headers["content-type"] || ""
    if (res.skipped) llms.skipped = res.error
    if (res.status >= 200 && res.status < 300) {
      llms.result = validateLlmsTxt(res.body)
      if (/text\/html/i.test(llms.contentType) && llms.result.valid) {
        llms.result.issues.push({ severity: "warning", line: null, text: "Served as text/html. Serve it as text/plain or text/markdown." })
      }
    }
  }

  // 5. A few more pages.
  /** @type {PageData[]} */
  const pages = [home]
  const candidates = options.paths
    ? options.paths.slice(0, extra).map(p => (p.startsWith("/") ? p : `/${p}`))
    : pickPages(
        home.facts?.links ?? [],
        sitemap.result?.kind === "urlset" ? sitemap.result.urls : [],
        home.finalUrl,
        siteHosts,
        extra + 3
      )
  let fetched = 0
  for (const path of robots.state === "unreachable" ? [] : candidates) {
    if (fetched >= extra) break
    if (!mayFetch(path)) {
      skipped.push({ path, reason: "robots.txt does not allow this tool to fetch it" })
      continue
    }
    const url = new URL(path, origin).href
    const res = await fetcher.get(url, { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" })
    if (res.skipped) {
      skipped.push({ path, reason: res.error || "skipped" })
      break
    }
    fetched++
    pages.push(toPage(res, url))
  }
  if (robots.state === "unreachable" && candidates.length) {
    skipped.push({ path: candidates.slice(0, extra).join(", "), reason: "robots.txt could not be loaded, so this tool fetched nothing else" })
  }

  return {
    inputUrl,
    origin,
    siteHosts,
    preview,
    pages,
    robots,
    sitemap,
    llms,
    skipped,
    requests: { used: fetcher.used, budget },
    durationMs: Date.now() - started
  }
}
