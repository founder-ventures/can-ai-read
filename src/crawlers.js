// The crawlers this tool checks, what each one powers, and how many points it
// is worth. Every description paraphrases the vendor's own documentation,
// linked in `source`. Keep "may" as "may" when you edit one.
//
// Roles:
//   search    builds the index an AI search product answers from
//   user      fetches a page live because a person asked a question
//   training  collects content that may be used to train models
//
// Search and user fetchers decide whether you can be quoted in an answer
// today, so they carry most of the points. Blocking training crawlers is a
// legitimate business choice, so it costs fewer points and never fails CI on
// its own.

const OPENAI = "https://developers.openai.com/api/docs/bots"
const ANTHROPIC =
  "https://privacy.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler"
const GOOGLE_CRAWLERS =
  "https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers"
const GOOGLE_AI_FEATURES =
  "https://developers.google.com/search/docs/appearance/ai-features"
const PERPLEXITY = "https://docs.perplexity.ai/docs/resources/perplexity-crawlers"
const COPILOT =
  "https://learn.microsoft.com/en-us/microsoft-365/copilot/manage-public-web-access"
const APPLE = "https://support.apple.com/en-us/119829"
const META =
  "https://developers.facebook.com/documentation/sharing/webmasters/web-crawlers"
const DUCKDUCKGO =
  "https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot"
const AMAZON = "https://developer.amazon.com/amazonbot"
const MISTRAL = "https://docs.mistral.ai/robots"
const COMMON_CRAWL = "https://commoncrawl.org/ccbot"

/**
 * @typedef {"search" | "user" | "training"} CrawlerRole
 * @typedef {{
 *   token: string,
 *   vendor: string,
 *   role: CrawlerRole,
 *   powers: string,
 *   points: number,
 *   critical: boolean,
 *   source: string
 * }} Crawler
 */

/** @type {readonly Crawler[]} */
export const SEARCH_CRAWLERS = Object.freeze([
  {
    token: "Googlebot",
    vendor: "Google",
    role: "search",
    powers: "Google Search, including AI Overviews and AI Mode",
    points: 5,
    critical: true,
    source: GOOGLE_AI_FEATURES
  },
  {
    token: "OAI-SearchBot",
    vendor: "OpenAI",
    role: "search",
    powers: "ChatGPT search",
    points: 4,
    critical: true,
    source: OPENAI
  },
  {
    token: "ChatGPT-User",
    vendor: "OpenAI",
    role: "user",
    powers: "pages ChatGPT opens to answer a user's question",
    points: 3,
    critical: false,
    source: OPENAI
  },
  {
    token: "bingbot",
    vendor: "Microsoft",
    role: "search",
    powers: "Bing, which Copilot may use to ground answers",
    points: 3,
    critical: true,
    source: COPILOT
  },
  {
    token: "PerplexityBot",
    vendor: "Perplexity",
    role: "search",
    powers: "Perplexity search results",
    points: 3,
    critical: true,
    source: PERPLEXITY
  },
  {
    token: "Perplexity-User",
    vendor: "Perplexity",
    role: "user",
    powers: "pages Perplexity opens to answer a user's question",
    points: 2,
    critical: false,
    source: PERPLEXITY
  },
  {
    token: "Claude-SearchBot",
    vendor: "Anthropic",
    role: "search",
    powers: "Claude search results",
    points: 2,
    critical: true,
    source: ANTHROPIC
  },
  {
    token: "Claude-User",
    vendor: "Anthropic",
    role: "user",
    powers: "pages Claude opens to answer a user's question",
    points: 2,
    critical: false,
    source: ANTHROPIC
  },
  {
    token: "Applebot",
    vendor: "Apple",
    role: "search",
    powers: "Siri, Spotlight and Safari suggestions",
    points: 1,
    critical: false,
    source: APPLE
  }
])

/** @type {readonly Crawler[]} */
export const TRAINING_CRAWLERS = Object.freeze([
  {
    token: "GPTBot",
    vendor: "OpenAI",
    role: "training",
    powers: "content that may be used to train OpenAI's models",
    points: 3,
    critical: false,
    source: OPENAI
  },
  {
    token: "Google-Extended",
    vendor: "Google",
    role: "training",
    powers: "Gemini model training and grounding in Gemini Apps",
    points: 3,
    critical: false,
    source: GOOGLE_CRAWLERS
  },
  {
    token: "ClaudeBot",
    vendor: "Anthropic",
    role: "training",
    powers: "content that could be used to train Anthropic's models",
    points: 2,
    critical: false,
    source: ANTHROPIC
  },
  {
    token: "Applebot-Extended",
    vendor: "Apple",
    role: "training",
    powers: "training Apple's foundation models",
    points: 1,
    critical: false,
    source: APPLE
  },
  {
    token: "meta-externalagent",
    vendor: "Meta",
    role: "training",
    powers: "training Meta's AI models and indexing content",
    points: 1,
    critical: false,
    source: META
  }
])

/** Reported for information only. They carry no points. */
/** @type {readonly Crawler[]} */
export const OTHER_CRAWLERS = Object.freeze([
  {
    token: "DuckAssistBot",
    vendor: "DuckDuckGo",
    role: "user",
    powers: "DuckDuckGo's AI-assisted answers",
    points: 0,
    critical: false,
    source: DUCKDUCKGO
  },
  {
    token: "MistralAI-User",
    vendor: "Mistral",
    role: "user",
    powers: "pages Mistral's assistant opens for a user's question",
    points: 0,
    critical: false,
    source: MISTRAL
  },
  {
    token: "meta-externalfetcher",
    vendor: "Meta",
    role: "user",
    powers: "pages Meta AI opens for a user's request",
    points: 0,
    critical: false,
    source: META
  },
  {
    token: "Amazonbot",
    vendor: "Amazon",
    role: "training",
    powers: "Amazon products and services, which may include model training",
    points: 0,
    critical: false,
    source: AMAZON
  },
  {
    token: "CCBot",
    vendor: "Common Crawl",
    role: "training",
    powers: "Common Crawl's open dataset, widely used to train models",
    points: 0,
    critical: false,
    source: COMMON_CRAWL
  }
])

/** Every crawler the tool evaluates, in report order. */
export const AI_CRAWLERS = Object.freeze([
  ...SEARCH_CRAWLERS,
  ...TRAINING_CRAWLERS,
  ...OTHER_CRAWLERS
])

export const SOURCES = Object.freeze({
  OPENAI,
  ANTHROPIC,
  GOOGLE_CRAWLERS,
  GOOGLE_AI_FEATURES,
  PERPLEXITY,
  COPILOT,
  APPLE,
  META
})
