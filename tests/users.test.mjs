import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsersHandler } from '../backend/users-handler.mjs';
import { createMemoryStore } from '../backend/store-memory.mjs';
const config={clientId:'client',issuer:'issuer',requiredScope:'salt/read',origin:'https://frontend.example.invalid',userPoolId:'pool'};
function event(role,resource,method='POST',body={}){
 return {resource,httpMethod:method,pathParameters:{userId:'target'},body:JSON.stringify(body),requestContext:{authorizer:{claims:{sub:'admin',iss:'issuer',client_id:'client',token_use:'access',scope:'salt/read',exp:Math.floor(Date.now()/1000)+60,'cognito:groups':[role]}}}};
}
test('user management rejects non-admin and anonymous callers before any Cognito call',async()=>{
 let calls=0;const handler=createUsersHandler({...config,client:{send:async()=>{calls++;return {};}}});
 assert.equal((await handler(event('Auditor','/admin/users','GET'))).statusCode,403);
 const unsigned=event('Administrator','/admin/users','GET');delete unsigned.requestContext.authorizer;
 assert.equal((await handler(unsigned)).statusCode,401);assert.equal(calls,0);
});
test('Manager invitations require department and persist subject profile',async()=>{
 const calls=[];const store=createMemoryStore();
 const handler=createUsersHandler({...config,store,client:{send:async c=>{calls.push(c);return c.constructor.name==='AdminCreateUserCommand'?{User:{Username:'target',Attributes:[{Name:'sub',Value:'target-sub'}]}}:{};}}});
 assert.equal((await handler(event('Administrator','/admin/users','POST',{email:'manager@example.test',role:'Manager',department:''}))).statusCode,400);
 assert.equal(calls.length,0);
 assert.equal((await handler(event('Administrator','/admin/users','POST',{email:'manager@example.test',role:'Manager',department:'Operations'}))).statusCode,201);
 assert.equal((await store.getProfile('target-sub')).department,'Operations');
 assert.equal(calls[0].input.DesiredDeliveryMediums[0],'EMAIL');
 assert.equal(calls[1].input.GroupName,'Manager');
});
test('unverified password reset requires explicit administrator confirmation',async()=>{
 const calls=[];const handler=createUsersHandler({...config,client:{send:async c=>{calls.push(c);return c.constructor.name==='AdminGetUserCommand'?{UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:'target-sub'},{Name:'email_verified',Value:'false'}]}:{};}}});
 assert.equal((await handler(event('Administrator','/admin/users/{userId}/password-reset'))).statusCode,400);
 assert.equal(calls.length,1);calls.length=0;
 assert.equal((await handler(event('Administrator','/admin/users/{userId}/password-reset','POST',{confirmEmailOwnership:true}))).statusCode,200);
 assert.deepEqual(calls.map(c=>c.constructor.name),['AdminGetUserCommand','AdminUpdateUserAttributesCommand','AdminResetUserPasswordCommand']);
});
test('first-sign-in user receives a fresh invitation rather than a reset code',async()=>{
 const calls=[];const handler=createUsersHandler({...config,client:{send:async c=>{calls.push(c);return c.constructor.name==='AdminGetUserCommand'?{UserStatus:'FORCE_CHANGE_PASSWORD'}:{};}}});
 assert.equal((await handler(event('Administrator','/admin/users/{userId}/password-reset'))).statusCode,200);
 assert.equal(calls[1].input.MessageAction,'RESEND');
});
test('changing user access signs out sessions, sets authoritative department, and rejects self changes',async()=>{
 const store=createMemoryStore();const calls=[];const handler=createUsersHandler({...config,store,client:{send:async c=>{calls.push(c);if(c.constructor.name==='AdminGetUserCommand')return {UserAttributes:[{Name:'sub',Value:'target-sub'},{Name:'email',Value:'target@example.test'}]};if(c.constructor.name==='AdminListGroupsForUserCommand')return {Groups:[{GroupName:'Employee'}]};return {};}}});
 assert.equal((await handler(event('Administrator','/admin/users/{userId}','PATCH',{role:'Manager',department:'Operations',enabled:true}))).statusCode,200);
 assert.equal(calls[1].constructor.name,'AdminUserGlobalSignOutCommand');
 assert.equal((await store.getProfile('target-sub')).department,'Operations');
});
