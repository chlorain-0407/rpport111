import assert from 'node:assert/strict';
import test from 'node:test';
import { memberCollection, memberDatabase, deleteMemberRecords, memberCollections } from '../src/server/memberData';

test('every member query requires the verified UUID, including forged filters', async () => {
  const calls: any[] = [];
  const raw: any = Object.fromEntries(['find','findOne','countDocuments','deleteOne','deleteMany','updateOne','insertMany','insertOne']
    .map(method => [method, (...args: any[]) => { calls.push({method,args}); return {ok:true}; }]));
  const member = memberCollection(raw,'member-A');
  for (const method of ['find','findOne','countDocuments','deleteOne','deleteMany']) {
    (member as any)[method]({userUuid:'member-B',id:'same-id'});
    assert.deepEqual(calls.at(-1).args[0],{$and:[{userUuid:'member-B',id:'same-id'},{userUuid:'member-A'}]});
  }
  member.insertMany([{id:'same-id',userUuid:'member-B'}]);
  assert.equal(calls.at(-1).args[0][0].userUuid,'member-A');
  member.updateOne({id:'same-id'},{$set:{userUuid:'member-B',title:'new'}},{upsert:true});
  assert.equal(calls.at(-1).args[1].$set.userUuid,'member-A');
  assert.deepEqual(calls.at(-1).args[0],{$and:[{id:'same-id'},{userUuid:'member-A'}]});
  assert.throws(()=>member.updateOne({},{$unset:{userUuid:1}}));
  assert.throws(()=>(member as any).aggregate([]));
});

test('platform collections are separate from legacy data and unknown operations fail closed', () => {
  const names: string[] = [];
  const raw: any = {collection:(name:string)=>{names.push(name); return {findOne:()=>null};}};
  const legacy = memberDatabase(raw, {academy:null} as any);
  assert.equal(legacy,raw);
  const platform = memberDatabase(raw,{academy:{user:{uuid:'member-A'}}} as any);
  platform.collection('reports').findOne({});
  assert.deepEqual(names,['member_reports']);
  assert.throws(()=>platform.collection('unlisted'));
  assert.throws(()=>(platform as any).dropDatabase());
});

test('erasure includes all owned collections, scopes every delete and supports retry', async () => {
  const calls: any[]=[];
  const raw: any={collection:(name:string)=>({deleteMany:async(query:any)=>calls.push({name,query})})};
  await deleteMemberRecords(raw,'member-A');
  await deleteMemberRecords(raw,'member-A');
  assert.equal(calls.length, memberCollections.length*2);
  assert.ok(calls.every(c=>c.name.startsWith('member_') && c.query.userUuid==='member-A'));
  await assert.rejects(()=>deleteMemberRecords(raw,''));
});
