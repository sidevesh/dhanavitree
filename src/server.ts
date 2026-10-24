import { createApp } from './app.ts';

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const config = {
  verifyToken: required('WHATSAPP_VERIFY_TOKEN'),
  appSecret: required('META_APP_SECRET'),
  accessToken: required('WHATSAPP_ACCESS_TOKEN'),
  phoneNumberId: required('WHATSAPP_PHONE_NUMBER_ID'),
  graphVersion: required('WHATSAPP_GRAPH_VERSION'),
};
if (!/^v\d+\.\d+$/.test(config.graphVersion)) throw new Error('Invalid WHATSAPP_GRAPH_VERSION');
if (!/^\d+$/.test(config.phoneNumberId)) throw new Error('Invalid WHATSAPP_PHONE_NUMBER_ID');
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const server = createApp(config);
server.listen(port, '0.0.0.0', () => console.log(`WhatsApp webhook listening on port ${port}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
