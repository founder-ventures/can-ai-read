// Command-line interface. Exit codes:
//   0  no errors (and, with --baseline, no regressions)
//   1  errors found, score below --fail-under, or regressions with --baseline
//   2  could not run: bad arguments or the site did not respond

import { check, compare } from "./index.js"
import { VERSION } from "./fetch.js"
import { formatComparisonText, formatMarkdown, formatText } from "./report.js"
import { InputError, UnreachableError } from "./scan.js"

export const HELP = `can-ai-read ${VERSION}
Check whether AI search engines can read a site: AI crawler rules in
robots.txt, text without JavaScript, noindex, JSON-LD, llms.txt and more.

Usage
  npx can-ai-read <url> [options]

Options
  --baseline <url>   Compare with this URL (for example production) and
                     fail only on what got worse
  --pages <n>        Extra pages to check besides <url> (default 2, or 1
                     with --baseline, max 8)
  --paths <list>     Comma-separated paths to check instead of discovering
                     them, for example /pricing,/blog/launch
  --fail-under <n>   Exit 1 when the score is below n
  --header <h>       Request header for your site, "Name: value". Repeat
                     for more. Use it for preview protection bypass tokens.
  --preview          Do not count X-Robots-Tag: noindex headers (automatic
                     on *.vercel.app, *.netlify.app and *.pages.dev)
  --json             Print the full report as JSON
  --markdown         Print the report as Markdown
  --timeout <ms>     Timeout per request (default 10000)
  --verbose, -v      Show details for passing checks too
  --no-color         Plain output
  --help, -h         Show this help
  --version          Show the version

Exit codes
  0  no errors (with --baseline: no regressions)
  1  errors, score below --fail-under, or regressions
  2  could not run (bad arguments, site did not respond)

Docs: https://github.com/founder-ventures/can-ai-read`

/**
 * @typedef {{
 *   url: string | null,
 *   baseline: string | null,
 *   pages: number | undefined,
 *   paths: string[] | undefined,
 *   failUnder: number | null,
 *   headers: Record<string, string>,
 *   preview: boolean | "auto",
 *   json: boolean,
 *   markdown: boolean,
 *   timeoutMs: number,
 *   verbose: boolean,
 *   color: boolean | null,
 *   help: boolean,
 *   version: boolean
 * }} CliArgs
 */

export class UsageError extends Error {}

/**
 * Parse "Name: value" into a header pair.
 * @param {string} raw
 * @returns {[string, string]}
 */
export function parseHeader(raw) {
  const i = raw.indexOf(":")
  if (i <= 0) throw new UsageError(`--header needs "Name: value", got "${raw}"`)
  const name = raw.slice(0, i).trim()
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new UsageError(`Invalid header name "${name}"`)
  return [name.toLowerCase(), raw.slice(i + 1).trim()]
}

/**
 * @param {string[]} argv arguments after the program name
 * @returns {CliArgs}
 */
