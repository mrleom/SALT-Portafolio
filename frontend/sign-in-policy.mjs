// A sign-in preference is never an authorization claim. Only the API's verified
// identity determines visible features and permitted operations.
export const SIGN_IN_ROLES = Object.freeze([
  { value: 'Employee', label: 'Employee' },
  { value: 'Technician', label: 'IT / Technician' },
  { value: 'Manager', label: 'Manager' },
  { value: 'Administrator', label: 'Administrator' },
  { value: 'Auditor', label: 'Auditor (read-only)' },
]);
export const SIGN_IN_ROLE_KEY = 'salt.sign-in-role-preference';
export const SIGN_IN_DESTINATION = '/';

export function rolePreferenceNotice(preference, verifiedGroups) {
  if (!SIGN_IN_ROLES.some(role => role.value === preference) || verifiedGroups.includes(preference)) return '';
  return `You selected ${preference}, but your account is assigned ${verifiedGroups.join(', ')}. Your workspace uses your assigned permissions; contact an administrator to change your role.`;
}
