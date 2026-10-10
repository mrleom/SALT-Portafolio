// Public stack outputs for the SLT-7 provider. No credentials belong here.
export const teamAuthConfig = Object.freeze({
  domain: import.meta.env.VITE_COGNITO_DOMAIN,
  clientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
  issuer: import.meta.env.VITE_COGNITO_ISSUER,
  scope: import.meta.env.VITE_AUTH_SCOPE,
  callbackUrl: import.meta.env.VITE_AUTH_CALLBACK_URL,
  logoutUrl: import.meta.env.VITE_AUTH_LOGOUT_URL,
});
// The provider requests openid/email plus scope and uses authorization code + PKCE.
