// CommonJS module for PocketBase's JSVM. Imported content is never executed.
const STATE = "githubSyncState";
const CATEGORY = "GitHub issues";
const VERSION = 2;
const markdown = require("./vendor/source-markdown.js");

function config() {
    return validateConfig(JSON.parse(toString($os.readFile(__hooks + "/github-sync.config.json"))));
}
function validateConfig(value) {
    if (!value || typeof value.schedule_enabled !== "boolean" || !Array.isArray(value.repositories)) {
        throw new Error("Expected schedule_enabled and a repositories array");
    }
    const sources = {}, destinations = {};
    for (const entry of value.repositories) {
        const source = sourceName(entry.source).toLowerCase();
        if (!/^[a-z0-9_-]+$/.test(entry.project || "") || !/^[a-z0-9_-]+$/.test(entry.repository || "") || entry.private !== false) {
            throw new Error("Each destination needs valid slugs and private: false");
        }
        const destination = entry.project + "/" + entry.repository;
        if (sources[source] || destinations[destination]) throw new Error("Duplicate source or destination");
        sources[source] = true; destinations[destination] = true;
    }
    return value;
}
function key(value) { return $security.sha256(value).slice(0, 15); }
function botId() { return key("bugstage-github-import-bot-v1"); }
function first(app, collection, filter, params) {
    return app.findRecordsByFilter(collection, filter, "", 1, 0, params || {})[0] || null;
}
function state(app, name) {
    const record = first(app, STATE, "id={:id}", {id: key(name)});
    return record ? JSON.parse(record.getString("payload")) : null;
}
function saveState(app, name, payload) {
    let record = first(app, STATE, "id={:id}", {id: key(name)});
    if (!record) {
        record = new Record(app.findCollectionByNameOrId(STATE));
        record.set("id", key(name));
        record.set("key", name);
    } else if (record.getString("key") !== name) {
        throw new Error("Sync state identifier collision");
    }
    record.set("payload", payload);
    app.save(record);
}
function setup(app) {
    if (!app.findAllCollections("base").some(c => c.name === STATE)) {
        app.save(new Collection({
            name: STATE, type: "base", listRule: null, viewRule: null,
            createRule: null, updateRule: null, deleteRule: null,
            fields: [{name: "key", type: "text", required: true, max: 500},
                     {name: "payload", type: "json", required: true, maxSize: 10000000}],
            indexes: ["CREATE UNIQUE INDEX idx_github_sync_key ON githubSyncState (`key`)"],
        }));
    }
    let bot = first(app, "users", "id={:id}", {id: botId()});
    if (!bot) {
        bot = new Record(app.findCollectionByNameOrId("users"));
        bot.load({id: botId(), email: "github-mirror@users.invalid", username: "github-mirror", name: "GitHub mirror", verified: false});
        bot.setRandomPassword();
        app.save(bot);
    }
    if (bot.getString("username") !== "github-mirror" || bot.email() !== "github-mirror@users.invalid") {
        throw new Error("Import account identifier collision");
    }
    if (first(app, "maintainers", "user={:id}", {id: bot.id})) throw new Error("Import account must not be a maintainer");
    const prefs = first(app, "notificationSettings", "user={:id}", {id: bot.id});
    if (prefs && prefs.getBool("emailNotifications")) {
        prefs.set("emailNotifications", false); app.save(prefs);
    }
}
function sourceName(source) {
    const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\.git$/.exec(source);
    if (!match) throw new Error("Only configured public GitHub repositories are supported");
    return match[1];
}
function text(value) {
    return String(value || "").replace(/[\r\n]/g, " ").replace(/[\\`*_[\]<>]/g, "\\$&");
}
function githubUrl(url, source) {
    const prefix = "https://github.com/" + source + "/";
    if (typeof url !== "string" || !url.startsWith(prefix) || /[\s<>]/.test(url)) throw new Error("Invalid GitHub source URL");
    return url.replace(/\(/g, "%28").replace(/\)/g, "%29");
}
function author(value) {
    const login = value && value.login;
    return /^[A-Za-z0-9_-]+(?:\[bot\])?$/.test(login || "")
        ? "[" + text(login) + "](https://github.com/" + encodeURIComponent(login) + ")"
        : "a GitHub user";
}
function date(value) {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) throw new Error("Invalid source date");
    return d.toISOString();
}
function releaseContent(source, release) {
    const url = githubUrl(release.html_url, source);
    let body = "# " + text((release.name || release.tag_name).slice(0, 250)) + "\n\n";
    body += "Published " + date(release.published_at).slice(0, 10) + " · [View release on GitHub](" + url + ")\n\n";
    if (release.prerelease) body += "**Pre-release**\n\n";
    const notes = release.body || "No release notes provided.";
    let downloads = "";
    const assets = (release.assets || []).filter(a => a.state === "uploaded" && a.browser_download_url);
    if (assets.length) {
        downloads += "## Downloads\n\n";
        for (const asset of assets) {
            downloads += "- [" + text(asset.name) + "](" + githubUrl(asset.browser_download_url, source) + ")\n";
        }
    }
    // BugStage rc.3 limits release content to 5,000 characters. Fit complete
    // HTML or a plain-text excerpt, never a cut Markdown/code block.
    if (downloads.length > 2000) downloads = "## Downloads\n\n[All release files on GitHub](" + url + ")\n";
    const footer = "\n---\nAutomatically mirrored from GitHub. Download links point to the original release files.\n";
    const continuation = "\n\n*Plain-text excerpt.* [Read the full release notes on GitHub](" + url + ")";
    const available = 4900 - body.length - downloads.length - footer.length - continuation.length;
    const rendered = markdown.fit(source, notes, url, release.tag_name, available);
    return body + rendered.content + (rendered.truncated ? continuation : "") + "\n\n" + downloads + footer;
}
function issueContent(source, issue) {
    const url = githubUrl(issue.html_url, source);
    let body = "**[Reply on GitHub](" + url + ")** · [GitHub issue #" + issue.number + "](" + url + ") · **" + (issue.state === "closed" ? "Closed" : "Open") + "**\n\n";
    body += "Opened by " + author(issue.user) + " on " + date(issue.created_at).slice(0, 10) + ". ";
    body += "This is a read-only mirror; replies and the full conversation are on GitHub.\n\n";
    let footer = "";
    if ((issue.labels || []).length) footer += "\n\nLabels: " + issue.labels.slice(0, 15).map(l => text(String(l.name || l).slice(0, 100))).join(", ");
    footer += "\n\n---\n[View " + Number(issue.comments || 0) + " comment(s) on GitHub](" + url + ") · Last updated " + date(issue.updated_at).slice(0, 10) + ".\n";
    const continuation = "\n\n*Plain-text excerpt.* [Continue reading on GitHub](" + url + ")\n";
    const rendered = markdown.fit(source, issue.body || "No description provided.", url, "HEAD", 99000 - body.length - footer.length - continuation.length);
    return body + "---\n\n" + rendered.content + (rendered.truncated ? continuation : "") + footer;
}
function header(response, name) {
    const headers = response.headers || {};
    const found = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
    if (!found) return "";
    const value = headers[found];
    return Array.isArray(value) ? value[0] : value;
}
function getGithub(app, path, budget) {
    if (!/^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/|\?|$)/.test(path)) throw new Error("Invalid GitHub API path");
    const limit = state(app, "rate-limit");
    if (limit && limit.until > Date.now()) throw new Error("GitHub rate limit: retry after " + new Date(limit.until).toISOString());
    if (++budget.count > 45) throw new Error("Per-run request budget reached; remaining repositories will retry next cycle");
    const cached = state(app, "http:" + path);
    const headers = {Accept: "application/vnd.github+json", "User-Agent": "bugstage-github-mirror", "X-GitHub-Api-Version": "2022-11-28"};
    if (cached && cached.etag) headers["If-None-Match"] = cached.etag;
    const request = {url: "https://api.github.com" + path, method: "GET", headers: headers, timeout: 20};
    const response = budget.request ? budget.request(request) : $http.send(request);
    const remaining = header(response, "X-RateLimit-Remaining");
    if (response.statusCode === 429 || (response.statusCode === 403 && remaining === "0")) {
        const until = Math.max(Date.now() + 60000, Number(header(response, "X-RateLimit-Reset") || 0) * 1000 + 10000,
                              Date.now() + Number(header(response, "Retry-After") || 60) * 1000);
        saveState(app, "rate-limit", {until: until});
        throw new Error("GitHub rate limit: retry after " + new Date(until).toISOString());
    }
    if (response.statusCode === 304 && cached) return cached.body;
    if (response.statusCode !== 200) throw new Error("GitHub " + path.split("?")[0] + ": HTTP " + response.statusCode);
    const body = response.json;
    saveState(app, "http:" + path, {etag: header(response, "ETag"), body: body});
    return body;
}
function githubPages(app, source, endpoint, budget) {
    let rows = [];
    for (let page = 1; page <= 20; page++) {
        const query = endpoint === "issues" ? "state=all&sort=created&direction=asc&" : "";
        const result = getGithub(app, "/repos/" + source + "/" + endpoint + "?" + query + "per_page=100&page=" + page, budget);
        if (!Array.isArray(result)) throw new Error("Unexpected GitHub response");
        rows = rows.concat(result);
        if (result.length < 100) return rows;
    }
    throw new Error("Pagination limit reached; refusing to treat an incomplete list as complete");
}
function ensure(app, collection, expression, params, values) {
    let record = first(app, collection, expression, params);
    if (!record) { record = new Record(app.findCollectionByNameOrId(collection)); record.load(values); app.save(record); }
    return record;
}
function hasState(app) {
    return app.findAllCollections("base").some(c => c.name === STATE);
}
function ensureCategory(app, project) {
    const mapping = state(app, "category:" + project.id);
    let record = mapping ? first(app, "categories", "id={:id}", {id: mapping.target}) : null;
    if (record && record.getString("project") !== project.id) throw new Error("Imported category moved to another project");
    if (!record) {
        // Adopt the original v1 category once, then track its immutable ID.
        record = ensure(app, "categories", "project={:project} && name={:name}", {project: project.id, name: CATEGORY},
            {project: project.id, name: CATEGORY, description: "Read-only GitHub issues. Reply on GitHub.", icon: "ri-github-fill", locked: true, order: 10});
    }
    if (!record.getBool("locked")) { record.set("locked", true); app.save(record); }
    saveState(app, "category:" + project.id, {target: record.id});
    saveState(app, "category-id:" + record.id, {project: project.id});
    return record;
}
function upsert(app, source, kind, item, values) {
    const name = kind + ":" + source + ":" + item.id;
    const createdAt = date(kind === "issue" ? item.created_at : item.published_at);
    const digest = $security.sha256(JSON.stringify({values, createdAt, updatedAt: item.updated_at}));
    let outcome = "unchanged";
    app.runInTransaction(tx => {
        const mapping = state(tx, name);
        const collection = kind === "issue" ? "discussions" : "releases";
        let record = mapping ? first(tx, collection, "id={:id}", {id: mapping.target}) : null;
        if (record && mapping.digest === digest && mapping.version === VERSION) return;
        if (!record) { record = new Record(tx.findCollectionByNameOrId(collection)); outcome = "created"; }
        else outcome = "updated";
        record.load(values);
        // Autodate fields deliberately ignore set(); setRaw preserves the
        // upstream publication date without changing the collection schema.
        record.setRaw("created", createdAt.replace("T", " "));
        record.set("@noNotifications", true);
        tx.save(record);
        if (kind === "issue") {
            // The native create hook sets lastActivity to now; restore the source date.
            record.set("lastActivity", date(item.updated_at));
            record.set("@noNotifications", true);
            tx.save(record);
        }
        saveState(tx, name, {target: record.id, digest: digest, sourceId: item.id, source: source, version: VERSION});
        if (kind === "issue") saveState(tx, "discussion:" + record.id, {source: source, sourceId: item.id});
    });
    return outcome;
}
function syncRepository(app, cfg, budget) {
    const source = sourceName(cfg.source);
    const project = first(app, "projects", "name={:name}", {name: cfg.project});
    if (!project) throw new Error("Target project is missing");
    const repo = first(app, "repositories", "project={:project} && name={:name}", {project: project.id, name: cfg.repository});
    if (!repo || repo.getBool("private") || cfg.private) throw new Error("Only explicitly public repositories may be mirrored");
    const metadata = getGithub(app, "/repos/" + source, budget);
    if (metadata.private !== false || String(metadata.full_name).toLowerCase() !== source.toLowerCase()) throw new Error("Source repository is not the expected public repository");
    const releases = githubPages(app, source, "releases", budget).filter(r => !r.draft && r.published_at);
    const issues = githubPages(app, source, "issues", budget).filter(i => !i.pull_request);
    const category = ensureCategory(app, project);
    const channel = first(app, "channels", "repository={:id} && name='default'", {id: repo.id});
    if (!channel) throw new Error("Default release channel is missing");
    const counts = {releases: releases.length, issues: issues.length, created: 0, updated: 0, unchanged: 0};
    for (const release of releases) {
        if (typeof release.tag_name !== "string" || !release.tag_name || release.tag_name.length > 100) throw new Error("Unsupported release tag");
        const old = first(app, "releases", "channel.repository={:repo} && tag={:tag}", {repo: repo.id, tag: release.tag_name});
        const mapping = state(app, "release:" + source + ":" + release.id);
        if (old && (!mapping || mapping.target !== old.id)) throw new Error("Existing local release conflicts with GitHub tag " + release.tag_name);
        const outcome = upsert(app, source, "release", release, {channel: channel.id, tag: release.tag_name, draft: false,
            content: releaseContent(source, release), meta: {github: {id: release.id, url: release.html_url, prerelease: !!release.prerelease}}});
        counts[outcome]++;
    }
    for (const issue of issues) {
        const labelIds = [];
        for (const label of (issue.labels || []).slice(0, 15)) {
            const name = String(label.name || label).slice(0, 100);
            const color = /^[0-9a-fA-F]{6}$/.test(label.color || "") ? "#" + label.color : "#6b7280";
            const record = ensure(app, "labels", "project={:project} && name={:name}", {project: project.id, name: name},
                {project: project.id, name: name, color: color});
            labelIds.push(record.id);
        }
        const outcome = upsert(app, source, "issue", issue, {category: category.id, author: botId(),
            title: ("[GitHub #" + issue.number + "] " + issue.title).slice(0, 300), content: issueContent(source, issue),
            closed: issue.state === "closed", locked: true, private: false, labels: labelIds});
        counts[outcome]++;
    }
    return {source: source, status: "ok", checkedAt: new Date().toISOString(), counts: counts};
}
function run(app, options) {
    // Optional fixture transport is only used by the isolated integration tests.
    // Public routes never accept these options from an HTTP request.
    const cfg = options && options.config ? validateConfig(options.config) : config();
    setup(app);
    const now = Date.now();
    app.runInTransaction(tx => {
        const lease = state(tx, "lease");
        if (lease && lease.until > now) throw new Error("GitHub sync is already running");
        saveState(tx, "lease", {until: now + 20 * 60 * 1000});
    });
    const results = [], budget = {count: 0, request: options && options.request};
    try {
        // Failed repositories are retried first, preventing starvation under rate limits.
        const entries = cfg.repositories.slice().sort((a, b) => {
            const x = state(app, "repo:" + sourceName(a.source));
            const y = state(app, "repo:" + sourceName(b.source));
            return Number(x && x.status === "ok") - Number(y && y.status === "ok");
        });
        for (const entry of entries) {
            const source = sourceName(entry.source);
            let result;
            try { result = syncRepository(app, entry, budget); }
            catch (error) { result = {source: source, status: "error", checkedAt: new Date().toISOString(), error: String(error)}; }
            saveState(app, "repo:" + source, result);
            results.push(result);
        }
        const report = {version: VERSION, completedAt: new Date().toISOString(), requests: budget.count, repositories: results};
        saveState(app, "latest", report);
        app.logger().info("GitHub metadata sync completed", "requests", budget.count, "errors", results.filter(r => r.status !== "ok").length);
        return report;
    } finally { saveState(app, "lease", {until: 0}); }
}
function status(app) {
    if (!app.findAllCollections("base").some(c => c.name === STATE)) return {status: "not_started"};
    return state(app, "latest") || {status: "not_started"};
}
function guard(e) {
    // The server-side sync uses app.save(), never these client API request hooks.
    if (e.hasSuperuserAuth()) return e.next();
    const ready = hasState(e.app);
    let records = [e.record, e.record.original()];
    if (e.record.collection().name === "comments") {
        records = records.map(r => first(e.app, "discussions", "id={:id}", {id: r.getString("discussion")}));
    }
    for (const record of records) {
        if (!record) continue;
        if (record.getString("author") === botId() || (ready && (state(e.app, "discussion:" + record.id) || state(e.app, "category-id:" + record.getString("category"))))) {
            throw new ForbiddenError("This issue is mirrored from GitHub. Please reply or edit it on GitHub.");
        }
    }
    return e.next();
}
function guardCategory(e) {
    if (e.hasSuperuserAuth() || !hasState(e.app) || !state(e.app, "category-id:" + e.record.id)) return e.next();
    if (e.request.method === "DELETE" || !e.record.getBool("locked") || e.record.getString("project") !== e.record.original().getString("project")) {
        throw new ForbiddenError("Keep the imported category locked and in its original project.");
    }
    return e.next();
}
module.exports = {config, validateConfig, run, status, guard, guardCategory, botId, sourceName, releaseContent, issueContent, githubUrl, upsert, header, setup, ensureCategory, getGithub, githubPages};
