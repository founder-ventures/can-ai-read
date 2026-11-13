// A small, forgiving HTML scanner. It reads the raw HTML a server sends, the
// same bytes an AI crawler that does not run JavaScript receives, and pulls
// out what the checks need. It is not a full HTML5 parser and does not try
// to be: it handles comments, raw-text elements, quoted attributes and
// unclosed paragraphs, which covers real pages well enough for counting
// words and finding tags.

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
])

const RAW_TEXT = new Set(["script", "style", "textarea", "title", "noscript", "xmp"])

/** Elements whose text a reader never sees. */
const HIDDEN = new Set(["head", "script", "style", "noscript", "template", "svg", "iframe", "object", "select"])

/** Page chrome: counted as visible text, left out of main content. */
const CHROME = new Set(["nav", "header", "footer", "aside"])

const MAIN = new Set(["main", "article"])

/** Text after one of these starts a new block of text. */
const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4",
  "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section",
  "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul", "button", "label"
])

const MOUNT_IDS = new Set(["root", "app", "__next", "__nuxt", "___gatsby", "q-app", "svelte", "main-app"])

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  hellip: "...",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  copy: "(c)",
  reg: "(R)",
  trade: "(TM)",
  middot: "-",
  bull: "-"
}

/** @param {string} text */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (whole, name) => {
    if (name[0] === "#") {
      const code =
        name[1] === "x" || name[1] === "X"
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole
      try {
        return String.fromCodePoint(code)
      } catch {
        return whole
      }
    }
    const value = ENTITIES[name.toLowerCase()]
    return value === undefined ? whole : value
  })
}

/**
 * Count words. Runs of letters or digits count as one word each. Chinese and
 * Japanese have no spaces, so every two of their characters count as one.
 * @param {string} text
 */
export function countWords(text) {
  if (!text) return 0
  const cjk = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length
  const rest = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, " ")
  const words = (rest.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || []).length
  return words + Math.ceil(cjk / 2)
}

/**
 * @typedef {{ type: "open", name: string, attrs: Record<string, string>, selfClosing: boolean }
 *   | { type: "close", name: string }
 *   | { type: "text", text: string }
 *   | { type: "raw", name: string, attrs: Record<string, string>, text: string }} HtmlEvent
 */

/** @param {string} source */
function parseAttrs(source) {
  /** @type {Record<string, string>} */
  const attrs = {}
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  let m
  while ((m = re.exec(source))) {
    const name = m[1].toLowerCase()
    if (name in attrs) continue
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "")
  }
  return attrs
}

/**
 * Turn HTML into a flat list of events.
 * @param {string} html
 * @returns {HtmlEvent[]}
 */
export function tokenize(html) {
  /** @type {HtmlEvent[]} */
  const events = []
  const lower = html.toLowerCase()
  let i = 0
  const n = html.length
  while (i < n) {
    const lt = html.indexOf("<", i)
    if (lt === -1) {
      events.push({ type: "text", text: html.slice(i) })
      break
    }
    if (lt > i) events.push({ type: "text", text: html.slice(i, lt) })
    i = lt
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4)
      i = end === -1 ? n : end + 3
      continue
    }
    if (html[i + 1] === "!" || html[i + 1] === "?") {
      const end = html.indexOf(">", i)
      i = end === -1 ? n : end + 1
      continue
    }
    const closing = html[i + 1] === "/"
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(html.slice(i + (closing ? 2 : 1), i + 64))
    if (!nameMatch) {
      events.push({ type: "text", text: "<" })
      i += 1
      continue
    }
    const name = nameMatch[0].toLowerCase()
    // Find the end of the tag, skipping ">" inside quoted attribute values.
    let j = i + (closing ? 2 : 1) + name.length
    let quote = ""
    while (j < n) {
      const ch = html[j]
      if (quote) {
        if (ch === quote) quote = ""
      } else if (ch === '"' || ch === "'") {
        quote = ch
      } else if (ch === ">") {
        break
      }
      j++
    }
    const inner = html.slice(i + (closing ? 2 : 1) + name.length, j)
    i = j + 1
    if (closing) {
      events.push({ type: "close", name })
      continue
    }
    const selfClosing = inner.trimEnd().endsWith("/")
    const attrs = parseAttrs(inner.replace(/\/\s*$/, ""))
    if (RAW_TEXT.has(name) && !selfClosing) {
      const endTag = lower.indexOf(`</${name}`, i)
      const stop = endTag === -1 ? n : endTag
      events.push({ type: "raw", name, attrs, text: html.slice(i, stop) })
      if (endTag === -1) {
        i = n
      } else {
        const gt = html.indexOf(">", endTag)
        i = gt === -1 ? n : gt + 1
      }
      continue
    }
    events.push({ type: "open", name, attrs, selfClosing: selfClosing || VOID.has(name) })
  }
  return events
}

