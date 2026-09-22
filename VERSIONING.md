# Versioning — backend

`church-cafe-backend` is versioned **MAJOR.MINOR.PATCH** ([semver]). Both
clients print this number at the foot of their Profile screen next to their
own, so it is read by staff, not only by git.

[semver]: https://semver.org

## Which part to change

| What you shipped | Change | Example |
| --- | --- | --- |
| **A hotfix** — something that was meant to work already didn't, and now does | **PATCH** + 1 | `1.0.0` → `1.0.1` |
| **A new feature** — a new endpoint, a new field, anything staff or customers would notice as new | **MINOR** + 1, PATCH back to `0` | `1.0.1` → `1.1.0` |
| **A breaking change** — a deployed client can no longer talk to this server | **MAJOR** + 1, the rest back to `0` | `1.1.0` → `2.0.0` |

Rules of thumb:

- If the release note would say *"fixed"*, it is a patch. If it would say
  *"added"* or *"you can now"*, it is a minor.
- **Removing or renaming** anything a shipped client sends or reads is major.
  Adding a new optional field is not — old clients ignore it. The installed
  mobile app is the constraint here: people do not update it on your schedule,
  so a major bump means "the old app is broken until it updates".
- Refactors, dependency bumps, comment and doc changes that nothing outside the
  process can observe do not need a bump at all.
- Never skip a number and never reuse one. The version is how a bug report is
  matched to a build.

## Where the number lives

`package.json` → `"version"`. That is the only place it is edited.

`src/config/version.js` reads it, and it is served from three places:

```bash
curl https://pugbug.fun/api/version   # { "name", "version", "env" } — public
curl https://pugbug.fun/health        # the deploy's health gate, + version
curl https://pugbug.fun/              # { "name", "version" }
```

It is also the first thing in the boot log:
`church-cafe-backend v1.0.0 listening on http://localhost:4000`.

`package.json` ships inside the release tarball, so what `/api/version` reports
is the code actually answering — not whatever a checkout says.

## How to change it

Bump it **in the same commit as the change it describes**, so the number that
reaches `prod` always belongs to the code that reached `prod`.

```bash
cd my-church-cafe-backend

# Pick one. Each rewrites package.json and commits, with no git tag.
npm version patch --no-git-tag-version   # hotfix        1.0.0 -> 1.0.1
npm version minor --no-git-tag-version   # new feature   1.0.1 -> 1.1.0
npm version major --no-git-tag-version   # breaking      1.1.0 -> 2.0.0

git add -A && git commit -m "Fix …  (v1.0.1)"
git push origin prod
```

Then **sync the branches** as the repo requires — see `CLAUDE.md`:

```bash
git checkout main && git merge prod --ff-only && git push origin main && git checkout prod
```

Pushing to `prod` triggers the deploy. Confirm the right build went live:

```bash
curl -s https://pugbug.fun/api/version
```

If that still reports the old number after the workflow goes green, the release
did not flip — check `pm2 logs church-cafe-backend` on the VPS.

## The apps version separately

The web frontend, the mobile app, the print agent and this backend are four
repos with four independent version numbers. A backend bump does **not** oblige
a frontend bump, and the two do not have to match — the Profile footer shows
both precisely so a mismatch is visible:

```
v1.1.0 · server v1.0.0      # frontend has a feature the backend hasn't shipped
```

That is normal for a few seconds mid-deploy. If it persists, one of the two
deploys failed.
