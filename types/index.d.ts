// Type declarations for can-ai-read.

export type CheckStatus = "pass" | "warn" | "fail" | "info" | "skip"
export type CrawlerRole = "search" | "user" | "training"

export interface CheckOptions {
  /** Extra pages to check besides the URL. Default 2 (1 in compare). Max 8. */
  pages?: number
  /** Paths to check instead of discovering them, for example ["/pricing"]. */
  paths?: string[]
  /** Timeout per request in milliseconds. Default 10000. */
  timeoutMs?: number
  /** Extra request headers, sent only to the site being checked. */
  headers?: Record<string, string>
  /** Ignore X-Robots-Tag noindex headers. "auto" detects Vercel, Netlify and Cloudflare Pages previews. */
  preview?: boolean | "auto"
  /** More hostnames that count as this site (for canonical and link checks). */
  siteHosts?: string[]
  /** Hard cap on requests. Default 4 plus the number of pages. */
  maxRequests?: number
  /** A fetch implementation, for tests or proxies. Defaults to the global fetch. */
  fetch?: typeof globalThis.fetch
  /** Override the User-Agent. Please keep a way to contact you in it. */
  userAgent?: string
}

export interface CompareOptions extends CheckOptions {
  /** Headers for the baseline. The target's headers are not sent to it. */
  baselineHeaders?: Record<string, string>
}

export interface Check {
  id: string
  category: string
  title: string
  status: CheckStatus
  severity: "error" | "warning" | null
  points: number
  maxPoints: number
  summary: string
  details: string[]
  fix: string | null
  learnMore: string
}

export interface CrawlerReport {
  token: string
  vendor: string
  role: CrawlerRole
  powers: string
  state: "allowed" | "partial" | "blocked"
  points: number
  maxPoints: number
  rule: { line: number; text: string; group: string } | null
}

export interface Report {
  tool: { name: "can-ai-read"; version: string }
  url: string
  finalUrl: string
  checkedAt: string
  score: number
  maxScore: 100
  errors: number
  warnings: number
  preview: boolean
  categories: { id: string; title: string; points: number; maxPoints: number }[]
  checks: Check[]
  crawlers: CrawlerReport[]
  pages: { url: string; path: string; status: number; words: number | null; title: string | null }[]
  skipped: { path: string; reason: string }[]
  requests: { used: number; budget: number }
  durationMs: number
}

export interface CheckChange {
  id: string
  title: string
  before: number
  after: number
  maxPoints: number
  summary: string
}

export interface Comparison {
  target: Report
  baseline: Report
  scoreDelta: number
  regressions: CheckChange[]
  improvements: CheckChange[]
  crawlerChanges: { token: string; before: string; after: string }[]
}

export interface Crawler {
  token: string
  vendor: string
  role: CrawlerRole
  powers: string
  points: number
  critical: boolean
  source: string
}

export interface RobotsRule {
  type: "allow" | "disallow"
  value: string
  line: number
}

export interface RobotsGroup {
  userAgents: string[]
  line: number
  rules: RobotsRule[]
}

export interface ParsedRobots {
  groups: RobotsGroup[]
  sitemaps: string[]
  contentSignals: string[]
  issues: { code: string; severity: "error" | "warning" | "info"; line: number | null; text: string }[]
  lineCount: number
  looksLikeHtml: boolean
}

export interface RobotsDecision {
  allowed: boolean
  rule: RobotsRule | null
  source: "named" | "wildcard" | "none"
}

export interface LlmsTxtResult {
  valid: boolean
  title: string | null
  summary: string | null
  sections: { title: string; links: number }[]
  linkCount: number
  issues: { severity: "error" | "warning" | "info"; line: number | null; text: string }[]
}

export interface SitemapResult {
  kind: "urlset" | "sitemapindex" | null
  urls: string[]
  looksLikeHtml: boolean
  error: string | null
}

/** Check one URL and score how readable it is for AI crawlers. */
export function check(url: string, options?: CheckOptions): Promise<Report>

/** Check a change against a baseline, with the same paths on both. */
export function compare(targetUrl: string, baselineUrl: string, options?: CompareOptions): Promise<Comparison>

export function diffReports(baseline: Report, target: Report): Comparison

export function parseRobots(text: string): ParsedRobots
export function isAllowed(parsed: ParsedRobots, token: string, path?: string): RobotsDecision
export function patternMatches(pattern: string, path: string): boolean
export function groupsFor(parsed: ParsedRobots, token: string): { groups: RobotsGroup[]; source: "named" | "wildcard" | "none" }
export function wildcardGroups(parsed: ParsedRobots): RobotsGroup[]
export function droppedWildcardRules(parsed: ParsedRobots, tokens: readonly string[]): { token: string; dropped: RobotsRule[] }[]

export function validateLlmsTxt(text: string): LlmsTxtResult
export function parseSitemap(text: string): SitemapResult
export function countWords(text: string): number
export function jsonLdTypes(data: unknown): string[]
export function normalizeUrl(input: string): string
export function isPreviewHost(host: string): boolean
export function parseXRobotsTag(value: string): { scope: string; directive: string }[]

export function formatText(report: Report, options?: { color?: boolean; verbose?: boolean; ref?: string; footer?: boolean }): string
export function formatComparisonText(comparison: Comparison, options?: { color?: boolean; verbose?: boolean; ref?: string }): string
export function formatMarkdown(input: Report | Comparison, options?: { ref?: string; marker?: boolean }): string
export function rankwiseLink(url: string, ref: string): string

export const COMMENT_MARKER: string
export const AI_CRAWLERS: readonly Crawler[]
export const SEARCH_CRAWLERS: readonly Crawler[]
export const TRAINING_CRAWLERS: readonly Crawler[]
export const OTHER_CRAWLERS: readonly Crawler[]
export const CATEGORIES: readonly { id: string; title: string; maxPoints: number }[]
export const VERSION: string
export const USER_AGENT: string
export const ROBOTS_TOKEN: string
export const REPO_URL: string

export class InputError extends Error {}
export class UnreachableError extends Error {
  url: string
  reason: string
}
