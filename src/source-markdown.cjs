const MarkdownIt = require('markdown-it');
const md = new MarkdownIt({html: false, breaks: true, linkify: false});
const escapeHtml = md.utils.escapeHtml;

function repoPath(path) {
    const segments = [];
    for (const part of path.split('/')) {
        if (part === '..') segments.pop();
        else if (part && part !== '.') segments.push(part);
    }
    return segments.join('/');
}

function resolveLink(href, env, image) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return href;
    if (href.startsWith('#')) return env.url + href;
    const path = repoPath(href);
    const base = image ? 'https://raw.githubusercontent.com/' : 'https://github.com/';
    return base + env.source + (image ? '/' : '/blob/') + encodeURIComponent(env.ref) + '/' + path;
}

// Work on parsed text tokens, so code, links, URL fragments and image alt text
// retain their original meanings. GitHub resolves both issues and PRs at /issues/N.
md.core.ruler.after('inline', 'github_references', state => {
    for (const block of state.tokens) {
        if (block.type !== 'inline') continue;
        const children = [];
        let linkDepth = 0;
        for (const token of block.children || []) {
            if (token.type === 'link_open') {
                linkDepth++;
                token.attrSet('href', resolveLink(token.attrGet('href') || '', state.env, false));
            }
            if (token.type === 'image') {
                token.attrSet('src', resolveLink(token.attrGet('src') || '', state.env, true));
            }
            if (token.type !== 'text' || linkDepth) {
                children.push(token);
            } else {
                const pattern = /(^|[^\w/&#])(?:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+))?#([1-9][0-9]*)\b/g;
                let match, from = 0;
                while ((match = pattern.exec(token.content))) {
                    const start = match.index + match[1].length;
                    if (start > from) {
                        const prefix = new state.Token('text', '', 0);
                        prefix.content = token.content.slice(from, start);
                        children.push(prefix);
                    }
                    const open = new state.Token('link_open', 'a', 1);
                    open.attrSet('href', 'https://github.com/' + (match[2] || state.env.source) + '/issues/' + match[3]);
                    const label = new state.Token('text', '', 0);
                    label.content = token.content.slice(start, pattern.lastIndex);
                    children.push(open, label, new state.Token('link_close', 'a', -1));
                    from = pattern.lastIndex;
                }
                if (from < token.content.length) {
                    const suffix = new state.Token('text', '', 0);
                    suffix.content = token.content.slice(from);
                    children.push(suffix);
                }
            }
            if (token.type === 'link_close') linkDepth--;
        }
        block.children = children;
    }
});

function render(source, input, url, ref) {
    return md.render(String(input || ''), {source, url, ref: ref || 'HEAD'});
}

// Never cut Markdown or HTML in the middle of a construct. Oversized notes use
// a clearly labelled plain-text excerpt, with the full original linked separately.
function fit(source, input, url, ref, limit) {
    const html = render(source, input, url, ref);
    if (html.length <= limit) return {content: html, truncated: false};
    const text = String(input || '');
    const excerpt = n => '<p>' + escapeHtml(text.slice(0, n)).replace(/\r?\n/g, '<br>') + '…</p>\n';
    let low = 0, high = text.length;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (excerpt(mid).length <= limit) low = mid;
        else high = mid - 1;
    }
    // Avoid splitting a UTF-16 surrogate pair.
    if (low && /[\uD800-\uDBFF]/.test(text[low - 1])) low--;
    return {content: limit >= 10 ? excerpt(low) : '', truncated: true};
}

module.exports = {render, fit};
