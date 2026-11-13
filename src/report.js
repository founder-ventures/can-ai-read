// Render reports for a terminal, or as Markdown for GitHub job summaries and
// pull request comments.

import { REPO_URL } from "./fetch.js"
import { isPreviewHost } from "./scan.js"

/**
 * @typedef {import("./checks.js").Report} Report
 * @typedef {import("./checks.js").Check} Check
 * @typedef {import("./compare.js").Comparison} Comparison
 */

export const COMMENT_MARKER = "<!-- can-ai-read -->"

const ICONS = { pass: "✓", warn: "!", fail: "✗", info: "·", skip: "-" }

/**
 * The free Rankwise audit for this site, tagged with where the link was seen.
 * Local, preview and IP hosts get the plain homepage link.
 * @param {string} url
 * @param {string} ref
 */
export function rankwiseLink(url, ref) {
  let host = ""
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    // fall through to the generic link
  }
  const bare = host.replace(/^www\./, "")
  const generic =
    !bare ||
    !bare.includes(".") ||
    bare === "localhost" ||
    /^[\d.]+$/.test(bare) ||
    bare.includes(":") ||
    /\.(local|test|internal|localhost|example)$/.test(bare) ||
    isPreviewHost(bare)
  const tag = encodeURIComponent(ref)
  return generic ? `https://tryrankwise.com/?ref=${tag}` : `https://tryrankwise.com/report/${encodeURIComponent(bare)}?ref=${tag}`
}

/** @param {string} url @param {string} ref */
export function footerText(url, ref) {
  return `This report covers readiness. To see whether AI answers name you, run the free Rankwise audit: ${rankwiseLink(url, ref)}`
}

/** @param {boolean} on */
function painter(on) {
  /** @param {number} code @param {string} s */
  const p = (code, s) => (on ? `\x1b[${code}m${s}\x1b[0m` : s)
  return {
    bold: (/** @type {string} */ s) => p(1, s),
    dim: (/** @type {string} */ s) => p(2, s),
    red: (/** @type {string} */ s) => p(31, s),
    green: (/** @type {string} */ s) => p(32, s),
    yellow: (/** @type {string} */ s) => p(33, s),
    gray: (/** @type {string} */ s) => p(90, s)
  }
}

/** @param {Check} check */
function pointsLabel(check) {
  return check.maxPoints === 0 ? "info" : `${check.points}/${check.maxPoints}`
}

/** @param {string} left @param {string} right @param {number} width */
function leader(left, right, width) {
  const gap = Math.max(2, width - left.length - right.length - 2)
  return { pad: ` ${".".repeat(gap)} `, left, right }
}

/** @param {number} ms */
function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Checks that lost points, biggest loss first.
 * @param {Check[]} checks
 */
export function fixesFirst(checks) {
  return checks
    .filter(c => c.fix && (c.status === "fail" || c.status === "warn"))
    .sort((a, b) => {
      const sev = (/** @type {Check} */ c) => (c.severity === "error" ? 0 : 1)
      return sev(a) - sev(b) || b.maxPoints - b.points - (a.maxPoints - a.points)
    })
}

/**
 * @param {Report} report
 * @param {{ color?: boolean, verbose?: boolean, ref?: string, footer?: boolean }} [options]
 */
