# Publishing can-ai-read

Nothing here has been published. The repo exists only on this Mac, with no remote. These are the commands Rome runs after review, in order.

## Before you publish: three things to confirm

1. **GitHub owner.** The code points at `github.com/founder-ventures/can-ai-read` (Rome is an admin of `founder-ventures`). The name `rankwise` on GitHub belongs to an unrelated user, and `tryrankwise` was free on 2026-11-13. To use another owner, replace the string everywhere in one go:

   ```sh
   cd ~/Dev/can-ai-read
   grep -rl "founder-ventures/can-ai-read" --exclude-dir=.git . | xargs sed -i '' 's#founder-ventures/can-ai-read#NEW_OWNER/can-ai-read#g'
   npm test
   ```

2. **Copyright line.** `LICENSE` says "Copyright (c) 2026 Rankwise". Change it if the holder should be a legal entity.

3. **npm name.** `can-ai-read` was free on 2026-11-13. Check again: `npm view can-ai-read` should print a 404 error.

## 1. Review locally

```sh
cd ~/Dev/can-ai-read
npm test                                        # 94 tests, no network
node bin/can-ai-read.js https://tryrankwise.com # a real run
node bin/can-ai-read.js https://tryrankwise.com --markdown
npm pack --dry-run                              # 18 files, about 50 kB
```

## 2. Create the GitHub repo and push

```sh
cd ~/Dev/can-ai-read
gh repo create founder-ventures/can-ai-read --public --source . --remote origin --push \
  --description "Check whether AI search engines can read your site: AI crawler rules, text without JavaScript, noindex, JSON-LD, llms.txt. CLI, GitHub Action and Node API." \
  --homepage "https://www.npmjs.com/package/can-ai-read"

gh repo edit founder-ventures/can-ai-read \
  --add-topic ai-crawlers --add-topic robots-txt --add-topic llms-txt --add-topic github-actions \
  --add-topic seo --add-topic generative-engine-optimization --add-topic gptbot --add-topic cli
```

The test workflow in `.github/workflows/test.yml` runs on the first push. Check it passes: `gh run watch --repo founder-ventures/can-ai-read`.

## 3. Tag the release

Action users pin `@v0`, so create both the exact tag and the moving major tag:

```sh
git tag -a v0.1.0 -m "v0.1.0"
git tag v0
git push origin v0.1.0 v0
```

## 4. Publish to npm

```sh
npm whoami || npm login
npm publish --access public
npm view can-ai-read version            # should print 0.1.0
npx can-ai-read@latest https://tryrankwise.com --pages 0
```

## 5. GitHub release and Marketplace listing

The Marketplace checkbox exists only in the web form, so this step is in the browser:

```sh
open "https://github.com/founder-ventures/can-ai-read/releases/new?tag=v0.1.0"
```

In the form:

1. Tick "Publish this Action to the GitHub Marketplace". If the box is disabled, accept the GitHub Marketplace Developer Agreement for the `founder-ventures` org through the link shown there.
2. Primary category: Code quality. Secondary category: Testing.
3. Release title: `v0.1.0`. Notes: "First release. CLI, GitHub Action and Node API that check whether AI search engines can read a site."
4. Publish.

The action name in `action.yml` is "can-ai-read: AI crawler readiness". Marketplace names must be unique. If GitHub rejects it, change `name:` in `action.yml`, commit, and move the tags (`git tag -f v0.1.0 && git tag -f v0 && git push -f origin v0.1.0 v0`). Moving tags rewrites no branch history.

Then check the listing: `open https://github.com/marketplace?type=actions&query=can-ai-read`

## Later releases

```sh
npm version patch            # or minor; updates package.json and creates the tag vX.Y.Z
git tag -f v0                # move the major tag to the new release
git push origin main --tags
git push -f origin v0
npm publish
open "https://github.com/founder-ventures/can-ai-read/releases/new?tag=v$(node -p 'require("./package.json").version')"
```

Publish each release from the web form with the Marketplace box ticked, so the listing shows the new version.

## Ref tags

Every link to tryrankwise.com carries `?ref=`. The free audit link in the CLI and Action points at `https://tryrankwise.com/report/<the checked domain>`. Preview, local and IP hosts get the homepage instead.

| Where the link appears | ref |
| --- | --- |
| CLI report footer | `can-ai-read-cli` |
| README (GitHub and npm) | `can-ai-read-readme` |
| GitHub Action job summary | `can-ai-read-action` |
| Pull request comment | `can-ai-read-pr` |
| Show HN first comment | `can-ai-read-hn` |
| dev.to post | `can-ai-read-devto` |

One gap on the Rankwise side: `lib/reports/ref-channel.ts` in the Rankwise app only knows the refs `email`, `colleague`, `link`, `x` and `linkedin`, and records any other ref as `direct` in the report page's own analytics. Site-wide attribution (`lib/attribution/touch.ts`) still records `ref:can-ai-read-cli` and the others correctly. To see them in report analytics too, add a rule for the `can-ai-read-` prefix in `ref-channel.ts`.

## Launch checklist

### Awesome lists

Open one pull request per list, after reading its CONTRIBUTING file. Suggested entry:

