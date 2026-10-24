import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createApp, type Config } from './app.ts';
import { createPlatform } from './platform.ts';
export function createWebApp(dataFile:string,whatsapp?:Config){
 const platform=createPlatform(join(dirname(dataFile),'platform.sqlite'));
 const webhook=whatsapp?createApp(whatsapp):undefined;
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url??'/','http://localhost');
  if(url.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'ok',whatsapp:!!whatsapp}));return;}
  if(url.pathname==='/webhook'){if(webhook)webhook.emit('request',req,res);else{res.writeHead(503);res.end('WhatsApp integration is not configured');}return;}
  if(await platform.handle(req,res))return;
  const files:Record<string,[string,string]>={'/':['index.html','text/html'],'/login':['index.html','text/html'],'/app':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};
  const file=/^\/b\/[a-z0-9-]+$/.test(url.pathname)?files['/']:files[url.pathname];
  if(req.method!=='GET'||!file){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':`${file[1]}; charset=utf-8`,'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
  res.end(readFileSync(new URL(`../public/${file[0]}`,import.meta.url)));
 });
 server.on('close',()=>platform.close());return server;
}
