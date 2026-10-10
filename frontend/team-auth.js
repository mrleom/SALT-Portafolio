// SLT-7: Amplify Auth against the existing Cognito pool (SAM), not a second Amplify backend.
import { teamAuthConfig } from './team-config.js';
import { hostedUiHost, oauthScopes } from './oauth-config.js';
import { sessionDisplayEmail } from './user-display.mjs';
import { SIGN_IN_DESTINATION } from './sign-in-policy.mjs';
import 'aws-amplify/auth/enable-oauth-listener';

let configured;

function oauthErrorMessage() {
  const url = new URL(window.location.href);
  const error = url.searchParams.get('error');
  if (!error) return '';
  return url.searchParams.get('error_description') || error;
}

function isCallbackPath() {
  return window.location.pathname === new URL(teamAuthConfig.callbackUrl).pathname;
}

function stripOAuthParams(pathname) {
  history.replaceState(null, '', pathname);
}

async function loadAmplify() {
  const [{ Amplify }, auth, { Hub }] = await Promise.all([
    import('aws-amplify'),
    import('aws-amplify/auth'),
    import('aws-amplify/utils'),
  ]);
  return { Amplify, Hub, ...auth };
}

async function ensureConfigured() {
  if (!configured) {
    configured = (async () => {
      const { Amplify } = await loadAmplify();
      Amplify.configure({
        Auth: {
          Cognito: {
            userPoolId: teamAuthConfig.userPoolId,
            userPoolClientId: teamAuthConfig.clientId,
            loginWith: {
              email: true,
              oauth: {
                domain: hostedUiHost(teamAuthConfig.domain),
                scopes: oauthScopes(teamAuthConfig.scope),
                redirectSignIn: [teamAuthConfig.callbackUrl],
                redirectSignOut: [teamAuthConfig.logoutUrl],
                responseType: 'code',
              },
            },
          },
        },
      });
    })();
  }
  await configured;
}

function rawJwt(token) {
  if (!token) return '';
  if (typeof token === 'string') return token;
  return typeof token.toString === 'function' ? token.toString() : String(token);
}

function tokenPayload(token) {
  if (token?.payload && typeof token.payload === 'object') return token.payload;
  const jwt = rawJwt(token);
  if (!jwt.startsWith('eyJ')) return {};
  try {
    return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

function accessTokenFrom(session) {
  const token = session?.tokens?.accessToken;
  const jwt = rawJwt(token);
  if (!jwt.startsWith('eyJ')) return null;
  const payload = tokenPayload(token);
  const scopes = String(payload.scope ?? '').split(/\s+/);
  if (payload.token_use !== 'access' || !scopes.includes(teamAuthConfig.scope)) return null;
  return jwt;
}

function hasOAuthCode() {
  return new URL(window.location.href).searchParams.has('code');
}

async function sessionAfterRedirect() {
  const { Hub, fetchAuthSession } = await loadAmplify();
  if (!hasOAuthCode()) return fetchAuthSession();
  // Leftover Amplify storage must not short-circuit the authorization-code exchange.
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = session => {
      if (settled) return;
      settled = true;
      cancel();
      clearTimeout(timer);
      clearInterval(poll);
      resolve(session);
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      cancel();
      clearTimeout(timer);
      clearInterval(poll);
      reject(error);
    };
    const cancel = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signInWithRedirect' || payload.event === 'signedIn') {
        fetchAuthSession().then(finish, fail);
      }
      if (payload.event === 'signInWithRedirect_failure') {
        fail(new Error(payload.message || 'Sign-in could not be completed.'));
      }
    });
    const poll = setInterval(async () => {
      if (hasOAuthCode()) return;
      try {
        const session = await fetchAuthSession();
        if (accessTokenFrom(session)) finish(session);
      } catch (error) {
        fail(error);
      }
    }, 50);
    const timer = setTimeout(() => { fetchAuthSession().then(finish, fail); }, 8000);
  });
}

export async function initialize() {
  await ensureConfigured();
  const failed = oauthErrorMessage();
  if (failed) {
    stripOAuthParams('/');
    throw new Error(failed);
  }
  const hadCode = new URL(window.location.href).searchParams.has('code');
  const session = await sessionAfterRedirect();
  if (isCallbackPath()) {
    const signedIn = Boolean(accessTokenFrom(session));
    stripOAuthParams(SIGN_IN_DESTINATION);
    if (!signedIn && hadCode) throw new Error('Sign-in could not be completed.');
  }
}

export async function getAccessToken() {
  await ensureConfigured();
  const { fetchAuthSession } = await loadAmplify();
  const session = await fetchAuthSession();
  return accessTokenFrom(session);
}

// Identity display only. The API still receives the access token, never the ID token.
export async function getDisplayEmail(subject) {
  await ensureConfigured();
  const { fetchAuthSession } = await loadAmplify();
  const session = await fetchAuthSession();
  return sessionDisplayEmail(tokenPayload(session?.tokens?.idToken), subject);
}

export async function signIn() {
  await ensureConfigured();
  const { signInWithRedirect, fetchAuthSession } = await loadAmplify();
  if (accessTokenFrom(await fetchAuthSession())) return;
  await signInWithRedirect({ options: { prompt: 'login' } });
}

export async function signOut() {
  await ensureConfigured();
  const { signOut } = await loadAmplify();
  await signOut({ oauth: { redirectUrl: teamAuthConfig.logoutUrl } });
}