```markdown
- [can-ai-read](https://github.com/founder-ventures/can-ai-read) - CLI and GitHub Action that checks whether AI crawlers (GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot) can read a site: robots.txt per RFC 9309, text without JavaScript, noindex, JSON-LD and llms.txt.
```

Stars and last activity as of 2026-11-13:

| List | Stars | Last push | Where it fits |
| --- | ---: | --- | --- |
| https://github.com/amplifying-ai/awesome-generative-engine-optimization | 541 | 2026-04-14 | Tools |
| https://github.com/teles/awesome-seo | 892 | 2026-10-31 | Tools, technical SEO |
| https://github.com/thedaviddias/llms-txt-hub | 927 | 2026-11-13 | Tools (the llms.txt directory) |
| https://github.com/SecretiveShell/Awesome-llms-txt | 111 | 2026-10-18 | Tools |
| https://github.com/izak-fisher/generative-engine-optimization-tools | 120 | 2026-11-11 | Open-source tools |
| https://github.com/luka2chat/awesome-geo | 131 | 2026-10-14 | Tools |
| https://github.com/discoveredlabs/awesome-aeo-seo | 122 | 2026-06-27 | Tools for engineers |
| https://github.com/best-of-ai/awesome-ai-seo | 326 | 2026-07-27 | Tools |
| https://github.com/marcobiedermann/search-engine-optimization | 2812 | 2025-02-24 | Tools (slow to merge) |
| https://github.com/sdras/awesome-actions | 28431 | 2024-09-01 | Community resources (stale, try last) |

Wait for real users before trying https://github.com/sindresorhus/awesome-nodejs, which only takes established packages.

### Show HN

Title (73 characters):

> Show HN: can-ai-read, check whether AI search crawlers can read your site

Link: https://github.com/founder-ventures/can-ai-read

Draft first comment, in Rome's voice, for him to edit:

> Hi HN, I'm Rome. We build Rankwise, which tracks whether AI answers name a business. Before any of that matters, the engines have to be able to read the site, and that step fails in a few boring ways: a robots.txt that blocks OAI-SearchBot by accident, a React app that serves an empty div to crawlers that never run JavaScript, or a group like "User-agent: GPTBot / Allow: /" that opens /admin to that bot, because a named group ignores the * rules.
>
> can-ai-read checks those things in one command (npx can-ai-read yoursite.com). It has no dependencies and makes 6 requests. I use the GitHub Action most: point it at a preview deployment with production as the baseline, and it fails the PR only when the change makes things worse.
>
> It checks whether engines can read you. Whether they cite you takes live answer checks, which is what Rankwise does (free audit: https://tryrankwise.com/?ref=can-ai-read-hn).
>
> Happy to hear which checks are missing, or where the scoring is wrong :)

Post on a weekday morning, US Eastern time. Answer every comment the same day.

### dev.to post

Title: "Your robots.txt might be blocking ChatGPT search. Here is how to check in CI."

Outline:

1. The question developers now get asked: can ChatGPT, Perplexity and Google AI Overviews read our site? Three ways sites fail it: robots.txt rules, pages that only render with JavaScript, and noindex or nosnippet left on.
2. The robots.txt trap, with the RFC 9309 rule and a before/after snippet. Training crawlers (GPTBot) are different from search crawlers (OAI-SearchBot), with OpenAI's own documentation linked.
3. The JavaScript problem: what a crawler that does not run scripts sees, with `curl` and the Vercel study linked.
4. Running `npx can-ai-read` and reading the report.
5. The GitHub Action on Vercel previews with a production baseline, including the protection bypass header.
6. What it cannot see: firewalls and whether answers name you, with the free audit link tagged `?ref=can-ai-read-devto`.

Tags: `webdev`, `seo`, `ai`, `github`.

### Where the Rankwise site should link to it

- **The free tools hub** (`app/[locale]/(public)/(pages)/tools/`): a "For developers" card that links to the GitHub repo.
- **The crawler directory** (`/bots` and each `/bots/<slug>` page, from `lib/seo/ai-crawlers.ts`): one line, "Check every crawler on this list against your robots.txt from the terminal: npx can-ai-read yoursite.com".
- **The robots.txt guide** (`content/resources/guides/robots-txt-for-ai-crawlers.md`): a "Check it in CI" section with the Action snippet.
- **The related free tools**: `ai-crawler-checker`, `gptbot-allowlist-tester`, `robots-txt-tester`, `llm-crawl-checker` and `llms-txt-generator`, each with a "Run this check in CI" line.
- **Rankwise's own llms.txt** (`lib/seo/llms-txt.ts`): one link under its tools section.
- **The `@rankwise/next` README**: a line pointing to can-ai-read for checking before deploy.

Links from Rankwise to GitHub need no ref tag. Links from GitHub, npm and posts back to Rankwise carry the tags above.

### After launch

- Weekly npm downloads: `curl -s https://api.npmjs.org/downloads/point/last-week/can-ai-read`
- Stars: `gh api repos/founder-ventures/can-ai-read --jq .stargazers_count`
- Signups from the tool: PostHog Rankwise project 281849, filter on `ref` starting with `can-ai-read-`.
