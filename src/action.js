// GitHub Action entry logic. It needs no dependencies and no build step: the
// runner executes this file directly with its bundled Node.

import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { check, compare } from "./index.js"
import { USER_AGENT } from "./fetch.js"
import { COMMENT_MARKER, formatComparisonText, formatMarkdown, formatText } from "./report.js"
import { parseHeader } from "./cli.js"

/**
 * Escape a value for a workflow command (::error::...).
 * @param {string} s
 * @param {boolean} [property]
 */
export function escapeCommand(s, property = false) {
  let out = String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")
  if (property) out = out.replace(/:/g, "%3A").replace(/,/g, "%2C")
  return out
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} name
 */
export function getInput(env, name) {
  return (env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] || "").trim()
}

/**
 * @param {string} file
 * @param {Record<string, string | number>} values
 */
function writeOutputs(file, values) {
  const lines = Object.entries(values).map(([k, v]) => `${k}=${String(v).replace(/\r?\n/g, " ")}`)
  appendFileSync(file, `${lines.join("\n")}\n`)
}

/**
 * Create or update the one can-ai-read comment on the pull request.
 * @param {{
 *   env: Record<string, string | undefined>,
 *   fetch: typeof globalThis.fetch,
 *   token: string,
 *   body: string,
 *   log: (s: string) => void,
 *   readFile: (path: string) => string
 * }} ctx
 */
export async function upsertComment({ env, fetch, token, body, log, readFile }) {
  const repo = env.GITHUB_REPOSITORY
  const api = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "")
  if (!repo || !token) {
    log("::warning::can-ai-read: no repository or token, so no pull request comment was posted.")
    return
  }
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": USER_AGENT,
    "content-type": "application/json"
  }
  /** @type {any} */
  let event = {}
  try {
    if (env.GITHUB_EVENT_PATH) event = JSON.parse(readFile(env.GITHUB_EVENT_PATH))
  } catch {
    event = {}
  }
  let number = event.pull_request?.number ?? (event.issue?.pull_request ? event.issue.number : undefined)
  if (!number) {
    const sha = event.deployment?.sha || env.GITHUB_SHA
    if (sha) {
      const res = await fetch(`${api}/repos/${repo}/commits/${sha}/pulls`, { headers })
      if (res.ok) {
        const pulls = /** @type {any[]} */ (await res.json())
        number = (pulls.find(p => p.state === "open") ?? pulls[0])?.number
      }
    }
  }
  if (!number) {
    log("::notice::can-ai-read: no pull request found for this run, so no comment was posted.")
    return
  }
  /** @type {number | null} */
  let existing = null
  for (let page = 1; page <= 5 && existing === null; page++) {
    const res = await fetch(`${api}/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`, { headers })
    if (!res.ok) throw new Error(`listing comments failed with HTTP ${res.status}`)
    const comments = /** @type {any[]} */ (await res.json())
    const mine = comments.find(c => typeof c.body === "string" && c.body.includes(COMMENT_MARKER))
    if (mine) existing = mine.id
    if (comments.length < 100) break
  }
  const res = existing
    ? await fetch(`${api}/repos/${repo}/issues/comments/${existing}`, { method: "PATCH", headers, body: JSON.stringify({ body }) })
    : await fetch(`${api}/repos/${repo}/issues/${number}/comments`, { method: "POST", headers, body: JSON.stringify({ body }) })
  if (!res.ok) throw new Error(`${existing ? "updating" : "posting"} the comment failed with HTTP ${res.status}`)
  log(`can-ai-read: ${existing ? "updated" : "posted"} the comment on pull request #${number}.`)
}

/**
 * Run the action.
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   fetch?: typeof globalThis.fetch,
 *   log?: (s: string) => void,
 *   readFile?: (path: string) => string
 * }} [ctx]
 * @returns {Promise<number>} exit code
 */