export function formatText(report, options = {}) {
  const c = painter(!!options.color)
  const width = 64
  const out = []
  out.push(`${c.bold("can-ai-read")} ${c.dim(report.tool.version)}  ${report.finalUrl}`)
  out.push(
    c.dim(
      `${report.pages.length === 1 ? "1 page" : `${report.pages.length} pages`}, ${report.requests.used} requests, ${seconds(report.durationMs)}${report.preview ? ", preview deployment" : ""}`
    )
  )
  out.push("")
  const scoreColor = report.score >= 80 ? c.green : report.score >= 50 ? c.yellow : c.red
  const counts = [
    report.errors ? c.red(`${report.errors} ${report.errors === 1 ? "error" : "errors"}`) : "0 errors",
    report.warnings ? c.yellow(`${report.warnings} ${report.warnings === 1 ? "warning" : "warnings"}`) : "0 warnings"
  ]
  out.push(`${c.bold(`Score ${scoreColor(`${report.score}/100`)}`)}   ${counts.join(", ")}`)

  for (const cat of report.categories) {
    out.push("")
    const right = `${cat.points}/${cat.maxPoints}`
    const l = leader(cat.title, right, width)
    out.push(`${c.bold(l.left)}${c.dim(l.pad)}${c.bold(right)}`)
    for (const check of report.checks.filter(k => k.category === cat.id)) {
      const icon = ICONS[check.status]
      const color =
        check.status === "pass" ? c.green : check.status === "fail" ? c.red : check.status === "warn" ? c.yellow : c.gray
      const right2 = pointsLabel(check)
      const l2 = leader(`  ${icon} ${check.title}`, right2, width)
      out.push(`  ${color(icon)} ${check.title}${c.dim(l2.pad)}${right2}`)
      if (check.summary) out.push(`    ${check.status === "pass" ? c.dim(check.summary) : check.summary}`)
      const showDetails = options.verbose || (check.status !== "pass" && check.status !== "skip")
      if (showDetails) {
        const max = options.verbose ? Infinity : 8
        for (const d of check.details.slice(0, max)) out.push(c.dim(`    - ${d}`))
        if (check.details.length > max) out.push(c.dim(`    - and ${check.details.length - max} more (use --verbose)`))
      }
    }
  }

  const fixes = fixesFirst(report.checks)
  if (fixes.length) {
    out.push("")
    out.push(c.bold("Fix first"))
    fixes.slice(0, 6).forEach((check, i) => {
      const gain = check.maxPoints - check.points
      const head = `${i + 1}. ${check.title}${gain ? ` (+${gain})` : ""}: `
      const [first, ...rest] = String(check.fix).split("\n")
      out.push(`  ${head}${first}`)
      for (const line of rest) out.push(`     ${line}`)
    })
  }
  if (options.footer !== false) {
    out.push("")
    out.push(c.dim(footerText(report.finalUrl, options.ref ?? "can-ai-read-cli")))
  }
  return out.join("\n")
}

/**
 * @param {Comparison} cmp
 * @param {{ color?: boolean, verbose?: boolean, ref?: string }} [options]
 */
export function formatComparisonText(cmp, options = {}) {
  const c = painter(!!options.color)
  const out = []
  const { target, baseline } = cmp
  const delta = cmp.scoreDelta === 0 ? "no change" : cmp.scoreDelta > 0 ? `+${cmp.scoreDelta}` : String(cmp.scoreDelta)
  out.push(`${c.bold("can-ai-read")} ${c.dim(target.tool.version)}`)
  out.push(`  This change  ${target.finalUrl}  ${c.bold(`${target.score}/100`)}`)
  out.push(`  Baseline     ${baseline.finalUrl}  ${baseline.score}/100`)
  out.push(c.dim(`  Same ${target.pages.length === 1 ? "page" : `${target.pages.length} pages`} on both. Score ${delta}.`))
  out.push("")
  if (!cmp.regressions.length) {
    out.push(c.green("No regressions."))
  } else {
    out.push(c.bold(c.red(`${cmp.regressions.length} ${cmp.regressions.length === 1 ? "regression" : "regressions"}`)))
    for (const r of cmp.regressions) {
      out.push(`  ${c.red("✗")} ${r.title}: ${r.before} -> ${r.after} of ${r.maxPoints}. ${r.summary}`)
      const check = target.checks.find(k => k.id === r.id)
      for (const d of (check?.details ?? []).slice(0, 4)) out.push(c.dim(`    - ${d}`))
      if (check?.fix) {
        const [first, ...rest] = check.fix.split("\n")
        out.push(`    Fix: ${first}`)
        for (const line of rest) out.push(`         ${line}`)
      }
    }
  }
  if (cmp.crawlerChanges.length) {
    out.push("")
    out.push(c.bold("Crawler changes"))
    for (const ch of cmp.crawlerChanges) out.push(`  ${ch.token}: ${ch.before} -> ${ch.after}`)
  }
  if (cmp.improvements.length) {
    out.push("")
    out.push(c.bold("Improvements"))
    for (const r of cmp.improvements) out.push(`  ${c.green("✓")} ${r.title}: ${r.before} -> ${r.after} of ${r.maxPoints}`)
  }
  if (options.verbose) {
    out.push("")
    out.push(formatText(target, { ...options, footer: false }))
  }
  out.push("")
  out.push(c.dim(footerText(baseline.finalUrl, options.ref ?? "can-ai-read-cli")))
  return out.join("\n")
}

/**
 * Prose for Markdown: HTML tags in the text (like <title>) become inline
 * code, so GitHub shows them instead of stripping them.
 * @param {string} s
 */
function prose(s) {
  return String(s).replace(/`?(<\/?[a-zA-Z][^<>]*>)`?/g, "`$1`")
}

