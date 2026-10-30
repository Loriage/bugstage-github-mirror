"""Exercise real BugStage hooks and API rules in a uniquely named disposable container."""
import json
import datetime
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
IMAGE = os.environ.get('BUGSTAGE_TEST_IMAGE', 'bugstage-github-mirror:test')


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True, stderr=subprocess.STDOUT).strip()


def main():
    name = 'bugstage-mirror-test-' + uuid.uuid4().hex[:10]
    with tempfile.TemporaryDirectory(prefix='bugstage-mirror-test-') as temporary:
        path = Path(temporary)
        hooks = path / 'hooks'
        shutil.copytree(ROOT / 'pb_hooks', hooks)
        shutil.copy2(ROOT / 'tests/integration/fixture.pb.js', hooks / 'fixture.pb.js')
        (hooks / 'github-sync.config.json').write_text('{"schedule_enabled":false,"repositories":[]}')
        credential = path / 'admin.json'
        password = secrets.token_urlsafe(32)
        credential.write_text(json.dumps({'email':'admin@example.invalid','password':password}))
        credential.chmod(0o600)
        started = False
        try:
            docker('run','-d','--name',name,'--label','bugstage-mirror.disposable-test=true',
                '-p','127.0.0.1::8090','--tmpfs','/app/pb_data',
                '-v',str(hooks)+':/app/pb_hooks:ro',
                '-v',str(credential)+':/run/secrets/admin_credentials:ro',IMAGE)
            started = True
            port = docker('port',name,'8090/tcp').rsplit(':',1)[1]
            base = 'http://127.0.0.1:' + port
            token = ''

            def api(method, endpoint, data=None, auth=None):
                request = urllib.request.Request(base+endpoint,
                    data=json.dumps(data).encode() if data is not None else None,
                    headers={'Content-Type':'application/json','Authorization':token if auth is None else auth},method=method)
                try:
                    with urllib.request.urlopen(request,timeout=30) as response:
                        body=response.read()
                        return response.status,json.loads(body) if body else None
                except urllib.error.HTTPError as error:
                    return error.code,json.loads(error.read())

            def good(method, endpoint, data=None, auth=None):
                code,body=api(method,endpoint,data,auth)
                if code>=300:
                    # Never include authentication request or response bodies in diagnostics.
                    detail = '' if 'auth-' in endpoint else ' ' + json.dumps(body)
                    raise AssertionError(f'{method} {endpoint}: HTTP {code}{detail}')
                return body

            for _ in range(60):
                try:
                    good('GET','/api/health'); break
                except Exception:
                    time.sleep(1)
            else:
                raise AssertionError('Disposable BugStage did not become healthy')
            token=good('POST','/api/collections/_superusers/auth-with-password',{'identity':'admin@example.invalid','password':password})['token']
            project=good('POST','/api/collections/projects/records',{'name':'fixture','title':'Fixture','description':'Integration test','accentColor':'#5264db'})
            good('POST','/api/collections/repositories/records',{'project':project['id'],'name':'fixture','private':False})
            first=good('POST','/api/mirror-test/run',{'mode':'open'})
            assert first['repositories'][0]['status']=='ok',first
            assert first['repositories'][0]['counts']['created']==2,first
            repeat=good('POST','/api/mirror-test/run',{'mode':'cached'})
            assert repeat['repositories'][0]['counts']['unchanged']==2,repeat
            issues=good('GET','/api/collections/discussions/records?perPage=100')['items']
            releases=good('GET','/api/collections/releases/records?perPage=100')['items']
            assert len(issues)==len(releases)==1
            issue=issues[0]; release=releases[0]
            assert 'https://github.com/example/fixture/issues/12' in issue['content']
            assert '<code>#56</code>' in issue['content']
            assert len(release['content'])<=5000 and 'fixture.zip' in release['content']
            assert issue['created'].startswith('2020-01-02') and release['created'].startswith('2020-01-02')
            for mode,closed in [('closed',True),('open',False)]:
                report=good('POST','/api/mirror-test/run',{'mode':mode})
                assert report['repositories'][0]['status']=='ok',report
                current=good('GET','/api/collections/discussions/records/'+issue['id'])
                assert current['closed']==closed and current['created']==issue['created']
            category=good('GET','/api/collections/categories/records/'+issue['category'])
            good('PATCH','/api/collections/categories/records/'+category['id'],{'name':'Renamed imports'})
            report=good('POST','/api/mirror-test/run',{'mode':'open'})
            assert report['repositories'][0]['status']=='ok',report
            current=good('GET','/api/collections/discussions/records/'+issue['id'])
            assert current['category']==category['id']
            for collection in ['releaseNotifications','discussionNotifications','commentNotifications']:
                assert good('GET','/api/collections/'+collection+'/records?perPage=1')['totalItems']==0

            # Notification opt-in establishes a silent baseline, then alerts only
            # project/channel subscribers for new releases. No SMTP is configured.
            subscribers = {}
            for name, subscription, email in [('release-subscriber','channels',True),('release-inapp','projects',False),('release-unsubscribed',None,True)]:
                secret=secrets.token_urlsafe(32)
                user=good('POST','/api/collections/users/records',{'username':name,'email':name+'@example.invalid','password':secret,'passwordConfirm':secret})
                subscribers[name]=user['id']
                prefs=next(p for p in good('GET','/api/collections/notificationSettings/records?perPage=100')['items'] if p['user']==user['id'])
                payload={'emailNotifications':email}
                if subscription: payload[subscription]=[release['channel'] if subscription=='channels' else project['id']]
                good('PATCH','/api/collections/notificationSettings/records/'+prefs['id'],payload)
            good('POST','/api/mirror-test/run',{'notify':True})
            assert good('GET','/api/collections/releaseNotifications/records?perPage=1')['totalItems']==0
            good('POST','/api/mirror-test/run',{'notify':True,'extraRelease':{'id':701,'published_at':'2020-01-02T03:04:05Z'}})
            assert good('GET','/api/collections/releaseNotifications/records?perPage=1')['totalItems']==0
            publication=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=1)).isoformat()
            fresh={'id':702,'published_at':publication}
            good('POST','/api/mirror-test/run',{'notify':True,'extraRelease':fresh,'extraIssue':True})
            alerts=good('GET','/api/collections/releaseNotifications/records?perPage=100')['items']
            assert len(alerts)==3,alerts  # original maintainer + the two opted-in accounts
            assert not any(a['user']==subscribers['release-unsubscribed'] for a in alerts)
            assert next(a for a in alerts if a['user']==subscribers['release-inapp'])['processed'] is True
            assert next(a for a in alerts if a['user']==subscribers['release-subscriber'])['processed'] is False
            for update in [fresh,{**fresh,'body':'Updated notes'}, {**fresh,'body':'Updated notes'}]:
                good('POST','/api/mirror-test/run',{'notify':True,'extraRelease':update})
                assert good('GET','/api/collections/releaseNotifications/records?perPage=1')['totalItems']==3
            assert good('GET','/api/collections/discussionNotifications/records?perPage=1')['totalItems']==0
            good('POST','/api/mirror-test/run',{'notify':False,'extraRelease':{'id':703,'published_at':publication}})
            good('POST','/api/mirror-test/run',{'notify':True,'extraRelease':{'id':704,'published_at':publication}})
            assert good('GET','/api/collections/releaseNotifications/records?perPage=1')['totalItems']==3
            good('POST','/api/mirror-test/run',{'notify':True,'extraRelease':{'id':705,'published_at':publication}})
            assert good('GET','/api/collections/releaseNotifications/records?perPage=1')['totalItems']==6
            for role in ['visitor','maintainer']:
                secret=secrets.token_urlsafe(32)
                user=good('POST','/api/collections/users/records',{'username':role,'email':role+'@example.invalid','password':secret,'passwordConfirm':secret,'verified':True})
                if role=='maintainer': good('POST','/api/collections/maintainers/records',{'user':user['id']})
                auth=good('POST','/api/collections/users/auth-with-password',{'identity':user['email'],'password':secret})['token']
                for method,endpoint,data in [
                    ('PATCH','/api/collections/discussions/records/'+issue['id'],{'title':'Forbidden'}),
                    ('POST','/api/collections/comments/records',{'discussion':issue['id'],'author':user['id'],'content':'Forbidden'}),
                    ('PATCH','/api/collections/categories/records/'+category['id'],{'locked':False}),
                    ('DELETE','/api/collections/categories/records/'+category['id'],None),
                ]:
                    code,_=api(method,endpoint,data,auth)
                    assert code in [400,403,404],(role,method,endpoint,code)
                native_category=next(c for c in good('GET','/api/collections/categories/records?perPage=100')['items'] if not c['locked'])
                native=good('POST','/api/collections/discussions/records',{'category':native_category['id'],'author':user['id'],'title':'Native '+role,'content':'Allowed'},auth)
                good('POST','/api/collections/comments/records',{'discussion':native['id'],'author':user['id'],'content':'Allowed'},auth)
                for endpoint in ['/api/github-sync/status','/api/collections/githubSyncState/records']:
                    assert api('GET',endpoint,auth=auth)[0] in [401,403]
            for endpoint in ['/api/github-sync/status','/api/collections/githubSyncState/records']:
                assert api('GET',endpoint,auth='')[0] in [401,403]
            assert api('POST','/api/github-sync/run',{},auth='')[0] in [401,403]
            private=good('POST','/api/mirror-test/run',{'mode':'private'})
            assert private['repositories'][0]['status']=='error'
            limited=good('POST','/api/mirror-test/run',{'mode':'rate-limit'})
            assert 'rate limit' in limited['repositories'][0]['error']
            cooldown=good('POST','/api/mirror-test/run',{'mode':'open'})
            assert cooldown['requests']==0 and cooldown['repositories'][0]['status']=='error'
            print('PASS: real JSVM, first import, cache, idempotence, state transitions, dates, Markdown, renamed categories, API permissions, native participation, opt-in release notifications, subscription and email preferences, no local mention alerts, silent history/issues/updates, re-enable baseline, private sources, rate-limit cooldown.')
        finally:
            if started:
                docker('rm','-f',name)


if __name__=='__main__':
    main()
