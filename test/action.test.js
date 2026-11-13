import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TEXT, fixture, goodSite } from "./site.js"
import { escapeCommand, runAction } from "../src/action.js"
import { COMMENT_MARKER } from "../src/report.js"

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "can-ai-read-test-"))
  const summary = join(dir, "summary.md")
  const output = join(dir, "output.txt")
  writeFileSync(summary, "")
  writeFileSync(output, "")
  return { dir, summary, output }
}

/** @param {string} file */
function outputs(file) {
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])
  )
}

/**
 * A fake GitHub API on top of a fake site.
 * @param {typeof globalThis.fetch} siteFetch
 * @param {{ existing?: boolean }} [opts]
 */
function withGitHub(siteFetch, opts = {}) {
  /** @type {{ method: string, url: string, body?: any, auth?: string }[]} */
  const api = []
  /** @type {typeof globalThis.fetch} */
  const fetch = async (input, init = {}) => {
    const url = String(input)
    if (!url.startsWith("https://api.github.com/")) return siteFetch(input, init)
    const headers = /** @type {Record<string, string>} */ (init.headers || {})
    api.push({ method: init.method || "GET", url, body: init.body ? JSON.parse(String(init.body)) : undefined, auth: headers.authorization })
    if (url.includes("/commits/abc123/pulls")) return Response.json([{ number: 7, state: "open" }])
    if (url.includes("/issues/7/comments?")) {
      return Response.json(opts.existing ? [{ id: 1, body: "unrelated" }, { id: 99, body: `${COMMENT_MARKER}\nold` }] : [{ id: 1, body: "unrelated" }])
    }
    if (url.endsWith("/issues/comments/99") && init.method === "PATCH") return Response.json({ id: 99 })
    if (url.endsWith("/issues/7/comments") && init.method === "POST") return Response.json({ id: 100 }, { status: 201 })
    return new Response("not found", { status: 404 })
  }
  return { fetch, api }
}

test("writes a job summary and outputs, and passes on a good site", async () => {
  const ws = workspace()
  const logs = []
  const code = await runAction({
    env: { "INPUT_URL": "https://example.com", "INPUT_FAIL": "true", GITHUB_STEP_SUMMARY: ws.summary, GITHUB_OUTPUT: ws.output, RUNNER_TEMP: ws.dir },
    fetch: goodSite().fetch,
    log: s => logs.push(s)
  })
  assert.equal(code, 0)
  const summary = readFileSync(ws.summary, "utf8")
  assert.match(summary, /## can-ai-read: 100\/100/)
  assert.match(summary, /ref=can-ai-read-action/)
  assert.ok(!summary.includes(COMMENT_MARKER))
  const out = outputs(ws.output)
  assert.equal(out.score, "100")
  assert.equal(out.errors, "0")
  assert.equal(out.regressions, "0")
  const report = JSON.parse(readFileSync(out["report-path"], "utf8"))
  assert.equal(report.score, 100)
})

test("fails the step and annotates errors", async () => {
  const ws = workspace()
  const logs = []
  const site = goodSite({ "https://example.com/robots.txt": { body: fixture("robots/ai-blocked.txt"), headers: TEXT } })
  const code = await runAction({
    env: { INPUT_URL: "https://example.com", GITHUB_STEP_SUMMARY: ws.summary, GITHUB_OUTPUT: ws.output, RUNNER_TEMP: ws.dir },
    fetch: site.fetch,
    log: s => logs.push(s)
  })
  assert.equal(code, 1)
  assert.ok(logs.some(l => l.startsWith("::error title=can-ai-read%3A Search and answer crawlers::")))
  assert.ok(logs.some(l => l.startsWith("::warning title=can-ai-read%3A Training crawlers::")))
})

test("fail: false reports without failing", async () => {
  const ws = workspace()
  const site = goodSite({ "https://example.com/robots.txt": { body: fixture("robots/ai-blocked.txt"), headers: TEXT } })
  const code = await runAction({
    env: { INPUT_URL: "https://example.com", INPUT_FAIL: "false", GITHUB_OUTPUT: ws.output, RUNNER_TEMP: ws.dir },
    fetch: site.fetch,
    log: () => {}
  })
  assert.equal(code, 0)
})

test("masks header values and sends them to the site", async () => {
  const ws = workspace()
  const logs = []
  const site = goodSite()
  await runAction({
    env: { INPUT_URL: "https://example.com", INPUT_HEADERS: "x-vercel-protection-bypass: s3cret\n", INPUT_PAGES: "0", RUNNER_TEMP: ws.dir },
    fetch: site.fetch,
    log: s => logs.push(s)
  })
  assert.ok(logs.includes("::add-mask::s3cret"))
  assert.equal(site.calls[0].headers["x-vercel-protection-bypass"], "s3cret")
})

test("rejects bad inputs", async () => {
  const logs = []
  assert.equal(await runAction({ env: {}, log: s => logs.push(s) }), 1)
  assert.match(logs[0], /url input is required/)
  assert.equal(await runAction({ env: { INPUT_URL: "https://example.com", INPUT_PAGES: "20" }, log: s => logs.push(s) }), 1)
})

test("posts a new pull request comment, finding the PR from a deployment event", async () => {
  const ws = workspace()
  const eventPath = join(ws.dir, "event.json")
  writeFileSync(eventPath, JSON.stringify({ deployment: { sha: "abc123" }, deployment_status: { environment_url: "https://example.com" } }))
  const gh = withGitHub(goodSite().fetch)
  const code = await runAction({
    env: {
      INPUT_URL: "https://example.com",
      INPUT_COMMENT: "true",
      "INPUT_GITHUB-TOKEN": "ghs_test",
      GITHUB_REPOSITORY: "acme/site",
      GITHUB_EVENT_PATH: eventPath,
      RUNNER_TEMP: ws.dir
    },
    fetch: gh.fetch,
    log: () => {}
  })
  assert.equal(code, 0)
  const post = gh.api.find(c => c.method === "POST")
  assert.ok(post)
  assert.equal(post.url, "https://api.github.com/repos/acme/site/issues/7/comments")
  assert.equal(post.auth, "Bearer ghs_test")
  assert.ok(post.body.body.startsWith(COMMENT_MARKER))
  assert.match(post.body.body, /ref=can-ai-read-pr/)
})

test("updates its own comment instead of adding another", async () => {
  const ws = workspace()
  const eventPath = join(ws.dir, "event.json")
  writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 7 } }))
  const gh = withGitHub(goodSite().fetch, { existing: true })
  await runAction({
    env: { INPUT_URL: "https://example.com", INPUT_COMMENT: "true", "INPUT_GITHUB-TOKEN": "t", GITHUB_REPOSITORY: "acme/site", GITHUB_EVENT_PATH: eventPath, RUNNER_TEMP: ws.dir },
    fetch: gh.fetch,
    log: () => {}
  })
  assert.ok(gh.api.some(c => c.method === "PATCH" && c.url.endsWith("/issues/comments/99")))
  assert.ok(!gh.api.some(c => c.method === "POST"))
})

