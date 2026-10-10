export function readLocalSettings(env = process.env) {
  const port = Number(env.DEV_PORT || 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('DEV_PORT must be an integer from 1024 to 65535');
  return { host: 'localhost', port, origin: `http://localhost:${port}` };
}
