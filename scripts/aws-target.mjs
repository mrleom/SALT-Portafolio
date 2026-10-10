// Shared AWS target for seed / verify / publish. No account is assumed.
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Set ${name} to your AWS target before running this script. See README.md.`);
  }
  return value;
}

export function awsTarget() {
  const account = required('SALT_ACCOUNT');
  if (!/^\d{12}$/.test(account)) throw new Error('SALT_ACCOUNT must be a 12-digit AWS account ID');
  return {
    profile: required('AWS_PROFILE'),
    region: process.env.AWS_REGION?.trim() || 'us-east-1',
    stack: required('SALT_STACK'),
    account,
  };
}