test("a failed comment is a warning and never fails the step", async () => {
  const ws = workspace()
  const eventPath = join(ws.dir, "event.json")
  writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 8 } }))
  const logs = []
  const gh = withGitHub(goodSite().fetch)
  const code = await runAction({
    env: { INPUT_URL: "https://example.com", INPUT_COMMENT: "true", "INPUT_GITHUB-TOKEN": "t", GITHUB_REPOSITORY: "acme/site", GITHUB_EVENT_PATH: eventPath, RUNNER_TEMP: ws.dir },
    fetch: gh.fetch,
    log: s => logs.push(s)
  })
  assert.equal(code, 0)
  assert.ok(logs.some(l => l.startsWith("::warning::can-ai-read: could not comment")))
})

test("with a baseline, only regressions fail the step", async () => {
  const ws = workspace()
  const prod = goodSite()
  const preview = "https://acme-git-pr-1.vercel.app"
  /** @type {typeof globalThis.fetch} */
  const fetch = (url, init) => {
    const u = String(url)
    if (!u.startsWith(preview)) return prod.fetch(url, init)
    if (u === `${preview}/robots.txt`) return Promise.resolve(new Response("User-agent: OAI-SearchBot\nDisallow: /\n\nSitemap: https://example.com/sitemap.xml\n", { headers: TEXT }))
    return prod.fetch(u.replace(preview, "https://example.com"), init)
  }
  const logs = []
  const code = await runAction({
    env: { INPUT_URL: preview, INPUT_BASELINE: "https://example.com", GITHUB_OUTPUT: ws.output, GITHUB_STEP_SUMMARY: ws.summary, RUNNER_TEMP: ws.dir },
    fetch,
    log: s => logs.push(s)
  })
  assert.equal(code, 1)
  const out = outputs(ws.output)
  assert.equal(out.regressions, "1")
  assert.equal(out["baseline-score"], "100")
  assert.match(readFileSync(ws.summary, "utf8"), /### 1 regression/)
  assert.ok(logs.some(l => l.startsWith("::error title=can-ai-read%3A Search and answer crawlers")))
})

test("escapes workflow command values", () => {
  assert.equal(escapeCommand("50% done\nnext"), "50%25 done%0Anext")
  assert.equal(escapeCommand("a: b, c", true), "a%3A b%2C c")
})
