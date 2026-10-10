// Tags are application-generated identifiers, not guesses made by an AI model.
export function suggestAssetTag(category, assets = []) {
  const prefix = String(category || '').normalize('NFKD').replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase();
  if (prefix.length !== 3) return '';
  let highest = 0;
  const pattern = new RegExp('^' + prefix + '-(\\d+)$');
  for (const asset of assets) {
    const match = String(asset.assetTag || '').toUpperCase().match(pattern);
    if (match && Number.isSafeInteger(Number(match[1]))) highest = Math.max(highest, Number(match[1]));
  }
  if (highest >= Number.MAX_SAFE_INTEGER) return '';
  return prefix + '-' + String(highest + 1).padStart(3, '0');
}

// This marker identifies illustrations supplied by this project, not all AI images.
export function assetPhotoCaption(photoKey) {
  return /ai-illustration-/i.test(String(photoKey || ''))
    ? 'AI-generated illustration · not a photograph of actual equipment'
    : 'Private asset photograph';
}
