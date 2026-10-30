# Behavior and limits

## Direction and ownership

GitHub is the source of truth. The Git worker fetches public HTTPS URLs without credentials and pushes only to the configured BugStage destination. Its GitHub push URL is deliberately unusable. Destination updates do not use force pushes or deletion refspecs.

If a branch is rewritten on GitHub, its destination update is rejected and the worker reports an error. Other non-conflicting refs may already have updated during that push. Resolve the divergence manually after reviewing the history. A branch or tag deleted on GitHub is retained on BugStage and listed in `retained_extra_refs`.

The worker copies Git objects, branches, and tags. It does not copy Git LFS payloads or other repository services. Empty source repositories have no refs to mirror and report an error until an initial commit exists.

## Releases and issues

The metadata hooks use GitHub's public REST API. Draft releases and pull requests are excluded. Release files remain on GitHub; only download links are stored. Issue comments, reactions, assignees, milestones, attachments, and users are not replicated as native objects. Embedded images may still load from their original hosts.

Original GitHub IDs map to stable BugStage IDs in the private `githubSyncState` collection. Updates preserve original creation dates and refresh issue activity dates. Imported issues belong to the `github-mirror` account, include source attribution, and are locked. Requests from visitors and maintainers cannot edit, delete, or reply to imported issues. Superusers can repair records directly; subsequent sync can overwrite those repairs when the source changes.

The imported category is tracked by ID and may be renamed. Ordinary API clients cannot unlock, move, or delete it. Native discussions and comments in other categories keep BugStage's normal permissions. Imported releases remain administratively editable; conflicting pre-existing local releases cause an error rather than being adopted silently.

Deleted upstream issues and releases are **not** removed locally. Removing a repository from configuration stops future syncing without deleting its existing content. Keep the hooks installed if you want imported issue protections to remain active.

Imports suppress BugStage notifications. No emails are sent for copied releases or issues. New native activity follows the instance's existing notification settings.

## Markdown

Imported bodies are parsed with markdown-it, with raw HTML disabled, then stored as rendered HTML inside BugStage's Markdown content. This avoids interpreting GitHub issue numbers as unrelated local discussion numbers.

Standalone issue references link to GitHub, while code and existing links are preserved. Relative file links resolve against the source repository; release links use the release tag, and issue links use `HEAD`. GitHub-specific alerts, task widgets, and raw HTML are not guaranteed to look identical. Raw HTML is displayed as text.

BugStage rc.3 caps release content at 5,000 characters. Longer notes use an escaped plain-text excerpt that leaves room for attribution and download links. Very large issue descriptions use the same fallback. Source links always provide the complete version.

## Rate limits and retries

Metadata runs at `17,47 * * * *`. Responses are cached with ETags. Public unauthenticated GitHub API limits are shared with other clients using the server's public IP, so capacity depends on repository count, pagination, and unrelated traffic.

Each run has a 45-request budget. Each release or issue list has a 20-page limit (100 items/page); reaching it stops that repository rather than treating partial results as complete. HTTP 429 and exhausted primary limits persist a cooldown until GitHub's retry/reset time. A later cron run retries failed repositories first.

A transaction-backed lease prevents overlapping metadata runs and expires after 20 minutes if a process crashes. Record writes and their ID mappings are transactional. A failed run can leave earlier items successfully imported; rerunning resumes idempotently.

## Compatibility

The integration is tested against BugStage 0.1.0-rc.3 and its PocketBase 0.41.1 runtime. It uses internal collection names and fields, so newer BugStage releases may require changes. Test an upgrade against a backup before replacing a working deployment.
