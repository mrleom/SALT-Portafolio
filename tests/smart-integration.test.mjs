import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../backend/handler.mjs';
import { createMemoryStore, seedLocalAssets, localUserId } from '../backend/store-memory.mjs';
import { createImageAccessHandler } from '../backend/image-access-handler.mjs';
import { createDynamoStore } from '../backend/store-dynamo.mjs';
import { computeDepreciation, toPublic } from '../backend/assets.mjs';
const config={clientId:'client',issuer:'issuer',requiredScope:'salt/read',origin:'https://frontend.example.invalid'};
function event(group,resource,method='GET',body,id='local-asset-1'){
 return {resource,httpMethod:method,pathParameters:{id},body:body===undefined?undefined:JSON.stringify(body),
 requestContext:{authorizer:{claims:{sub:localUserId(group),iss:'issuer',client_id:'client',token_use:'access',scope:'salt/read',exp:Math.floor(Date.now()/1000)+60,'cognito:groups':[group]}}}};
}
async function setup(){const store=createMemoryStore();await seedLocalAssets(store);return {store,handler:createHandler({...config,store})};}
test('useful life consumed reaches 50 percent halfway and caps at 100 percent',()=>{
 const asset={purchaseValue:1500,salvageValue:100,usefulLifeYears:4,purchaseDate:'2024-01-01'};
 assert.equal(computeDepreciation(asset,new Date('2026-01-01')).usefulLifeConsumed,50);
 const old=computeDepreciation(asset,new Date('2034-01-01'));
 assert.equal(old.usefulLifeConsumed,100);assert.equal(old.currentBookValue,100);
 assert.equal(toPublic(asset).expectedReplacementDate,'2028-01-01');
});
test('Manager departments are normalized while unrelated departments remain inaccessible',async()=>{
 const {store,handler}=await setup();await store.putProfile({PK:'USER#local-manager',SK:'PROFILE',department:'  oPeRaTiOnS  '});
 const list=JSON.parse((await handler(event('Manager','/assets'))).body).assets;
 assert.equal(list.length,4);assert.ok(list.every(a=>a.department==='Operations'));
 assert.equal((await handler(event('Manager','/assets/{id}'))).statusCode,403);
 await store.putProfile({PK:'USER#local-manager',SK:'PROFILE',department:''});
 assert.equal(JSON.parse((await handler(event('Manager','/assets'))).body).assets.length,0);
});
test('maintenance and audit history persist together; Auditor cannot write',async()=>{
 const {store,handler}=await setup();
 const body={maintenanceType:'Repair',performedDate:'2026-01-01',notes:'Replaced failed fan',cost:35,intervalDays:90};
 assert.equal((await handler(event('Auditor','/assets/{id}/maintenance','POST',body))).statusCode,403);
 assert.equal((await handler(event('Technician','/assets/{id}/maintenance','POST',body))).statusCode,201);
 assert.equal((await store.getAsset('local-asset-1')).repairCount,1);
 assert.equal((await store.getAsset('local-asset-1')).nextMaintenanceDate,'2026-04-01');
 const history=JSON.parse((await handler(event('Auditor','/assets/{id}/history'))).body).records;
 assert.equal(history.length,1);assert.equal(history[0].action,'MaintenanceRecorded');
 assert.equal(JSON.parse((await handler(event('Employee','/assets/{id}/maintenance'))).body).records.length,1);
 assert.equal((await handler(event('Employee','/assets/{id}/history'))).statusCode,403);
 assert.equal((await handler(event('Technician','/assets/{id}/maintenance','POST',{...body,performedDate:'2026-02-30'}))).statusCode,400);
});
test('reports respect assignment and department; only Administrator updates status',async()=>{
 const {handler}=await setup();
 assert.equal((await handler(event('Employee','/assets/{id}/reports','POST',{description:'Broken screen'},'local-asset-4'))).statusCode,403);
 const response=await handler(event('Employee','/assets/{id}/reports','POST',{description:'Broken screen'}));assert.equal(response.statusCode,201);
 const report=JSON.parse(response.body);
 assert.equal(JSON.parse((await handler(event('Manager','/reports'))).body).reports.length,0);
 assert.equal(JSON.parse((await handler(event('Auditor','/reports'))).body).reports.length,1);
 assert.equal((await handler(event('Employee','/assets/{id}/reports-status','POST',{recordId:report.recordId,status:'Resolved'}))).statusCode,403);
 assert.equal((await handler(event('Administrator','/assets/{id}/reports-status','POST',{recordId:report.recordId,status:'Resolved'}))).statusCode,200);
});
test('saved photographs follow asset visibility and reject unauthenticated requests',async()=>{
 const {store}=await setup();const asset=await store.getAsset('local-asset-1');
 await store.putAsset({...asset,photoKey:'asset-photos/local-technician/test.jpg'});
 let signed=0;const handler=createImageAccessHandler({...config,store,service:{createStoredReadUrl:async()=>{signed++;return {url:'https://private.example.invalid/photo',expiresIn:60};}}});
 assert.equal((await handler(event('Auditor','/assets/{id}/photo'))).statusCode,200);
 assert.equal((await handler(event('Employee','/assets/{id}/photo'))).statusCode,200);
 assert.equal((await handler(event('Manager','/assets/{id}/photo'))).statusCode,403);
 const unsigned=event('Auditor','/assets/{id}/photo');delete unsigned.requestContext.authorizer;
 assert.equal((await handler(unsigned)).statusCode,401);assert.equal(signed,2);
});
test('photo ownership and merged financial fields are validated',async()=>{
 const {handler}=await setup();
 assert.equal((await handler(event('Administrator','/assets/{id}','PATCH',{photoKey:'asset-photos/local-technician/other.jpg'}))).statusCode,403);
 assert.equal((await handler(event('Administrator','/assets/{id}','PATCH',{purchaseValue:50}))).statusCode,400);
 const response=await handler(event('Administrator','/assets/{id}','PATCH',{description:'Reviewed manually',aiReviewStatus:'UserCorrected'}));
 assert.equal(response.statusCode,200);assert.equal(JSON.parse(response.body).aiReviewStatus,'UserCorrected');
 assert.equal((await handler(event('Technician','/assets/{id}','PATCH',[]))).statusCode,400);
});
test('DynamoDB commits the asset and audit atomically and detects concurrent writes',async()=>{
 let command;const store=createDynamoStore('Assets',{send:async c=>{command=c;return {};}});
 await store.commitAsset({PK:'ASSET#a',SK:'METADATA',updatedAt:'new'},[{PK:'ASSET#a',SK:'AUDIT#1'}],'old');
 assert.equal(command.constructor.name,'TransactWriteCommand');assert.equal(command.input.TransactItems.length,2);
 assert.equal(command.input.TransactItems[0].Put.ExpressionAttributeValues[':previous'],'old');
 const conflicts=createDynamoStore('Assets',{send:async()=>{throw Object.assign(new Error(),{name:'TransactionCanceledException'});}});
 await assert.rejects(conflicts.commitAsset({PK:'ASSET#a',SK:'METADATA'},[],'old'),{statusCode:409});
});