export async function runAction(ctx = {}) {
  const env = ctx.env ?? process.env
  const fetchImpl = ctx.fetch ?? globalThis.fetch
  const log = ctx.log ?? (s => process.stdout.write(`${s}\n`))
  const readFile = ctx.readFile ?? (p => readFileSync(p, "utf8"))

  const url = getInput(env, "url")
  if (!url) {
    log("::error::can-ai-read: the url input is required.")
    return 1
  }
  const baseline = getInput(env, "baseline")
  const pagesRaw = getInput(env, "pages")
  const pathsRaw = getInput(env, "paths")
  const failUnderRaw = getInput(env, "fail-under")
  const previewRaw = getInput(env, "preview").toLowerCase()
  const commentWanted = getInput(env, "comment").toLowerCase() === "true"
  const failWanted = getInput(env, "fail").toLowerCase() !== "false"
  const token = getInput(env, "github-token")

  /** @type {Record<string, string>} */
  const headers = {}
  try {
    for (const line of getInput(env, "headers").split(/\r?\n/)) {
      if (!line.trim()) continue
      const [k, v] = parseHeader(line.trim())
      headers[k] = v
      if (v) log(`::add-mask::${v}`)
    }
  } catch (err) {
    log(`::error::can-ai-read: ${escapeCommand(err instanceof Error ? err.message : String(err))}`)
    return 1
  }
  const pages = pagesRaw ? Number(pagesRaw) : undefined
  if (pages !== undefined && (!Number.isInteger(pages) || pages < 0 || pages > 8)) {
    log("::error::can-ai-read: pages must be a whole number from 0 to 8.")
    return 1
  }
  const failUnder = failUnderRaw ? Number(failUnderRaw) : null
  if (failUnder !== null && (!Number.isFinite(failUnder) || failUnder < 0 || failUnder > 100)) {
    log("::error::can-ai-read: fail-under must be a number from 0 to 100.")
    return 1
  }
  const options = {
    pages,
    paths: pathsRaw ? pathsRaw.split(",").map(p => p.trim()).filter(Boolean).slice(0, 8) : undefined,
    headers,
    preview: /** @type {boolean | "auto"} */ (previewRaw === "true" ? true : previewRaw === "false" ? false : "auto"),
    fetch: ctx.fetch
  }

  /** @type {import("./checks.js").Report} */
  let report
  /** @type {import("./compare.js").Comparison | null} */
  let cmp = null
  try {
    if (baseline) {
      cmp = await compare(url, baseline, options)
      report = cmp.target
      log(formatComparisonText(cmp, { color: true, ref: "can-ai-read-action" }))
    } else {
      report = await check(url, options)
      log(formatText(report, { color: true, ref: "can-ai-read-action" }))
    }
  } catch (err) {
    log(`::error::can-ai-read: ${escapeCommand(err instanceof Error ? err.message : String(err))}`)
    return 1
  }

  const reportPath = join(env.RUNNER_TEMP || tmpdir(), "can-ai-read-report.json")
  writeFileSync(reportPath, JSON.stringify(cmp ?? report, null, 2))

  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${formatMarkdown(cmp ?? report, { ref: "can-ai-read-action", marker: false })}\n`)
  }

  for (const c of report.checks) {
    if (!c.severity) continue
    if (cmp && !cmp.regressions.some(r => r.id === c.id)) continue
    const level = c.severity === "error" || cmp ? "error" : "warning"
    log(`::${level} title=${escapeCommand(`can-ai-read: ${c.title}`, true)}::${escapeCommand(c.summary)}`)
  }

  if (env.GITHUB_OUTPUT) {
    writeOutputs(env.GITHUB_OUTPUT, {
      score: report.score,
      errors: report.errors,
      warnings: report.warnings,
      "baseline-score": cmp ? cmp.baseline.score : "",
      regressions: cmp ? cmp.regressions.length : 0,
      "report-path": reportPath
    })
  }

  if (commentWanted) {
    try {
      await upsertComment({
        env,
        fetch: fetchImpl,
        token,
        body: formatMarkdown(cmp ?? report, { ref: "can-ai-read-pr" }),
        log,
        readFile
      })
    } catch (err) {
      log(`::warning::can-ai-read: could not comment on the pull request (${escapeCommand(err instanceof Error ? err.message : String(err))}). Give the job "pull-requests: write" permission.`)
    }
  }

  const below = failUnder !== null && report.score < failUnder
  const failed = cmp ? cmp.regressions.length > 0 || below : report.errors > 0 || below
  if (failed && below) log(`::error::can-ai-read: score ${report.score} is below fail-under ${failUnder}.`)
  return failed && failWanted ? 1 : 0
}