export function parseArgs(argv) {
  /** @type {CliArgs} */
  const args = {
    url: null,
    baseline: null,
    pages: undefined,
    paths: undefined,
    failUnder: null,
    headers: {},
    preview: "auto",
    json: false,
    markdown: false,
    timeoutMs: 10000,
    verbose: false,
    color: null,
    help: false,
    version: false
  }
  const rest = [...argv]
  /** @param {string} flag */
  const value = flag => {
    const v = rest.shift()
    if (v === undefined || (v.startsWith("--") && v.length > 2)) throw new UsageError(`${flag} needs a value`)
    return v
  }
  /** @param {string} flag @param {string} v @param {number} min @param {number} max */
  const int = (flag, v, min, max) => {
    const n = Number(v)
    if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`${flag} must be a whole number from ${min} to ${max}`)
    return n
  }
  while (rest.length) {
    let arg = /** @type {string} */ (rest.shift())
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1
    if (eq > 0) {
      rest.unshift(arg.slice(eq + 1))
      arg = arg.slice(0, eq)
    }
    switch (arg) {
      case "--baseline":
        args.baseline = value(arg)
        break
      case "--pages":
        args.pages = int(arg, value(arg), 0, 8)
        break
      case "--paths":
        args.paths = value(arg)
          .split(",")
          .map(p => p.trim())
          .filter(Boolean)
        if (args.paths.length > 8) throw new UsageError("--paths takes at most 8 paths")
        break
      case "--fail-under":
        args.failUnder = int(arg, value(arg), 0, 100)
        break
      case "--header": {
        const [k, v] = parseHeader(value(arg))
        args.headers[k] = v
        break
      }
      case "--preview":
        args.preview = true
        break
      case "--json":
        args.json = true
        break
      case "--markdown":
        args.markdown = true
        break
      case "--timeout":
        args.timeoutMs = int(arg, value(arg), 1000, 120000)
        break
      case "--verbose":
      case "-v":
        args.verbose = true
        break
      case "--no-color":
        args.color = false
        break
      case "--color":
        args.color = true
        break
      case "--help":
      case "-h":
        args.help = true
        break
      case "--version":
        args.version = true
        break
      default:
        if (arg.startsWith("-")) throw new UsageError(`Unknown option ${arg}. Run can-ai-read --help.`)
        if (args.url) throw new UsageError(`Only one URL, got "${args.url}" and "${arg}". Use --baseline to compare two.`)
        args.url = arg
    }
  }
  if (args.json && args.markdown) throw new UsageError("Choose --json or --markdown, not both")
  return args
}

/**
 * Run the CLI.
 * @param {string[]} argv
 * @param {{
 *   stdout?: { write(s: string): unknown, isTTY?: boolean },
 *   stderr?: { write(s: string): unknown },
 *   env?: Record<string, string | undefined>,
 *   fetch?: typeof globalThis.fetch
 * }} [io]
 * @returns {Promise<number>} exit code
 */
export async function main(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout
  const stderr = io.stderr ?? process.stderr
  const env = io.env ?? process.env
  /** @type {CliArgs} */
  let args
  try {
    args = parseArgs(argv)
  } catch (err) {
    stderr.write(`can-ai-read: ${err instanceof Error ? err.message : String(err)}\n`)
    return 2
  }
  if (args.help) {
    stdout.write(`${HELP}\n`)
    return 0
  }
  if (args.version) {
    stdout.write(`${VERSION}\n`)
    return 0
  }
  if (!args.url) {
    stderr.write(`can-ai-read: give a URL, for example: npx can-ai-read https://example.com\n\n${HELP}\n`)
    return 2
  }
  const color =
    args.color ?? (!("NO_COLOR" in env) && (env.FORCE_COLOR ? env.FORCE_COLOR !== "0" : !!stdout.isTTY))
  const options = {
    pages: args.pages,
    paths: args.paths,
    timeoutMs: args.timeoutMs,
    headers: args.headers,
    preview: args.preview,
    fetch: io.fetch
  }
  try {
    if (args.baseline) {
      const cmp = await compare(args.url, args.baseline, options)
      if (args.json) stdout.write(`${JSON.stringify(cmp, null, 2)}\n`)
      else if (args.markdown) stdout.write(`${formatMarkdown(cmp, { ref: "can-ai-read-cli", marker: false })}\n`)
      else stdout.write(`${formatComparisonText(cmp, { color, verbose: args.verbose })}\n`)
      const below = args.failUnder !== null && cmp.target.score < args.failUnder
      return cmp.regressions.length || below ? 1 : 0
    }
    const report = await check(args.url, options)
    if (args.json) stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    else if (args.markdown) stdout.write(`${formatMarkdown(report, { ref: "can-ai-read-cli", marker: false })}\n`)
    else stdout.write(`${formatText(report, { color, verbose: args.verbose })}\n`)
    const below = args.failUnder !== null && report.score < args.failUnder
    return report.errors || below ? 1 : 0
  } catch (err) {
    if (err instanceof UnreachableError || err instanceof InputError) {
      stderr.write(`can-ai-read: ${err.message}\n`)
      return 2
    }
    throw err
  }
}
