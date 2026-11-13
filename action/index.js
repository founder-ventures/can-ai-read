// Entry point for the GitHub Action (see action.yml).
import { runAction } from "../src/action.js"

runAction().then(
  code => {
    process.exitCode = code
  },
  err => {
    const message = String(err && err.stack ? err.stack : err).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")
    process.stdout.write(`::error::can-ai-read: ${message}\n`)
    process.exitCode = 1
  }
)
