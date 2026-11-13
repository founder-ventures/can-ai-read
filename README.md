# can-ai-read

Check whether AI search engines can read your site. One command shows which AI crawlers your robots.txt blocks, whether your content is in the HTML without JavaScript, and what else stops ChatGPT search, Perplexity, Claude and Google AI Overviews from quoting your pages.

```sh
npx can-ai-read https://example.com
```

It has zero dependencies and needs Node 18 or newer. Use it as a CLI, a GitHub Action or a Node library. In CI it can compare a preview deployment with production and fail only when a change makes the site harder for AI crawlers to read.

## Sample report

This is a real run against the test fixtures in this repo: a site that blocks PerplexityBot and GPTBot and has no llms.txt.

```text
can-ai-read 0.1.0  https://example.com/
3 pages, 6 requests, 1.2s

Score 91/100   1 error, 3 warnings

AI crawler access ........................................ 29/35
  ✗ Search and answer crawlers ........................... 22/25
    PerplexityBot is blocked
    - PerplexityBot (Perplexity search results) is blocked by robots.txt line 5 "Disallow: /" in the group for User-agent: PerplexityBot. -3
  ! Training crawlers ..................................... 7/10
    GPTBot is blocked
    - GPTBot (content that may be used to train OpenAI's models) is blocked by robots.txt line 2 "Disallow: /" in the group for User-agent: GPTBot. -3
    - Blocking training crawlers is a legitimate choice and never fails the run. It does not remove you from ChatGPT, Claude or Perplexity search, which use the crawlers above.
  · robots.txt file ....................................... info
    Found: 3 groups, 0 sitemap lines

Indexing ................................................. 20/20
  ✓ Pages load ............................................. 5/5
    3 of 3 pages return HTTP 200
  ✓ No noindex ............................................. 8/8
    No noindex on 3 pages
  ✓ Snippets allowed ....................................... 4/4
    No nosnippet or tight max-snippet rules
  ✓ Canonical URLs ......................................... 3/3
    3 pages with a clean canonical

Readable without JavaScript .............................. 20/20
  ✓ Text in the server HTML .............................. 20/20
    Content is in the HTML on 3 pages

Structured data .......................................... 10/10
  ✓ JSON-LD structured data .............................. 10/10
    Organization, WebSite, Product, Offer, BlogPosting, Person

Answer-ready content ..................................... 10/10
  ✓ Title and description .................................. 4/4
    Present and sized well on 3 pages
  ✓ One H1 per page ........................................ 2/2
    "Invoicing for freelancers"
  ✓ Direct opening sentence ................................ 2/2
    Pages open with a short, direct sentence
  ✓ Says what it is ........................................ 2/2
    "Acme is an invoicing tool that sends invoices and chases late payments for freelancers."

Discovery files ............................................ 2/5
  ! XML sitemap ............................................ 2/3
    4 URLs in /sitemap.xml
    - Found at the default path. robots.txt does not list it.
  ! llms.txt ............................................... 0/2
    Not found (HTTP 404)
    - No major AI search engine has said it reads llms.txt, so it carries 2 points. It is cheap to add and follows a proposed format (llmstxt.org).

Fix first
  1. Search and answer crawlers (+3): Remove the Disallow rule from each crawler's own group in robots.txt: PerplexityBot (line 5).
  2. Training crawlers (+3): If the block is deliberate, keep it. To let models learn from your public pages, remove the Disallow rule from each crawler's own group in robots.txt: GPTBot (line 2).
  3. llms.txt (+2): Add /llms.txt: an H1 with your name, a one-line > summary, then H2 sections that list links to your key pages.
  4. XML sitemap (+1): Add "Sitemap: https://example.com/sitemap.xml" to robots.txt so every crawler finds it.
```

The run exits with code 1 because blocking PerplexityBot is an error. Blocking GPTBot is a warning and would not fail CI on its own.

## What it checks

The score is out of 100. Each check below says how many points it carries, why it matters and how to fix a failure. The tool reads the page you give it, robots.txt, the sitemap, llms.txt and two more pages it finds on your site.

