// ONLY mounted into the disposable integration-test container. Never install this hook.
routerAdd('POST', '/api/mirror-test/run', e => {
    const mode = e.requestInfo().body.mode || 'open';
    const extra = e.requestInfo().body.extraRelease;
    const extraIssue = e.requestInfo().body.extraIssue;
    const sync = require(__hooks + '/github-sync.js');
    const report = sync.run(e.app, {
        config: {schedule_enabled:false,notify_new_releases:e.requestInfo().body.notify === true,
            repositories:[{source:'https://github.com/example/fixture.git',project:'fixture',repository:'fixture',private:false}]},
        request: req => {
            if (mode === 'rate-limit') return {statusCode:429,headers:{'Retry-After':['60']},json:{}};
            if (mode === 'cached') return {statusCode:304,headers:{},json:null};
            let body;
            if (req.url.indexOf('/releases?') >= 0) {
                body=[{id:700,tag_name:'v1.0',name:'Fixture release',html_url:'https://github.com/example/fixture/releases/tag/v1.0',
                    created_at:'2020-01-02T03:04:05Z',published_at:'2020-01-02T03:04:05Z',updated_at:'2020-01-02T03:04:05Z',
                    draft:false,prerelease:false,body:'```text\n'+'x'.repeat(8000)+'\n```',assets:[{name:'fixture.zip',state:'uploaded',browser_download_url:'https://github.com/example/fixture/releases/download/v1.0/fixture.zip'}]}];
                if (extra) body.push({id:extra.id,tag_name:'v2.'+extra.id,name:'New release',
                    html_url:'https://github.com/example/fixture/releases/tag/v2.'+extra.id,
                    created_at:extra.published_at,published_at:extra.published_at,updated_at:extra.published_at,
                    draft:false,prerelease:false,body:extra.body || 'Thanks @release-unsubscribed',assets:[]});
            } else if(req.url.indexOf('/issues?') >= 0) {
                body=[{id:800,number:101,title:'Fixture issue',html_url:'https://github.com/example/fixture/issues/101',
                    created_at:'2020-01-02T03:04:05Z',updated_at:mode==='closed'?'2020-03-04T05:06:07Z':'2020-02-03T04:05:06Z',
                    state:mode==='closed'?'closed':'open',body:'Related: #12 and other/repo#34. `#56` stays code.',user:{login:'octocat'},comments:2,labels:[{name:'bug',color:'ff0000'}]},
                    {id:801,pull_request:{},number:102,title:'Exclude this PR'}];
                if (extraIssue) body.push({...body[0],id:802,number:103,title:'A new issue stays silent',html_url:'https://github.com/example/fixture/issues/103'});
            } else {
                body={private:mode==='private',full_name:'example/fixture'};
            }
            return {statusCode:200,headers:{ETag:['"fixture"']},json:body};
        },
    });
    return e.json(200,report);
},$apis.requireAuth('_superusers'));
