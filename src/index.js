// Public API.
//
//   import { check, compare } from "can-ai-read"
//   const report = await check("https://example.com")
//   console.log(report.score, report.checks)

import { buildReport } from "./checks.js"
import { diffReports } from "./compare.js"
import { scanSite } from "./scan.js"

/**
 * @typedef {import("./checks.js").Report} Report
 * @typedef {import("./compare.js").Comparison} Comparison
 * @typedef {{
 *   pages?: number,
 *   paths?: string[],
 *   timeoutMs?: number,
 *   headers?: Record<string, string>,
 *   preview?: boolean | "auto",
 *   siteHosts?: string[],
 *   maxRequests?: number,
 *   fetch?: typeof globalThis.fetch,
 *   userAgent?: string
 * }} CheckOptions
 */

/**
 * Check one URL and score how readable it is for AI crawlers.
 * @param {string} url
 * @param {CheckOptions} [options]
 * @returns {Promise<Report>}
 */
export async function check(url, options = {}) {
  return buildReport(await scanSite(url, options))
}

/**
 * Check a change (for example a preview deployment) against a baseline (for
 * example production). Both get the same paths, so the diff is fair.
 * @param {string} targetUrl
 * @param {string} baselineUrl
 * @param {CheckOptions & { baselineHeaders?: Record<string, string> }} [options]
 * @returns {Promise<Comparison>}
 */
export async function compare(targetUrl, baselineUrl, options = {}) {
  const pages = options.pages ?? 1
  const targetHost = hostOf(targetUrl)
  const baselineHost = hostOf(baselineUrl)
  const target = await check(targetUrl, {
    ...options,
    pages,
    siteHosts: [...(options.siteHosts ?? []), baselineHost].filter(Boolean)
  })
  const paths = options.paths ?? target.pages.slice(1).map(p => p.path)
  const baseline = await check(baselineUrl, {
    ...options,
    headers: options.baselineHeaders ?? {},
    preview: false,
    paths,
    pages: paths.length,
    siteHosts: [...(options.siteHosts ?? []), targetHost].filter(Boolean)
  })
  return diffReports(baseline, target)
}

/** @param {string} url */
function hostOf(url) {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`).hostname
  } catch {
    return ""
  }
}

export { parseXRobotsTag, CATEGORIES } from "./checks.js"
export { diffReports } from "./compare.js"
export { normalizeUrl, isPreviewHost, InputError, UnreachableError } from "./scan.js"
export { parseRobots, isAllowed, patternMatches, groupsFor, droppedWildcardRules, wildcardGroups } from "./robots.js"
export { countWords, jsonLdTypes } from "./html.js"
export { validateLlmsTxt } from "./llms-txt.js"
export { parseSitemap } from "./sitemap.js"
export { formatText, formatComparisonText, formatMarkdown, rankwiseLink, COMMENT_MARKER } from "./report.js"
export { AI_CRAWLERS, SEARCH_CRAWLERS, TRAINING_CRAWLERS, OTHER_CRAWLERS } from "./crawlers.js"
export { VERSION, USER_AGENT, ROBOTS_TOKEN, REPO_URL } from "./fetch.js"
