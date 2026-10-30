const test = require('node:test');
const assert = require('node:assert/strict');
const markdown = require('../pb_hooks/vendor/source-markdown.js');
const sync = require('../pb_hooks/github-sync.js');
const source = 'example/app';
const url = 'https://github.com/example/app/issues/10';
const render = text => markdown.render(source, text, url, 'main');

test('GitHub references point upstream, including cross-repository references', () => {
    const html = render('Fixes #123 and other/repo#456.');
    assert.match(html, /href="https:\/\/github.com\/example\/app\/issues\/123"/);
    assert.match(html, /href="https:\/\/github.com\/other\/repo\/issues\/456"/);
});
test('code, existing links, URL fragments and image alt text are not rewritten', () => {
    const html = render('`#123`\n\n```sh\necho #456\n```\n\n[#12](https://example.org/#12) ![#22](image.png)');
    assert.match(html, /<code>#123<\/code>/);
    assert.match(html, /echo #456/);
    assert.match(html, /href="https:\/\/example.org\/#12"/);
    assert.doesNotMatch(html, /\/issues\//);
    assert.match(html, /alt="#22"/);
});
test('relative links and images resolve against the original repository', () => {
    const html = render('[guide](./docs/guide.md) ![icon](images/icon.png) [section](#usage)');
    assert.match(html, /github.com\/example\/app\/blob\/main\/docs\/guide.md/);
    assert.match(html, /raw.githubusercontent.com\/example\/app\/main\/images\/icon.png/);
    assert.match(html, /issues\/10#usage/);
});
test('source HTML and dangerous link schemes cannot inject active HTML', () => {
    const html = render('<script>alert(1)</script> [x](javascript:alert(1))');
    assert.doesNotMatch(html, /<script|href="javascript:/);
    assert.match(html, /&lt;script&gt;/);
});
test('long fenced blocks produce a bounded plain-text excerpt', () => {
    const result = markdown.fit(source, '```text\n' + '<x>'.repeat(5000) + '\n```', url, 'main', 500);
    assert.equal(result.truncated, true);
    assert.ok(result.content.length <= 500);
    assert.ok(result.content.endsWith('</p>\n'));
    assert.doesNotMatch(result.content, /<pre>|<code>|<x>/);
});
test('short valid Markdown keeps full formatting', () => {
    const result = markdown.fit(source, '**hello**\n\n```js\nlet x = 1;\n```', url, 'main', 4000);
    assert.equal(result.truncated, false);
    assert.match(result.content, /<strong>hello<\/strong>/);
    assert.match(result.content, /<pre><code/);
});
test('release size and download links survive oversized notes', () => {
    const body = sync.releaseContent(source, {
        tag_name: 'v1.0', name: 'v1.0', html_url: 'https://github.com/example/app/releases/tag/v1.0',
        published_at: '2026-01-02T03:04:05Z', body: '```txt\n' + 'x'.repeat(10000) + '\n```',
        assets: [{state:'uploaded',name:'app.zip',browser_download_url:'https://github.com/example/app/releases/download/v1.0/app.zip'}],
    });
    assert.ok(body.length <= 5000);
    assert.match(body, /<\/p>[\s\S]*## Downloads/);
    assert.match(body, /\[app.zip\]\(https:\/\/github.com\/example\/app\/releases\/download\/v1.0\/app.zip\)/);
    assert.match(body, /Read the full release notes on GitHub/);
});
test('issue header is explicitly linked and labels cannot inject Markdown', () => {
    const body = sync.issueContent(source, {
        number:106, html_url:url, state:'closed', created_at:'2020-01-02T03:04:05Z', updated_at:'2020-02-03T04:05:06Z',
        user:{login:'octocat'}, body:'See #5', labels:[{name:'[x](bad)'}], comments:2,
    });
    assert.match(body, /\[GitHub issue #106\]\(https:\/\/github.com\/example\/app\/issues\/10\)/);
    assert.match(body, /issues\/5/);
    assert.match(body, /\*\*Closed\*\*/);
    assert.match(body, /Labels: \\\[x\\\]/);
});
test('source download links cannot escape the configured repository', () => {
    assert.throws(() => sync.githubUrl('https://evil.example/file', source));
    assert.throws(() => sync.githubUrl('https://github.com/example/application/file', source));
});
test('config rejects private, duplicate and ambiguous destinations', () => {
    const entry = {source:'https://github.com/example/app.git',project:'app',repository:'app',private:false};
    assert.doesNotThrow(() => sync.validateConfig({schedule_enabled:true,repositories:[entry]}));
    assert.throws(() => sync.validateConfig({schedule_enabled:true,repositories:[{...entry,private:true}]}));
    assert.throws(() => sync.validateConfig({schedule_enabled:true,repositories:[entry,entry]}));
    assert.throws(() => sync.validateConfig({schedule_enabled:true,repositories:[{...entry,project:'../app'}]}));
    assert.throws(() => sync.validateConfig({schedule_enabled:true,notify_new_releases:'true',repositories:[entry]}));
});
test('release notifications require opt-in and a completed baseline, never older publications', () => {
    const policy = {enabled:true, since:'2026-01-01T00:00:00Z'};
    const fresh = {published_at:'2026-01-02T00:00:00Z'};
    assert.equal(sync.shouldNotifyRelease(false, policy, fresh), false);
    assert.equal(sync.shouldNotifyRelease(true, null, fresh), false);
    assert.equal(sync.shouldNotifyRelease(true, {enabled:false}, fresh), false);
    assert.equal(sync.shouldNotifyRelease(true, policy, {published_at:policy.since}), false);
    assert.equal(sync.shouldNotifyRelease(true, policy, {published_at:'2020-01-01T00:00:00Z'}), false);
    assert.equal(sync.shouldNotifyRelease(true, {enabled:true,since:'invalid'}, fresh), false);
    assert.equal(sync.shouldNotifyRelease(true, policy, fresh), true);
});
