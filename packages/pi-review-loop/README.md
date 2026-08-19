# @hl-agents/pi-review-loop

Pi extension providing `/review-loop`. It reviews a git scope, fixes actionable findings, and repeats up to five times without committing.

Install from this repository:

```bash
pi install git:github.com/hyperlocalinnovations/hl-agents
```

Use `/review-loop`, `/review-loop branch main`, `/review-loop staged`, `/review-loop uncommitted`, or `/review-loop all`.

An optional `REVIEW_GUIDELINES.md` at the reviewed repository's Git root is appended to each review prompt.
