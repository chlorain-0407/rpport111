import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

test('frontend redirects only platform error codes and shows upgrade URL for points', async () => {
  const source = (await readFile('src/academy.tsx','utf8')).split('export function AcademyStatus')[0]
    .replace(/^import React.*\n/, '');
  const code = (await transform(source,{loader:'tsx',format:'cjs'})).code;
  const redirects:string[]=[];
  const events:any[]=[];
  let reply = {status:401,code:'LOGIN_REQUIRED',login_url:'https://agentgo.tw/login'};
  const context:any={URL,Request,location:{origin:'https://app.example'},window:{
    location:{origin:'https://app.example',href:'https://app.example/',assign:(url:string)=>redirects.push(url)},
    fetch:async()=>new Response(JSON.stringify(reply),{status:reply.status}),
    dispatchEvent:(event:any)=>events.push(event),
  },CustomEvent:class{constructor(public type:string,public options:any){}}};
  vm.runInNewContext(code,context);
  await context.window.fetch('/api/properties');
  assert.deepEqual(redirects,['https://agentgo.tw/login']);
  reply={status:403,code:'SUBSCRIPTION_REQUIRED',subscribe_url:'https://agentgo.tw/subscribe'} as any;
  await context.window.fetch('/api/reports');
  assert.equal(redirects.at(-1),'https://agentgo.tw/subscribe');
  reply={status:402,code:'INSUFFICIENT_POINTS',upgrade_url:'https://agentgo.tw/upgrade'} as any;
  await context.window.fetch('/api/reports');
  assert.equal(events.at(-1).options.detail.upgrade_url,'https://agentgo.tw/upgrade');
  assert.equal(events.at(-1).type,'academy-points-required');
  reply={status:401,code:'LOGIN_REQUIRED',login_url:'javascript:alert(1)'};
  await context.window.fetch('/api/reports');
  assert.equal(redirects.length,2);
});