/** @param {string} s */
function cell(s) {
  return prose(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

/** @param {string} fix */
function markdownFix(fix) {
  return fix
    .split("\n\n")
    .map(part => (part.startsWith("User-agent:") ? "```\n" + part + "\n```" : prose(part)))
    .join("\n\n")
}

/** @param {Report} report */
function checksTable(report) {
  const rows = ["| | Check | Points | Result |", "| --- | --- | ---: | --- |"]
  for (const check of report.checks) {
    rows.push(`| ${ICONS[check.status]} | ${cell(check.title)} | ${pointsLabel(check)} | ${cell(check.summary)} |`)
  }
  return rows.join("\n")
}

/**
 * @param {Check[]} checks
 * @param {(check: Check) => string} [head] the text after the title
 */
function problemList(checks, head) {
  const out = []
  for (const check of head ? checks : fixesFirst(checks)) {
    const icon = head || check.severity === "error" ? "✗" : "!"
    out.push(`- ${icon} **${check.title}**${head ? head(check) : ` (${pointsLabel(check)}): ${cell(check.summary)}`}`)
    for (const d of check.details.slice(0, 4)) out.push(`  - ${prose(d)}`)
    if (check.fix) {
      out.push("")
      out.push("  <details><summary>How to fix</summary>")
      out.push("")
      out.push(
        markdownFix(check.fix)
          .split("\n")
          .map(line => (line ? `  ${line}` : ""))
          .join("\n")
      )
      out.push("")
      out.push("  </details>")
      out.push("")
    }
  }
  return out.join("\n")
}

/**
 * Markdown for a job summary or PR comment.
 * @param {Report | Comparison} input
 * @param {{ ref?: string, marker?: boolean }} [options]
 */
export function formatMarkdown(input, options = {}) {
  const ref = options.ref ?? "can-ai-read-action"
  const out = []
  if (options.marker !== false) out.push(COMMENT_MARKER)
  if ("regressions" in input) {
    const { target, baseline } = input
    const delta = input.scoreDelta === 0 ? "no change" : input.scoreDelta > 0 ? `+${input.scoreDelta}` : String(input.scoreDelta)
    out.push(`## can-ai-read: ${target.score}/100 (${delta} vs baseline)`)
    out.push("")
    out.push("| | URL | Score |")
    out.push("| --- | --- | ---: |")
    out.push(`| This change | ${target.finalUrl} | ${target.score}/100 |`)
    out.push(`| Baseline | ${baseline.finalUrl} | ${baseline.score}/100 |`)
    out.push("")
    if (!input.regressions.length) {
      out.push("**No regressions.** This change does not make the site harder for AI crawlers to read.")
    } else {
      out.push(`### ${input.regressions.length} ${input.regressions.length === 1 ? "regression" : "regressions"}`)
      out.push("")
      const byId = new Map(input.regressions.map(r => [r.id, r]))
      out.push(
        problemList(
          target.checks.filter(c => byId.has(c.id)),
          c => {
            const r = byId.get(c.id)
            return r ? `: ${r.before} → ${r.after} of ${r.maxPoints}. ${cell(r.summary)}` : ""
          }
        )
      )
    }
    if (input.crawlerChanges.length) {
      out.push("")
      out.push(`Crawler changes: ${input.crawlerChanges.map(ch => `${ch.token} ${ch.before} → ${ch.after}`).join(", ")}`)
    }
    out.push("")
    out.push("<details><summary>All checks for this change</summary>")
    out.push("")
    out.push(checksTable(target))
    out.push("")
    out.push("</details>")
    out.push("")
    out.push(`<sub>${footerMarkdown(baseline.finalUrl, ref, target.tool.version)}</sub>`)
    return out.join("\n")
  }
  const report = input
  out.push(`## can-ai-read: ${report.score}/100`)
  out.push("")
  out.push(
    `${report.finalUrl} · ${report.pages.length === 1 ? "1 page" : `${report.pages.length} pages`} checked · ${report.errors} ${report.errors === 1 ? "error" : "errors"}, ${report.warnings} ${report.warnings === 1 ? "warning" : "warnings"}`
  )
  out.push("")
  out.push("| Area | Points |")
  out.push("| --- | ---: |")
  for (const cat of report.categories) out.push(`| ${cat.title} | ${cat.points}/${cat.maxPoints} |`)
  const problems = problemList(report.checks)
  if (problems) {
    out.push("")
    out.push("### What to fix")
    out.push("")
    out.push(problems)
  }
  out.push("")
  out.push("<details><summary>All checks</summary>")
  out.push("")
  out.push(checksTable(report))
  out.push("")
  out.push("</details>")
  out.push("")
  out.push(`<sub>${footerMarkdown(report.finalUrl, ref, report.tool.version)}</sub>`)
  return out.join("\n")
}

/** @param {string} url @param {string} ref @param {string} version */
function footerMarkdown(url, ref, version) {
  return `This report covers readiness. To see whether AI answers name you, run the [free Rankwise audit](${rankwiseLink(url, ref)}). Made with [can-ai-read](${REPO_URL}) ${version}.`
}