/** @param {string} text */
function squash(text) {
  return decodeEntities(text).replace(/\s+/g, " ").trim()
}

/**
 * @typedef {{
 *   lang: string | null,
 *   title: string | null,
 *   metaDescription: string | null,
 *   metaRobots: { name: string, content: string }[],
 *   ogSiteName: string | null,
 *   canonicals: string[],
 *   headings: { level: number, text: string }[],
 *   h1Count: number,
 *   h2Count: number,
 *   links: string[],
 *   jsonLd: { raw: string, data: unknown, error: string | null }[],
 *   microdata: boolean,
 *   scriptCount: number,
 *   visibleText: string,
 *   mainText: string,
 *   visibleWords: number,
 *   mainWords: number,
 *   openingText: string | null,
 *   textBlocks: string[],
 *   emptyMountId: string | null,
 *   noscriptAsksForJs: boolean,
 *   dataNosnippetCount: number
 * }} HtmlFacts
 */

/**
 * Read the facts the checks need from one HTML document.
 * @param {string} html
 * @returns {HtmlFacts}
 */
export function analyzeHtml(html) {
  const events = tokenize(html || "")
  /** @type {HtmlFacts} */
  const facts = {
    lang: null,
    title: null,
    metaDescription: null,
    metaRobots: [],
    ogSiteName: null,
    canonicals: [],
    headings: [],
    h1Count: 0,
    h2Count: 0,
    links: [],
    jsonLd: [],
    microdata: false,
    scriptCount: 0,
    visibleText: "",
    mainText: "",
    visibleWords: 0,
    mainWords: 0,
    openingText: null,
    textBlocks: [],
    emptyMountId: null,
    noscriptAsksForJs: false,
    dataNosnippetCount: 0
  }

  let hidden = 0
  let chrome = 0
  let nav = 0
  let main = 0
  let sawMain = false
  /** @type {{ text: string, chrome: boolean, main: boolean }[]} */
  const segments = []
  /** @type {{ level: number, parts: string[] } | null} */
  let heading = null
  let afterFirstH1 = false
  let block = ""
  /** Text blocks seen after the first H1, in order. */
  const blocksAfterH1 = []

  const flushBlock = () => {
    const text = squash(block)
    if (afterFirstH1 && text) blocksAfterH1.push(text)
    if (text && facts.textBlocks.length < 2000) facts.textBlocks.push(text)
    block = ""
  }

  for (let k = 0; k < events.length; k++) {
    const ev = events[k]
    if (ev.type === "raw") {
      if (ev.name === "title" && facts.title === null) facts.title = squash(ev.text)
      if (ev.name === "script") {
        facts.scriptCount++
        const type = (ev.attrs.type || "").toLowerCase()
        if (type.includes("ld+json")) {
          const raw = ev.text
            .trim()
            .replace(/^<!--/, "")
            .replace(/-->$/, "")
            .replace(/^\/\/\s*<!\[CDATA\[/, "")
            .replace(/\/\/\s*\]\]>$/, "")
            .trim()
          try {
            facts.jsonLd.push({ raw, data: JSON.parse(raw), error: null })
          } catch (err) {
            facts.jsonLd.push({ raw, data: null, error: err instanceof Error ? err.message : String(err) })
          }
        }
      }
      if (ev.name === "noscript" && /enable\s+javascript|javascript\s+(is\s+)?(required|disabled|needed)|requires\s+javascript/i.test(ev.text)) {
        facts.noscriptAsksForJs = true
      }
      if (ev.name === "textarea" && !hidden) block += " "
      continue
    }

    if (ev.type === "open") {
      const { name, attrs } = ev
      if ("data-nosnippet" in attrs) facts.dataNosnippetCount++
      if (attrs.itemtype && /schema\.org/i.test(attrs.itemtype)) facts.microdata = true
      if (name === "html" && attrs.lang) facts.lang = attrs.lang
      if (name === "meta") {
        const key = (attrs.name || attrs.property || attrs["http-equiv"] || "").toLowerCase()
        const content = attrs.content ?? ""
        if (key === "description" && facts.metaDescription === null) facts.metaDescription = squash(content)
        if (key === "og:site_name" && facts.ogSiteName === null) facts.ogSiteName = squash(content)
        if (key && (key === "robots" || key === "googlebot" || /bot|agent|crawler|gpt|claude|perplexity/i.test(key)) && attrs.name) {
          facts.metaRobots.push({ name: key, content: content.toLowerCase() })
        }
      }
      if (name === "link" && attrs.href && /(^|\s)canonical(\s|$)/i.test(attrs.rel || "")) {
        facts.canonicals.push(attrs.href.trim())
      }
      if (name === "a" && attrs.href) facts.links.push(attrs.href.trim())
      if (attrs.id && MOUNT_IDS.has(attrs.id) && !ev.selfClosing && facts.emptyMountId === null) {
        // An app mount point with nothing inside it is the classic sign of a
        // page that only appears after JavaScript runs.
        let m = k + 1
        while (m < events.length && events[m].type === "text" && !events[m].text.trim()) m++
        const next = events[m]
        if (!next || (next.type === "close" && next.name === name)) facts.emptyMountId = attrs.id
      }
      if (ev.selfClosing) {
        if (name === "br" && !hidden) {
          block += " "
          flushBlock()
        }
        continue
      }
      if (HIDDEN.has(name)) hidden++
      if (CHROME.has(name)) chrome++
      if (name === "nav") nav++
      if (MAIN.has(name)) {
        main++
        sawMain = true
      }
      if (/^h[1-6]$/.test(name) && !hidden) {
        const level = Number(name[1])
        if (level <= 3) heading = { level, parts: [] }
      }
      if (BLOCK.has(name)) flushBlock()
      continue
    }

    if (ev.type === "close") {
      const { name } = ev
      if (HIDDEN.has(name)) hidden = Math.max(0, hidden - 1)
      if (CHROME.has(name)) chrome = Math.max(0, chrome - 1)
      if (name === "nav") nav = Math.max(0, nav - 1)
      if (MAIN.has(name)) main = Math.max(0, main - 1)
      if (heading && name === `h${heading.level}`) {
        const text = squash(heading.parts.join(" "))
        facts.headings.push({ level: heading.level, text })
        if (text && facts.textBlocks.length < 2000) facts.textBlocks.push(text)
        if (heading.level === 1) {
          facts.h1Count++
          if (!afterFirstH1) {
            afterFirstH1 = true
            block = ""
            heading = null
            continue
          }
        }
        if (heading.level === 2) facts.h2Count++
        heading = null
      }
      if (BLOCK.has(name)) flushBlock()
      continue
    }

    // text
    if (hidden) continue
    const text = ev.text
    if (heading) heading.parts.push(text)
    else if (nav === 0) block += text
    segments.push({ text, chrome: chrome > 0, main: main > 0 })
  }
  flushBlock()

  facts.visibleText = squash(segments.map(s => s.text).join(" "))
  const mainSegments = sawMain ? segments.filter(s => s.main) : segments.filter(s => !s.chrome)
  facts.mainText = squash(mainSegments.map(s => s.text).join(" "))
  facts.visibleWords = countWords(facts.visibleText)
  facts.mainWords = countWords(facts.mainText)
  facts.openingText = blocksAfterH1.find(b => countWords(b) >= 5) ?? null
  return facts
}

