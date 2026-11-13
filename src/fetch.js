// Network access, kept polite and predictable:
//   - one clear User-Agent that names the tool and links to its repo
//   - a timeout on every request, body included
//   - a byte cap on every body
//   - a request budget per check (redirect hops are followed, up to 5,
//     and not counted)
//   - extra headers (for example a preview-protection bypass) go only to the
//     origins of the site being checked, never to a redirect target elsewhere

import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))

export const VERSION = /** @type {string} */ (pkg.version)
export const REPO_URL = "https://github.com/founder-ventures/can-ai-read"
/** The token this tool obeys in robots.txt. */
export const ROBOTS_TOKEN = "can-ai-read"
export const USER_AGENT = `${ROBOTS_TOKEN}/${VERSION} (+${REPO_URL})`

const MAX_REDIRECTS = 5

/**
 * @typedef {{
 *   url: string,
 *   finalUrl: string,
 *   status: number,
 *   headers: Record<string, string>,
 *   body: string,
 *   redirects: string[],
 *   truncated: boolean,
 *   error: string | null,
 *   skipped: boolean
 * }} FetchResult
 */

/**
 * @param {string} contentType
 * @returns {string}
 */
function charsetOf(contentType) {
  const m = /charset=["']?([\w-]+)/i.exec(contentType || "")
  return m ? m[1].toLowerCase() : "utf-8"
}

/**
 * @param {Uint8Array} bytes
 * @param {string} charset
 */
function decode(bytes, charset) {
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder("utf-8").decode(bytes)
  }
}

/** @param {unknown} err */
function describeError(err) {
  if (!(err instanceof Error)) return String(err)
  if (err.name === "AbortError" || err.name === "TimeoutError") return "timed out"
  const cause = /** @type {{ code?: string, message?: string } | undefined} */ (/** @type {any} */ (err).cause)
  if (cause?.code === "ENOTFOUND") return "domain not found (DNS)"
  if (cause?.code === "ECONNREFUSED") return "connection refused"
  if (cause?.code === "ECONNRESET") return "connection reset"
  if (cause?.code && /CERT|SSL|TLS/i.test(cause.code)) return `TLS error (${cause.code})`
  if (cause?.code) return `${err.message} (${cause.code})`
  return err.message
}

export class Fetcher {
  /**
   * @param {{
   *   fetch?: typeof globalThis.fetch,
   *   timeoutMs?: number,
   *   maxRequests?: number,
   *   headers?: Record<string, string>,
   *   userAgent?: string
   * }} [options]
   */
  constructor(options = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch
    if (typeof this.fetchImpl !== "function") {
      throw new Error("No fetch available. can-ai-read needs Node 18 or newer.")
    }
    this.timeoutMs = options.timeoutMs ?? 10000
    this.maxRequests = options.maxRequests ?? 10
    this.extraHeaders = options.headers ?? {}
    this.userAgent = options.userAgent ?? USER_AGENT
    /** Origins that may receive the extra headers. */
    this.headerOrigins = new Set()
    this.used = 0
  }

  /** @param {string} origin */
  trustOrigin(origin) {
    this.headerOrigins.add(origin)
  }

  get remaining() {
    return Math.max(0, this.maxRequests - this.used)
  }

  /**
   * GET a URL, following redirects by hand.
   * @param {string} url
   * @param {{ accept?: string, maxBytes?: number }} [opts]
   * @returns {Promise<FetchResult>}
   */
  async get(url, opts = {}) {
    /** @type {FetchResult} */
    const result = {
      url,
      finalUrl: url,
      status: 0,
      headers: {},
      body: "",
      redirects: [],
      truncated: false,
      error: null,
      skipped: false
    }
    if (this.used >= this.maxRequests) {
      result.skipped = true
      result.error = "request budget used up"
      return result
    }
    this.used++
    const maxBytes = opts.maxBytes ?? 3 * 1024 * 1024
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      let current = url
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const target = new URL(current)
        if (target.protocol !== "http:" && target.protocol !== "https:") {
          result.error = `unsupported protocol ${target.protocol}`
          return result
        }
        /** @type {Record<string, string>} */
        const headers = {
          "user-agent": this.userAgent,
          accept: opts.accept ?? "*/*",
          "accept-language": "en;q=0.9, *;q=0.5"
        }
        if (this.headerOrigins.has(target.origin)) Object.assign(headers, this.extraHeaders)
        const res = await this.fetchImpl(current, {
          method: "GET",
          headers,
          redirect: "manual",
          signal: controller.signal
        })
        result.status = res.status
        result.finalUrl = current
        /** @type {Record<string, string>} */
        const flat = {}
        res.headers.forEach((value, key) => {
          flat[key.toLowerCase()] = value
        })
        result.headers = flat
        const location = res.headers.get("location")
        if (res.status >= 300 && res.status < 400 && location) {
          await res.body?.cancel().catch(() => {})
          if (hop === MAX_REDIRECTS) {
            result.error = "too many redirects"
            return result
          }
          result.redirects.push(current)
          current = new URL(location, current).href
          continue
        }
        const { bytes, truncated } = await readCapped(res, maxBytes)
        result.truncated = truncated
        let data = bytes
        if (data.length > 2 && data[0] === 0x1f && data[1] === 0x8b) {
          try {
            data = gunzipSync(data, { maxOutputLength: maxBytes * 4 })
          } catch {
            // Leave as is. The caller will see unreadable text.
          }
        }
        result.body = decode(data, charsetOf(flat["content-type"]))
        return result
      }
      return result
    } catch (err) {
      result.error = describeError(err)
      return result
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Read a response body, stopping at maxBytes.
 * @param {Response} res
 * @param {number} maxBytes
 */
async function readCapped(res, maxBytes) {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer())
    return { bytes: buf.slice(0, maxBytes), truncated: buf.length > maxBytes }
  }
  const reader = res.body.getReader()
  /** @type {Uint8Array[]} */
  const chunks = []
  let total = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (total + value.length > maxBytes) {
      chunks.push(value.slice(0, maxBytes - total))
      total = maxBytes
      truncated = true
      await reader.cancel().catch(() => {})
      break
    }
    chunks.push(value)
    total += value.length
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return { bytes: out, truncated }
}