| Area | Points |
| --- | ---: |
| [AI crawler access](#search-crawlers) | 35 |
| [Indexing](#pages-load) | 20 |
| [Readable without JavaScript](#server-text) | 20 |
| [Structured data](#json-ld) | 10 |
| [Answer-ready content](#title-description) | 10 |
| [Discovery files](#sitemap) | 5 |

<a id="search-crawlers"></a>
### Search and answer crawlers (25 points)

These crawlers build the indexes AI search answers from, or fetch a page live when someone asks a question. If robots.txt blocks them, those products cannot quote your pages.

| Crawler | Powers | Points |
| --- | --- | ---: |
| Googlebot | Google Search, including AI Overviews and AI Mode ([Google](https://developers.google.com/search/docs/appearance/ai-features)) | 5 |
| OAI-SearchBot | ChatGPT search ([OpenAI](https://developers.openai.com/api/docs/bots)) | 4 |
| ChatGPT-User | pages ChatGPT opens to answer a user's question ([OpenAI](https://developers.openai.com/api/docs/bots)) | 3 |
| bingbot | Bing, which Copilot may use to ground answers ([Microsoft](https://learn.microsoft.com/en-us/microsoft-365/copilot/manage-public-web-access)) | 3 |
| PerplexityBot | Perplexity search results ([Perplexity](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)) | 3 |
| Perplexity-User | pages Perplexity opens to answer a user's question ([Perplexity](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)) | 2 |
| Claude-SearchBot | Claude search results ([Anthropic](https://privacy.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)) | 2 |
| Claude-User | pages Claude opens to answer a user's question ([Anthropic](https://privacy.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)) | 2 |
| Applebot | Siri, Spotlight and Safari suggestions ([Apple](https://support.apple.com/en-us/119829)) | 1 |

A crawler blocked on some checked pages but not the start page gets half its points. Blocking Googlebot, OAI-SearchBot, bingbot, PerplexityBot or Claude-SearchBot on the start page is an error.

**How it reads robots.txt.** The matcher follows [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html): a crawler obeys only the group that names it, falls back to `User-agent: *` only when no group names it, and the longest matching rule wins. It reports the exact line that blocks each crawler.

**How to fix.** Remove the `Disallow` rule from the crawler's own group. If the crawler is blocked by `User-agent: *`, add a group for it, and repeat your other rules inside that group:

```text
User-agent: OAI-SearchBot
User-agent: PerplexityBot
Disallow: /admin/
Disallow: /api/
```

A group with only `Allow: /` would open `/admin/` to those crawlers, because a crawler with its own group ignores the `*` group entirely. The report prints this snippet with your own rules filled in.

<a id="training-crawlers"></a>
### Training crawlers (10 points)

| Crawler | Powers | Points |
| --- | --- | ---: |
| GPTBot | content that may be used to train OpenAI's models | 3 |
| Google-Extended | Gemini model training and grounding in Gemini Apps ([Google](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers)) | 3 |
| ClaudeBot | content that could be used to train Anthropic's models | 2 |
| Applebot-Extended | training Apple's foundation models | 1 |
| meta-externalagent | training Meta's AI models and indexing content ([Meta](https://developers.facebook.com/documentation/sharing/webmasters/web-crawlers)) | 1 |

Blocking these is a legitimate choice, so it is a warning and never fails a run. It does not remove you from ChatGPT, Claude or Perplexity search. Google says Google-Extended does not affect inclusion in Google Search, and names Googlebot's robots.txt rules as the control for AI Overviews and AI Mode. These crawlers carry points because a model can only learn what your pages say if it may read them.

The report also lists DuckAssistBot, MistralAI-User, meta-externalfetcher, Amazonbot and CCBot when they are blocked, without scoring them.

<a id="robots-txt"></a>
### robots.txt file (no points)

Reported for information, with warnings for:

- **robots.txt that fails to load.** RFC 9309 tells crawlers to treat a robots.txt that returns a 5xx error as a full block, so every crawler counts as blocked. This is an error.
- **An HTML page at /robots.txt.** Single-page apps often return `index.html` for every path. Crawlers find no rules in it.
- **A named group that drops your `*` rules.** If `User-agent: GPTBot` has its own group with `Allow: /`, GPTBot ignores every `Disallow` in `User-agent: *`. The report names the rule it skips.
- Directives that crawlers do not support, such as `Noindex:` in robots.txt, and `Content-Signal` lines.

When the site runs behind Cloudflare, the report reminds you that Cloudflare can block AI crawlers at the edge, which robots.txt does not show.

<a id="pages-load"></a>
### Pages load (5 points)

The checked pages should return HTTP 200. A start page that returns an error is an error. A 403 or 429 usually means bot protection blocked this tool, which may block AI crawlers too. A 401 usually means a protected preview: pass the bypass token with `--header`. Redirect chains of three hops or more are a warning.

<a id="noindex"></a>
### No noindex (8 points)

`<meta name="robots" content="noindex">` or an `X-Robots-Tag: noindex` header keeps a page out of search indexes, and AI search answers draw on those indexes. Noindex on the start page is an error. A noindex aimed at one crawler, such as `<meta name="GPTBot" content="noindex">`, costs half the page's share.

Vercel, Netlify and Cloudflare Pages add `X-Robots-Tag: noindex` to preview deployments on purpose. On `*.vercel.app`, `*.netlify.app` and `*.pages.dev`, or with `--preview`, that header is reported and not counted. A noindex meta tag always counts, because it ships to production with your code.

**How to fix.** Remove noindex from the pages you want found. Check your templates for meta robots tags and your server, CDN or framework config for `X-Robots-Tag`.

<a id="snippets"></a>
### Snippets allowed (4 points)

Google names `nosnippet`, `data-nosnippet`, `max-snippet` and `noindex` as the controls for what [AI Overviews and AI Mode](https://developers.google.com/search/docs/appearance/ai-features) may show from a page. `nosnippet` or `max-snippet:0` removes a page's points. A `max-snippet` under 50 characters halves them. Elements marked `data-nosnippet` are listed, because that is fine for a cookie banner and harmful on your main content.

<a id="canonical"></a>
### Canonical URLs (3 points)

Each page should have one `<link rel="canonical">` pointing to itself. The check flags pages with no canonical (half points), several conflicting ones, a canonical on another site, an inner page whose canonical points to the homepage, and an `http://` canonical on an `https://` page. When you compare a preview with production, canonicals that point to production count as your own site.

<a id="server-text"></a>
### Text in the server HTML (20 points)

The check counts the words a crawler sees in the raw HTML, before any JavaScript runs. [Vercel's analysis of AI crawler traffic](https://vercel.com/blog/the-rise-of-the-ai-crawler) (December 2024) found that the major AI crawlers it measured, from OpenAI, Anthropic, Meta, ByteDance and Perplexity, do not render JavaScript. Google's Gemini crawls with Googlebot's infrastructure, which does.

A page with 100 words or more gets full points. A page with 50 to 99 words gets three quarters and a warning. A page under 50 words gets none, and on the start page that is an error. The report also flags an empty `#root`, `#app` or `#__next` element and a `<noscript>` message that asks for JavaScript.

**How to fix.** Render the main content on the server: server-side rendering, static generation or prerendering. Check with `curl -s https://your-site.com | grep "a sentence from your page"`.

<a id="json-ld"></a>
### JSON-LD structured data (10 points)

- 4 points: at least one valid JSON-LD block on the checked pages.
- 2 points: no JSON-LD block with a syntax error.
- 4 points: an Organization (or LocalBusiness, Person or another organization type) on the start page. A WebSite alone earns 2.

The report lists the types it found on each page and suggests missing basics: `name`, `url`, `logo` and `sameAs` on your Organization, Article or BlogPosting on posts, BreadcrumbList on inner pages. Microdata is noted and not scored.

<a id="title-description"></a>
### Title and description (4 points)

Every page needs a `<title>` (2 points, or 1 outside 10 to 70 characters) and a meta description (2 points, or 1 outside 50 to 170 characters). Duplicate titles across the checked pages are listed.

<a id="headings"></a>
### One H1 per page (2 points)

One H1 per page gets full points. Several H1s get half. None gets zero.

<a id="opening-sentence"></a>
### Direct opening sentence (2 points)

The first sentence after the H1 should answer what the page is. 30 words or fewer passes. 31 to 40 words gets half. Longer sentences, and openers such as "In today's world" or "When it comes to", get zero.

<a id="says-what-it-is"></a>
### Says what it is (2 points)

The check looks for one sentence that defines the brand, such as "Acme is an invoicing tool for freelancers." It takes the brand name from `og:site_name`, your Organization or WebSite JSON-LD, the title and the domain. A definition of something else gets 1 point. AI answers to "what is Acme?" often lift a sentence like this, so put one near the top of your homepage, in the HTML.

<a id="sitemap"></a>
### XML sitemap (3 points)

The tool reads the first sitemap listed in robots.txt, or `/sitemap.xml`. A valid sitemap listed in robots.txt gets 3 points. One found only at the default path gets 2. An HTML page or a file with no URLs gets 0. For a sitemap index, the tool counts the child sitemaps and does not fetch them.

<a id="llms-txt"></a>
### llms.txt (2 points)

The file is checked against the format at [llmstxt.org](https://llmstxt.org): an H1 first, an optional `>` summary, and H2 sections whose list items start with `[name](url)`. No major AI search engine has said it reads llms.txt, which is why it carries only 2 points. It is cheap to add.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | No errors. With `--baseline`, no regressions. |
| 1 | At least one error, a score below `--fail-under`, or, with `--baseline`, a regression. |
| 2 | Could not run: a bad argument, or the site did not respond. |

Errors are: a start page that does not load, noindex on the start page, a major search crawler blocked on the start page, a start page with almost no text in its HTML, and a robots.txt that fails with a 5xx error.

## Use it in CI

### GitHub Action

Check production every week:

```yaml
name: AI readability
on:
  schedule:
    - cron: "0 7 * * 1"
  workflow_dispatch:

jobs:
  can-ai-read:
    runs-on: ubuntu-latest
    steps:
      - uses: founder-ventures/can-ai-read@v0
        with:
          url: https://example.com
          fail-under: 80
```

Check every Vercel preview against production and comment on the pull request. With a `baseline`, the step fails only on what the change made worse:

```yaml
name: AI readability
on: deployment_status

permissions:
  pull-requests: write

jobs:
  can-ai-read:
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: founder-ventures/can-ai-read@v0
        with:
          url: ${{ github.event.deployment_status.environment_url }}
          baseline: https://example.com
          comment: true
          # Only needed when Vercel Deployment Protection is on:
          headers: |
            x-vercel-protection-bypass: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}
```

The step writes a job summary, annotates failing checks, and keeps one comment on the pull request up to date.

| Input | Default | Description |
| --- | --- | --- |
| `url` | required | URL to check. |
| `baseline` | | URL to compare with, usually production. |
| `pages` | `2` (`1` with a baseline) | Extra pages to check, 0 to 8. |
| `paths` | | Comma-separated paths to check instead of discovering them. |
| `fail-under` | | Fail when the score is below this number. |
| `headers` | | Request headers for your site, one `Name: value` per line. Values are masked in logs. |
| `preview` | `auto` | `true` ignores `X-Robots-Tag: noindex` headers. |
| `comment` | `false` | Post or update a pull request comment. Needs `pull-requests: write`. |
| `fail` | `true` | Set to `false` to report without failing. |
| `github-token` | `github.token` | Token for the comment. |

Outputs: `score`, `errors`, `warnings`, `baseline-score`, `regressions` and `report-path` (the full JSON report).

### Any other CI

```sh
npx can-ai-read@0 "$PREVIEW_URL" --baseline https://example.com
npx can-ai-read@0 https://example.com --fail-under 80 --markdown >> report.md
```

## CLI options

```text
--baseline <url>   Compare with this URL and fail only on what got worse
--pages <n>        Extra pages to check besides <url> (default 2, or 1 with --baseline, max 8)
--paths <list>     Comma-separated paths to check instead of discovering them
--fail-under <n>   Exit 1 when the score is below n
--header <h>       Request header for your site, "Name: value". Repeatable.
--preview          Do not count X-Robots-Tag: noindex headers
--json             Print the full report as JSON
--markdown         Print the report as Markdown
--timeout <ms>     Timeout per request (default 10000)
--verbose, -v      Show details for passing checks too
--no-color         Plain output
```

`localhost` works too, so you can check a production build before you deploy it: `npx can-ai-read http://localhost:3000`.

## Node API

```js
import { check, compare, formatText } from "can-ai-read"

const report = await check("https://example.com", { pages: 2 })
console.log(report.score, report.errors)
for (const c of report.checks) console.log(c.id, c.points, c.maxPoints, c.summary)

const diff = await compare("https://preview.example.com", "https://example.com")
console.log(diff.regressions)

console.log(formatText(report, { color: true }))
```

The parsers are exported too: `parseRobots`, `isAllowed`, `validateLlmsTxt`, `parseSitemap`. TypeScript types are included.

## How it fetches

- It sends `User-Agent: can-ai-read/<version> (+https://github.com/founder-ventures/can-ai-read)` and obeys robots.txt rules for the token `can-ai-read`.
- The URL you give is fetched once, like a browser visit. Every other page is fetched only when robots.txt allows `can-ai-read`. If robots.txt fails with a 5xx error, nothing else is fetched.
- A default run makes 6 requests: the page, robots.txt, the sitemap, llms.txt and 2 more pages. With `--baseline` it makes up to 10. Redirects are followed up to 5 hops.
- Every request has a 10 second timeout and a size cap.
- Headers you pass with `--header` go only to the site being checked, never to a redirect target on another host.
- No telemetry. It contacts only the site you check, plus the GitHub API when you turn on pull request comments.

## What it cannot see

- **Firewalls and bot protection.** A CDN or WAF can block AI crawlers by user agent or IP address before robots.txt matters. This tool fetches as itself, so it cannot see how your firewall treats GPTBot or PerplexityBot. Check your CDN settings and server logs.
- **Whether AI engines actually name you.** can-ai-read checks whether AI engines can read your site. Whether they name you in their answers takes live answer checks: the [free Rankwise audit](https://tryrankwise.com/?ref=can-ai-read-readme) asks Perplexity real buyer questions about your market and shows which sites the answers cite.

## License

MIT
