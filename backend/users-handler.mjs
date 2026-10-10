import {
  CognitoIdentityProviderClient, ListUsersCommand, AdminGetUserCommand, AdminCreateUserCommand,
  AdminAddUserToGroupCommand, AdminRemoveUserFromGroupCommand, AdminListGroupsForUserCommand,
  AdminUpdateUserAttributesCommand, AdminUserGlobalSignOutCommand, AdminResetUserPasswordCommand,
  AdminEnableUserCommand, AdminDisableUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { authenticate, authorize, GROUPS, HttpError } from './auth.mjs';
import { readBody, shortText } from './lifecycle.mjs';
import { createDynamoStore } from './store-dynamo.mjs';

function attributes(user) { return Object.fromEntries((user.Attributes || user.UserAttributes || []).map(a => [a.Name, a.Value])); }
function roleAndDepartment(body) {
  if (!GROUPS.includes(body.role)) throw new HttpError(400, 'Choose a recognized role');
  const department = body.department ? shortText(body.department, 'department', 200) : '';
  if (body.role === 'Manager' && !department) throw new HttpError(400, 'Managers require a department');
  return department;
}
export function createUsersHandler(config) {
  return async event => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': config.origin, Vary: 'Origin' };
    try {
      const identity = authenticate(event, config);
      authorize(identity, 'admin:read');
      const call = command => config.client.send(command);
      const common = { UserPoolId: config.userPoolId };
      const route = `${event.httpMethod} ${event.resource}`;
      let result;
      if (route === 'GET /admin/users') {
        const users = []; let token;
        do {
          const page = await call(new ListUsersCommand({ ...common, PaginationToken: token, Limit: 60 }));
          for (const user of page.Users || []) {
            const attr = attributes(user);
            const memberships = await call(new AdminListGroupsForUserCommand({ ...common, Username: user.Username }));
            users.push({ userId: user.Username, subject: attr.sub, email: attr.email, department: attr['custom:department'] || '',
              enabled: user.Enabled, emailVerified: attr.email_verified === 'true', status: user.UserStatus, groups: (memberships.Groups || []).map(g => g.GroupName) });
          }
          token = page.PaginationToken;
        } while (token);
        result = { users };
      } else if (route === 'POST /admin/users') {
        const body = readBody(event, ['email', 'role', 'department']);
        const email = shortText(body.email, 'email', 254).toLowerCase();
        if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) throw new HttpError(400, 'Invalid email address');
        const department = roleAndDepartment(body);
        const created = await call(new AdminCreateUserCommand({ ...common, Username: email, DesiredDeliveryMediums: ['EMAIL'],
          UserAttributes: [{ Name: 'email', Value: email }, { Name: 'custom:department', Value: department }] }));
        const username = created.User.Username;
        await call(new AdminAddUserToGroupCommand({ ...common, Username: username, GroupName: body.role }));
        const attr = attributes(created.User);
        await config.store.putProfile({ PK: `USER#${attr.sub}`, SK: 'PROFILE', subject: attr.sub, email, department });
        result = { message: 'User invited', userId: username };
      } else {
        const Username = shortText(event.pathParameters?.userId, 'userId', 200);
        const user = await call(new AdminGetUserCommand({ ...common, Username }));
        const attr = attributes(user);
        if (route === 'POST /admin/users/{userId}/password-reset') {
          const body = readBody(event, ['confirmEmailOwnership']);
          if (body.confirmEmailOwnership !== undefined && typeof body.confirmEmailOwnership !== 'boolean') throw new HttpError(400, 'confirmEmailOwnership must be boolean');
          if (user.UserStatus === 'FORCE_CHANGE_PASSWORD') {
            await call(new AdminCreateUserCommand({ ...common, Username, MessageAction: 'RESEND', DesiredDeliveryMediums: ['EMAIL'] }));
            result = { message: 'New invitation sent' };
          } else {
            if (attr.email_verified !== 'true') {
              if (body.confirmEmailOwnership !== true) throw new HttpError(400, 'Confirm this email belongs to the user before requesting a reset');
              await call(new AdminUpdateUserAttributesCommand({ ...common, Username, UserAttributes: [{ Name: 'email_verified', Value: 'true' }] }));
              console.info(JSON.stringify({ action: 'AdminConfirmedEmailOwnership', actor: identity.subject, subject: attr.sub }));
            }
            await call(new AdminResetUserPasswordCommand({ ...common, Username }));
            result = { message: 'Password reset code sent' };
          }
        } else if (route === 'PATCH /admin/users/{userId}') {
          const body = readBody(event, ['role', 'department', 'enabled']);
          if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw new HttpError(400, 'enabled must be boolean');
          if (attr.sub === identity.subject) throw new HttpError(400, 'Ask another administrator to change your own access');
          const department = roleAndDepartment(body);
          // Revoke sessions before changing access. Already-issued JWTs may remain valid until expiry.
          await call(new AdminUserGlobalSignOutCommand({ ...common, Username }));
          const memberships = await call(new AdminListGroupsForUserCommand({ ...common, Username }));
          for (const group of memberships.Groups || []) if (GROUPS.includes(group.GroupName) && group.GroupName !== body.role)
            await call(new AdminRemoveUserFromGroupCommand({ ...common, Username, GroupName: group.GroupName }));
          await call(new AdminUpdateUserAttributesCommand({ ...common, Username, UserAttributes: [{ Name: 'custom:department', Value: department }] }));
          await config.store.putProfile({ PK: `USER#${attr.sub}`, SK: 'PROFILE', subject: attr.sub, email: attr.email, department });
          await call(new AdminAddUserToGroupCommand({ ...common, Username, GroupName: body.role }));
          if (body.enabled !== undefined) await call(new (body.enabled ? AdminEnableUserCommand : AdminDisableUserCommand)({ ...common, Username }));
          result = { message: 'User access updated. Ask the user to sign in again.' };
        } else throw new HttpError(404, 'Route not found');
      }
      return { statusCode: route === 'POST /admin/users' ? 201 : 200, headers, body: JSON.stringify(result) };
    } catch (error) {
      const known = error instanceof HttpError;
      if (!known) console.error(JSON.stringify({ action: 'UserOperationFailed', errorType: error.name }));
      return { statusCode: known ? error.statusCode : 502, headers,
        body: JSON.stringify({ error: known ? error.message : 'User operation failed. Check CloudWatch and retry.' }) };
    }
  };
}
export const handler = event => createUsersHandler({ clientId: process.env.COGNITO_CLIENT_ID,
  issuer: process.env.COGNITO_ISSUER, origin: process.env.FRONTEND_ORIGIN, requiredScope: process.env.REQUIRED_SCOPE,
  userPoolId: process.env.USER_POOL_ID, client: new CognitoIdentityProviderClient({}),
  store: createDynamoStore(process.env.ASSETS_TABLE) })(event);