/**
 * Every @type in a JSON-LD value, at any depth.
 * @param {unknown} data
 * @returns {string[]}
 */
export function jsonLdTypes(data) {
  /** @type {string[]} */
  const out = []
  const seen = new Set()
  /** @param {unknown} node @param {number} depth */
  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 12 || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    const obj = /** @type {Record<string, unknown>} */ (node)
    const type = obj["@type"]
    for (const t of Array.isArray(type) ? type : [type]) {
      if (typeof t === "string" && t) out.push(t.replace(/^https?:\/\/schema\.org\//i, "").replace(/^schema:/i, ""))
    }
    for (const value of Object.values(obj)) walk(value, depth + 1)
  }
  walk(data, 0)
  return out
}

/**
 * Every JSON-LD node (object with @type), at any depth.
 * @param {unknown} data
 * @returns {Record<string, unknown>[]}
 */
export function jsonLdNodes(data) {
  /** @type {Record<string, unknown>[]} */
  const out = []
  const seen = new Set()
  /** @param {unknown} node @param {number} depth */
  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 12 || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    const obj = /** @type {Record<string, unknown>} */ (node)
    if (obj["@type"]) out.push(obj)
    for (const value of Object.values(obj)) walk(value, depth + 1)
  }
  walk(data, 0)
  return out
}

/**
 * Split text into sentences.
 * @param {string} text
 */
export function sentences(text) {
  return text
    .split(/(?<=[.!?。！？])\s+(?=[\p{Lu}\p{N}"“¿¡])/u)
    .map(s => s.trim())
    .filter(Boolean)
}
