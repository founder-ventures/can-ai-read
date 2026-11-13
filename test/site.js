// Test helpers: a fake fetch that serves fixtures, so no test touches the
// network. (This file has no tests of its own.)

import { readFileSync } from "node:fs"

/** @param {string} name */
export function fixture(name) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")
}

/**
 * @typedef {{ status?: number, body?: string | null, headers?: Record<string, string> }} Route
 * @param {Record<string, Route | Error | ((url: string, init: any) => Route)>} routes keyed by full URL
 */
export function mockSite(routes) {
  /** @type {{ url: string, method: string, headers: Record<string, string>, body?: string }[]} */
  const calls = []
  /** @type {typeof globalThis.fetch} */
  const fetch = async (input, init = {}) => {
    const url = String(input)
    const headers = /** @type {Record<string, string>} */ (init.headers || {})
    calls.push({ url, method: init.method || "GET", headers, body: /** @type {string | undefined} */ (init.body) })
    let route = routes[url]
    if (typeof route === "function") route = route(url, init)
    if (route instanceof Error) throw route
    if (!route) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } })
    const status = route.status ?? 200
    const body = status >= 300 && status < 400 ? null : route.body ?? ""
    return new Response(body, { status, headers: route.headers ?? {} })
  }
  return { fetch, calls }
}

const html = { "content-type": "text/html; charset=utf-8" }
const text = { "content-type": "text/plain; charset=utf-8" }
const xml = { "content-type": "application/xml" }

/** The well-built example site, with overrides per URL. */
export function goodSite(overrides = {}) {
  return mockSite({
    "https://example.com/": { body: fixture("good/home.html"), headers: html },
    "https://example.com/robots.txt": { body: fixture("robots/good.txt"), headers: text },
    "https://example.com/sitemap.xml": { body: fixture("sitemap.xml"), headers: xml },
    "https://example.com/llms.txt": { body: fixture("llms-good.txt"), headers: text },
    "https://example.com/pricing": { body: fixture("good/pricing.html"), headers: html },
    "https://example.com/blog/late-payments": { body: fixture("good/blog-post.html"), headers: html },
    ...overrides
  })
}

export const HTML = html
export const TEXT = text
