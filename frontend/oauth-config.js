export function hostedUiHost(domainUrl) {
  const url = new URL(domainUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('Cognito domain must be an HTTPS URL without credentials, query, or fragment');
  return url.host;
}

export function oauthScopes(requiredScope) {
  if (!requiredScope) throw new Error('Required access-token scope is missing');
  return ['openid', 'email', requiredScope];
}
