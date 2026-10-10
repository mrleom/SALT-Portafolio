// Suggestions populate an editable draft, never identifiers, finances or access
// assignments. Do not overwrite edits made while the photo was being analyzed.
export function prefillAssetDraft(current, suggestion, beforeUpload = current) {
  if (suggestion?.reviewStatus !== 'REVIEW_REQUIRED') return current;
  const candidates = {
    category: suggestion.category,
    manufacturer: suggestion.manufacturer,
    description: suggestion.description,
    usefulLifeYears: suggestion.suggestedUsefulLifeYears == null ? null : String(suggestion.suggestedUsefulLifeYears),
    condition: suggestion.visibleCondition && suggestion.visibleCondition !== 'UNKNOWN'
      ? suggestion.visibleCondition.charAt(0) + suggestion.visibleCondition.slice(1).toLowerCase() : null,
  };
  const next = { ...current };
  for (const [field, value] of Object.entries(candidates)) {
    if (value && current[field] === beforeUpload[field]) next[field] = value;
  }
  return next;
}
