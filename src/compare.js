// Compare two reports, for example a preview deployment against production,
// and list what got worse. CI can then fail on regressions only, so a site
// with old problems can still adopt the check without fixing everything first.

/**
 * @typedef {import("./checks.js").Report} Report
 * @typedef {{ id: string, title: string, before: number, after: number, maxPoints: number, summary: string }} CheckChange
 * @typedef {{ token: string, before: string, after: string }} CrawlerChange
 * @typedef {{
 *   target: Report,
 *   baseline: Report,
 *   scoreDelta: number,
 *   regressions: CheckChange[],
 *   improvements: CheckChange[],
 *   crawlerChanges: CrawlerChange[]
 * }} Comparison
 */

/**
 * @param {Report} baseline the reference, usually production
 * @param {Report} target the change under test, usually a preview
 * @returns {Comparison}
 */
export function diffReports(baseline, target) {
  /** @type {CheckChange[]} */
  const regressions = []
  /** @type {CheckChange[]} */
  const improvements = []
  for (const after of target.checks) {
    const before = baseline.checks.find(c => c.id === after.id)
    if (!before) continue
    const change = {
      id: after.id,
      title: after.title,
      before: before.points,
      after: after.points,
      maxPoints: after.maxPoints,
      summary: after.summary
    }
    if (after.points < before.points) regressions.push(change)
    else if (after.points > before.points) improvements.push(change)
    else if (after.severity === "error" && before.severity !== "error") regressions.push(change)
  }
  /** @type {CrawlerChange[]} */
  const crawlerChanges = []
  for (const after of target.crawlers) {
    const before = baseline.crawlers.find(c => c.token === after.token)
    if (before && before.state !== after.state) {
      crawlerChanges.push({ token: after.token, before: before.state, after: after.state })
    }
  }
  return {
    target,
    baseline,
    scoreDelta: target.score - baseline.score,
    regressions,
    improvements,
    crawlerChanges
  }
}
