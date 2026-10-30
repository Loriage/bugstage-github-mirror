// Public GitHub metadata -> BugStage. No GitHub write credentials are used.
cronAdd("github-metadata-sync", "17,47 * * * *", () => {
    const sync = require(__hooks + "/github-sync.js");
    if (sync.config().schedule_enabled) sync.run($app);
});

routerAdd("POST", "/api/github-sync/run", (e) => {
    if (!e.hasSuperuserAuth()) throw new ForbiddenError("Administrator access required.");
    return e.json(200, require(__hooks + "/github-sync.js").run(e.app));
}, $apis.requireAuth("_superusers"));

routerAdd("GET", "/api/github-sync/status", (e) => {
    if (!e.hasSuperuserAuth()) throw new ForbiddenError("Administrator access required.");
    return e.json(200, require(__hooks + "/github-sync.js").status(e.app));
}, $apis.requireAuth("_superusers"));

onRecordCreateRequest((e) => require(__hooks + "/github-sync.js").guard(e), "discussions", "comments");
onRecordUpdateRequest((e) => require(__hooks + "/github-sync.js").guard(e), "discussions", "comments");
onRecordDeleteRequest((e) => require(__hooks + "/github-sync.js").guard(e), "discussions", "comments");
onRecordUpdateRequest((e) => require(__hooks + "/github-sync.js").guardCategory(e), "categories");
onRecordDeleteRequest((e) => require(__hooks + "/github-sync.js").guardCategory(e), "categories");
onRecordAuthRequest((e) => {
    if (e.record.id === require(__hooks + "/github-sync.js").botId()) {
        throw new ForbiddenError("This account is only used to attribute imported content.");
    }
    return e.next();
}, "users");
