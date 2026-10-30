const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
global.$security = {sha256: value => crypto.createHash('sha256').update(value).digest('hex')};
global.ForbiddenError = class ForbiddenError extends Error {};
const sync = require('../pb_hooks/github-sync.js');
const hash = value => $security.sha256(value).slice(0,15);
function record(values, original=values, collection='discussions') {
    return {id:values.id,collection:()=>({name:collection}),getString:k=>String(values[k]||''),getBool:k=>!!values[k],original:()=>record(original, original, collection)};
}
function app(state={}, records={}) {
    return {
        findAllCollections:()=>Object.keys(state).length ? [{name:'githubSyncState'}] : [],
        findRecordsByFilter:(collection,filter,sort,limit,offset,params)=>{
            if(collection==='discussions') return records[params.id] ? [records[params.id]] : [];
            const key = Object.keys(state).find(k=>hash(k)===params.id);
            return key ? [{getString:()=>JSON.stringify(state[key])}] : [];
        },
    };
}
function event(rec, database, superuser=false, method='PATCH') {
    return {record:rec,app:database,hasSuperuserAuth:()=>superuser,request:{method},next:()=> 'allowed'};
}
test('renaming an imported category does not remove its protection',()=>{
    const rec=record({id:'issue',category:'stable-id',author:'somebody'});
    assert.throws(()=>sync.guard(event(rec, app({'category-id:stable-id':{project:'project'}}))),ForbiddenError);
});
test('moving an imported issue out of its category does not unlock it',()=>{
    const rec=record({id:'issue',category:'other',author:'somebody'},{id:'issue',category:'old',author:sync.botId()});
    assert.throws(()=>sync.guard(event(rec, app())),ForbiddenError);
});
test('import mapping protects an issue even if its author was changed administratively',()=>{
    const rec=record({id:'issue',category:'other',author:'somebody'});
    assert.throws(()=>sync.guard(event(rec, app({'discussion:issue':{source:'example/app'}}))),ForbiddenError);
});
test('moving a comment away from a mirrored issue cannot bypass the guard',()=>{
    const rec=record({id:'comment',discussion:'native'},{id:'comment',discussion:'imported'},'comments');
    const db=app({}, {imported:record({id:'imported',author:sync.botId()}),native:record({id:'native',author:'visitor'})});
    assert.throws(()=>sync.guard(event(rec,db)),ForbiddenError);
});
test('native discussions work before the first sync and superusers can maintain imports',()=>{
    assert.equal(sync.guard(event(record({id:'native',author:'visitor'}),app())), 'allowed');
    assert.equal(sync.guard(event(record({id:'imported',author:sync.botId()}),app(),true)), 'allowed');
});
test('managed category can be renamed but not unlocked, moved or deleted',()=>{
    const db=app({'category-id:category':{project:'project'}});
    const old={id:'category',project:'project',locked:true,name:'GitHub issues'};
    assert.equal(sync.guardCategory(event(record({...old,name:'Renamed'},old,'categories'),db)),'allowed');
    for(const change of [{locked:false},{project:'other'}]) {
        assert.throws(()=>sync.guardCategory(event(record({...old,...change},old,'categories'),db)),ForbiddenError);
    }
    assert.throws(()=>sync.guardCategory(event(record(old,old,'categories'),db,false,'DELETE')),ForbiddenError);
});
