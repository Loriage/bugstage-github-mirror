# Operations

## Add or remove repositories in the Docker recipe

Edit `mirrors.json`, then run:

```sh
python3 scripts/configure.py --check
python3 scripts/configure.py
docker compose --profile setup run --rm setup
docker compose restart bugstage mirror
```

Setup creates missing public destinations and their GitHub links without replacing existing project descriptions. It refuses to change an existing private repository's visibility. It preserves the existing worker SSH key and administrator credentials. The explicit `default_branch` is used for the destination's symbolic HEAD; update it if the upstream default branch changes.

`scripts/configure.py` preserves existing schedule and release-notification choices when regenerating metadata configuration.

Configuration is validated before running. Only `https://github.com/OWNER/REPO.git` sources with `private: false` are supported. Credentials embedded in URLs, duplicate sources, and duplicate destinations are rejected.

## Use the Git worker with an existing instance

The Python worker can run separately from the fresh-install recipe. It expects:

- A configuration file in the same format as `mirrors.example.json` (`MIRROR_CONFIG`, default `/config/mirrors.json`).
- A writable state directory (`MIRROR_STATE`, default `/state`) with `id_ed25519`, `known_hosts`, and a `.configured` marker.
- A dedicated key registered with a BugStage maintainer that can push to the intended repositories.
- The destination reachable as `bugstage:8022`. Set up a Docker network alias for your BugStage container when using the supplied worker image.
- A pinned `[bugstage]:8022` host key in `known_hosts`, obtained through a trusted channel.

Create the public destination projects and repositories first. The metadata configuration uses their slugs. Register the worker key and verify the host key before writing `.configured`; the worker intentionally refuses to start without that marker. Existing-instance setup is manual so the fresh-install bootstrap does not modify your credentials or mount your existing database.

Run `python3 scripts/mirror.py --once` for one pass or omit `--once` for continuous operation. `SYNC_INTERVAL` defaults to 300 seconds. A source fetch, destination push, and destination ref comparison are performed each cycle.

## Inspect status

```sh
docker compose ps
docker compose logs --tail=100 mirror
docker compose exec mirror cat /state/status.json
docker compose logs --tail=100 bugstage
```

The Git report includes repository names, branch/tag counts, default-branch commit, retained extra refs, and errors. Its health check fails after an error or if the last success is older than three intervals.

Metadata status is available at `GET /api/github-sync/status`; a manual run uses `POST /api/github-sync/run`. Both require a PocketBase **superuser** bearer token, not a normal BugStage user token. Use your existing administrator client or the PocketBase dashboard; keep tokens out of URLs, shell history, and screenshots. The response has per-repository counts and errors. HTTP 200 means the run completed, so inspect each repository's `status` too.

The `githubSyncState` collection is inaccessible to ordinary users. Back up its mappings with your database: removing them can lead to duplicate issue imports or release conflicts.

## Upgrades and backups

Back up the BugStage data volume, worker state volume, hooks/configuration, and private administrator credential file. These include database records, Git repositories, attachments, identity settings, and SSH keys. An off-host backup is recommended; this integration does not provision one.

For the supplied Docker recipe, review the new version, rebuild, and recreate only these services:

```sh
docker compose build
docker compose up -d bugstage mirror
```

The bundled binary version and download checksums are pinned in `docker/Dockerfile`. Updating the image does not change those pins automatically. Never run `docker compose down -v` on data you want to retain.

For hooks-only installs, replace the module, hook entry point, and vendor directory together, then restart BugStage. Keep your own configuration. The initial public release recognizes the original private integration's v1 ID mappings and upgrades them without duplicating records.

## Stop or uninstall

Set `schedule_enabled` to `false` to stop scheduled metadata imports, and stop the Git worker. Manual administrator imports remain available. Removing the hooks also removes imported-issue API protections; review that before uninstalling. Existing content is retained, and no GitHub data is changed.
