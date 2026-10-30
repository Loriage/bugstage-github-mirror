# BugStage GitHub Mirror

Keep GitHub as your primary forge and publish a public mirror on [BugStage](https://bugstage.dev/).

This independent integration copies Git branches and tags, release notes, and issues in one direction: **GitHub → BugStage**. It does not need a GitHub token and never pushes to GitHub.

Tested with **BugStage 0.1.0-rc.3 / PocketBase 0.41.1**. BugStage is still a release candidate; back up your instance before installing hooks or upgrading.

## What gets mirrored

| Content | Behavior |
| --- | --- |
| Git branches and tags | Checked every 5 minutes. Fast-forward updates only; deleted refs are retained on BugStage. |
| Published releases | Notes, original publication date, pre-release marker, and links to the original downloads. |
| Issues | Title, body, open/closed state, labels, author attribution, and original dates. |
| GitHub references | `#123` and `owner/repo#123` in imported text link back to GitHub. Code and existing links retain their meaning. |
| Existing native discussions | Continue to work normally. Imported issues are read-only and point visitors to GitHub to reply. |

Release and issue sync runs at minutes **17 and 47 of each hour**. Repeated runs update existing records without creating duplicates. Imports are silent by default; optional notifications can announce newly published releases to subscribers after a silent baseline sync.

This is an additive mirror, not a full backup. Comments, pull requests, reactions, release binaries, and Git LFS objects are not copied. Deleted upstream items are retained. Large release notes become a plain-text excerpt with a link to the full version. See [behavior and limits](https://github.com/Loriage/bugstage-github-mirror/blob/main/docs/behavior.md).

## Install on an existing BugStage instance

1. Back up your BugStage data and hooks.
2. Copy `pb_hooks/github-sync.js`, `pb_hooks/github-sync.pb.js`, and the **entire `pb_hooks/vendor` directory** into your instance's hooks directory. Keep the included third-party notices with them.
3. Copy `pb_hooks/github-sync.config.example.json` to `github-sync.config.json` in that directory. List only public GitHub repositories and their existing public BugStage project/repository slugs.
4. Restart only your BugStage service so the new hooks are loaded.
5. Wait for the next scheduled run, or call the administrator-only `POST /api/github-sync/run` endpoint. Check `GET /api/github-sync/status` for results.

The hooks create their own private `githubSyncState` collection and a non-login `github-mirror` attribution account. They do not configure OAuth, SMTP, site branding, or general project-creation permissions.

This installs **metadata sync**. For Git replication as well, use the worker described in [operations](https://github.com/Loriage/bugstage-github-mirror/blob/main/docs/operations.md), or the fresh Docker installation below.

## Optional release notifications

Set `"notify_new_releases": true` in `pb_hooks/github-sync.config.json` to notify project/channel subscribers of new releases. The first successful sync establishes a silent baseline; historical releases, issue imports, edits, and repeat runs stay silent. Notifications respect each user's email preference. BugStage batches unread email notifications every ten minutes. See [notification behavior](https://github.com/Loriage/bugstage-github-mirror/blob/main/docs/behavior.md#release-notifications).

## Fresh Docker installation

Requires Docker Compose v2 and Python 3.10+. The bundled image downloads a checksum-verified BugStage binary for Linux amd64 or arm64. Node.js is only required when changing the bundled Markdown renderer.

```sh
git clone https://github.com/Loriage/bugstage-github-mirror.git
cd bugstage-github-mirror
cp mirrors.example.json mirrors.json
cp .env.example .env
```

Edit `mirrors.json` with your repositories, destination slugs, and actual default branches. Edit `.env` with your public URL. Then:

```sh
python3 scripts/configure.py --admin-email admin@example.com
docker compose build
docker compose up -d bugstage
docker compose --profile setup run --rm setup
docker compose up -d mirror
```

The site defaults to `http://127.0.0.1:8092`. Your generated administrator password is stored locally in `.secrets/admin.json`, with mode `0600`; read it privately and save it in your password manager. The setup service registers a dedicated SSH key for the worker and pins the server's SSH host key. Credentials and working configuration are ignored by Git.

For a reverse proxy on another machine, set `BIND_ADDRESS` to the host's LAN address and set `PUBLIC_URL` to the HTTPS URL. The Git worker uses Docker's internal SSH port; no host SSH port is published.

**Use this Compose recipe for a new instance.** It has its own project name and volumes. Do not point its initialization scripts at an existing instance's data volume. See [operations](https://github.com/Loriage/bugstage-github-mirror/blob/main/docs/operations.md) for adding repositories, monitoring, upgrades, and recovery.

## Development

Requires Node.js 22+, Python 3.10+, and Git. The generated JSVM bundle is committed, so installation does not require npm.

```sh
npm ci --ignore-scripts
npm run build
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
docker build --target bugstage -t bugstage-github-mirror:test -f docker/Dockerfile .
python3 tests/integration/run.py
```

Integration tests use a uniquely named disposable container and fixture responses, with no GitHub credentials or API calls. They check real PocketBase JSVM execution, imports, permissions, notifications, dates, rate-limit backoff, and native participation. Python tests use real temporary Git repositories to check repeat runs, retained deletions, and rejection of rewritten history.

## License and credits

MIT. [BugStage](https://bugstage.dev/) is created by Gani Georgiev. The bundled Markdown renderer uses markdown-it and its dependencies; see [third-party notices](https://github.com/Loriage/bugstage-github-mirror/blob/main/THIRD_PARTY_NOTICES.md).

Issues and contributions belong on [GitHub](https://github.com/Loriage/bugstage-github-mirror). The repository is also [mirrored on BugStage](https://git.nohit.dev/bugstage-github-mirror).
