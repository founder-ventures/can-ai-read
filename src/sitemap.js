// XML sitemap validation (https://www.sitemaps.org/protocol.html). Only the
// first file is read. Child sitemaps of an index are counted, not fetched.

/**
 * @typedef {{
 *   kind: "urlset" | "sitemapindex" | null,
 *   urls: string[],
 *   looksLikeHtml: boolean,
 *   error: string | null
 * }} SitemapResult
 */

/** @param {string} value */
function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim()
}

/**
 * @param {string} text
 * @returns {SitemapResult}
 */
export function parseSitemap(text) {
  const body = (text || "").replace(/^﻿/, "")
  const head = body.slice(0, 2000).trimStart().toLowerCase()
  const looksLikeHtml = head.startsWith("<!doctype html") || head.startsWith("<html") || /<(head|body)\b/.test(head)
  if (looksLikeHtml) {
    return { kind: null, urls: [], looksLikeHtml: true, error: "The sitemap URL returns an HTML page." }
  }
  const kind = /<(?:[\w-]+:)?sitemapindex[\s>]/i.test(body)
    ? "sitemapindex"
    : /<(?:[\w-]+:)?urlset[\s>]/i.test(body)
      ? "urlset"
      : null
  if (!kind) {
    return { kind: null, urls: [], looksLikeHtml: false, error: "No <urlset> or <sitemapindex> element found." }
  }
  const urls = []
  const re = /<(?:[\w-]+:)?loc>([\s\S]*?)<\/(?:[\w-]+:)?loc>/gi
  let m
  while ((m = re.exec(body))) {
    const url = decodeXml(m[1])
    if (url) urls.push(url)
  }
  return { kind, urls, looksLikeHtml: false, error: urls.length ? null : "The sitemap lists no URLs." }
}
