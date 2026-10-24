import { createWebApp } from './web.ts';
import { resolve } from 'node:path';

const keys = ['WHATSAPP_VERIFY_TOKEN', 'META_APP_SECRET', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_GRAPH_VERSION'] as const;
const configured = keys.every(key => process.env[key]?.trim());
const whatsapp = configured ? {
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!, appSecret: process.env.META_APP_SECRET!,
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN!, phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  graphVersion: process.env.WHATSAPP_GRAPH_VERSION!,
} : undefined;
if (whatsapp && (!/^v\d+\.\d+$/.test(whatsapp.graphVersion) || !/^\d+$/.test(whatsapp.phoneNumberId))) throw new Error('Invalid WhatsApp API version or phone number ID');
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const server = createWebApp(resolve(process.env.DATA_DIR ?? 'data', 'conversations.json'), whatsapp);
server.listen(port, '0.0.0.0', () => console.log(`Dhanavitree listening on port ${port}; WhatsApp ${whatsapp ? 'enabled' : 'optional / disabled'}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
