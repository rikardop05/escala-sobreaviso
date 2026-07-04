#!/usr/bin/env node
// Restauração de um dump de backup para o Redis.
//
// Uso:
//   BACKUP_ENCRYPTION_KEY=... REDIS_URL=... node scripts/restore-backup.mjs <arquivo-ou-url> [--commit]
//
//   <arquivo-ou-url>  caminho local do .enc (baixe do Blob Store no painel do Vercel)
//                     OU uma URL de download assinada. O store é privado, então a
//                     URL "crua" do blob NÃO abre por fetch sem token — prefira o arquivo local.
//   --commit          sem esta flag é DRY-RUN: só lista as chaves, não escreve nada
//   --only=prefixo    (opcional) restaura só chaves que começam com o prefixo (ex: --only=member:)
//
// Segurança: por padrão NÃO escreve. Revise a listagem do dry-run antes de rodar com --commit.
// A restauração faz SET das chaves do dump por cima do Redis atual (não apaga chaves que
// existem hoje e não estão no dump).

import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import Redis from 'ioredis';

const [, , source, ...flags] = process.argv;
const commit = flags.includes('--commit');
const onlyFlag = flags.find(f => f.startsWith('--only='));
const only = onlyFlag ? onlyFlag.slice('--only='.length) : null;

if (!source) {
  console.error('Uso: node scripts/restore-backup.mjs <arquivo-ou-url> [--commit] [--only=prefixo]');
  process.exit(1);
}

function loadKey() {
  const raw = process.env.BACKUP_ENCRYPTION_KEY;
  if (!raw) throw new Error('BACKUP_ENCRYPTION_KEY ausente');
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY deve ter 32 bytes');
  return key;
}

function decrypt(b64) {
  const key = loadKey();
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

async function readSource(src) {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    return res.text();
  }
  return readFile(src, 'utf8');
}

const raw = await readSource(source);
const dump = JSON.parse(decrypt(raw));
let keys = Object.keys(dump.data || {});
if (only) keys = keys.filter(k => k.startsWith(only));

console.log(`Dump de ${dump.createdAt} — ${dump.keyCount} chaves no total, ${keys.length} a restaurar${only ? ` (filtro: ${only})` : ''}:`);
for (const k of keys) console.log(`  ${k}`);

if (!commit) {
  console.log('\nDRY-RUN — nada foi escrito. Rode de novo com --commit para aplicar.');
  process.exit(0);
}

if (!process.env.REDIS_URL) { console.error('REDIS_URL ausente'); process.exit(1); }
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3 });
let n = 0;
for (const k of keys) {
  await redis.set(k, JSON.stringify(dump.data[k]));
  n++;
}
await redis.quit();
console.log(`\n✓ ${n} chaves restauradas no Redis.`);
