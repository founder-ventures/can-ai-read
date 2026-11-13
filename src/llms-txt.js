// llms.txt validation against the format at https://llmstxt.org:
//   1. an H1 with the site or project name (the only required part)
//   2. an optional blockquote summary
//   3. optional details, any markdown except headings
//   4. optional H2 sections holding "file lists": list items that each start
//      with a markdown link [name](url), optionally followed by ": notes"

/**
 * @typedef {{ severity: "error" | "warning" | "info", line: number | null, text: string }} LlmsIssue
 * @typedef {{
 *   valid: boolean,
 *   title: string | null,
 *   summary: string | null,
 *   sections: { title: string, links: number }[],
 *   linkCount: number,
 *   issues: LlmsIssue[]
 * }} LlmsTxtResult
 */

const LINK_ITEM = /^[-*+]\s+\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)(?:\s*:\s*.*)?$/

/**
 * @param {string} text
 * @returns {LlmsTxtResult}
 */
export function validateLlmsTxt(text) {
  /** @type {LlmsIssue[]} */
  const issues = []
  const body = (text || "").replace(/^﻿/, "")
  const lines = body.split(/\r\n|\r|\n/)
  let title = null
  let summary = null
  /** @type {{ title: string, links: number }[]} */
  const sections = []
  let linkCount = 0
  let firstContent = -1

  const head = body.slice(0, 500).trimStart().toLowerCase()
  if (head.startsWith("<!doctype") || head.startsWith("<html") || /<(head|body|script)\b/.test(head)) {
    return {
      valid: false,
      title: null,
      summary: null,
      sections: [],
      linkCount: 0,
      issues: [{ severity: "error", line: null, text: "The file is an HTML page, probably your app's fallback route." }]
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) continue
    if (firstContent === -1) firstContent = i
    const lineNo = i + 1

    if (/^#\s+/.test(trimmed)) {
      if (title === null && firstContent === i) {
        title = trimmed.replace(/^#\s+/, "").trim()
      } else {
        issues.push({ severity: "warning", line: lineNo, text: "Only one H1 is allowed, and it must be the first line." })
      }
      continue
    }
    if (/^>\s?/.test(trimmed) && summary === null && sections.length === 0) {
      summary = trimmed.replace(/^>\s?/, "").trim()
      continue
    }
    if (/^##\s+/.test(trimmed)) {
      sections.push({ title: trimmed.replace(/^##\s+/, "").trim(), links: 0 })
      continue
    }
    if (/^#{3,6}\s+/.test(trimmed) && sections.length === 0) {
      issues.push({ severity: "info", line: lineNo, text: "Headings other than the H1 and H2 sections are not part of the format." })
      continue
    }
    if (sections.length && /^[-*+]\s+/.test(trimmed)) {
      if (LINK_ITEM.test(trimmed)) {
        sections[sections.length - 1].links++
        linkCount++
      } else {
        issues.push({ severity: "warning", line: lineNo, text: `List item should start with a markdown link, like "- [Name](https://...): notes".` })
      }
    }
  }

  if (firstContent === -1) {
    issues.push({ severity: "error", line: null, text: "The file is empty." })
  } else if (title === null) {
    issues.push({ severity: "error", line: firstContent + 1, text: "The first line must be an H1 with your site or project name, like \"# Acme\"." })
  }
  if (title !== null && summary === null) {
    issues.push({ severity: "info", line: null, text: "No blockquote summary. A one-line \"> ...\" under the H1 tells readers what the site is." })
  }
  if (title !== null && linkCount === 0) {
    issues.push({ severity: "warning", line: null, text: "No links. Add H2 sections with lists of links to your key pages." })
  }

  return {
    valid: !issues.some(issue => issue.severity === "error"),
    title,
    summary,
    sections,
    linkCount,
    issues
  }
}
