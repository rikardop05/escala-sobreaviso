#!/usr/bin/env node
// Migração one-shot da Fase 0 da spec de múltiplas equipes (docs/specs/multi-equipe.md):
// copia as três chaves globais da escala para o prefixo team:sustentacao:*.
//
// Uso:
//   REDIS_URL=... node scripts/migrate-team-keys.mjs [--commit]
//
//   sem --commit  DRY-RUN (padrão): só lista o que seria copiado, não escreve nada.
//   --commit      aplica a cópia.
//
// Não sobrescreve destino já existente (mesmo padrão de api/migrate-ch.js) — seguro
// rodar mais de uma vez. As chaves antigas NÃO são apagadas aqui (ver §2 "Migração"
// em docs/specs/multi-equipe.md — a remoção é um deploy seguinte, depois que a
// leitura dupla em api/schedule.js e api/substitutions.js for removida).

import Redis from 'ioredis';

const commit = process.argv.includes('--commit');
const TEAM_ID = 'sustentacao';
const KEYS = ['schedule_overrides', 'schedule_labels', 'substitutions'];

if (!process.env.REDIS_URL) { console.error('REDIS_URL ausente'); process.exit(1); }
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3 });

for (const key of KEYS) {
  const newKey = `team:${TEAM_ID}:${key}`;
  const oldVal = await redis.get(key);
  if (oldVal === null) {
    console.log(`${key} → sem dados na chave antiga, nada a copiar`);
    continue;
  }
  const newVal = await redis.get(newKey);
  if (newVal !== null) {
    console.log(`${key} → ${newKey} já tem dados — não sobrescrito`);
    continue;
  }
  console.log(`${key} → ${newKey} ${commit ? '(copiado)' : '(dry-run, não copiado)'}`);
  if (commit) await redis.set(newKey, oldVal);
}

if (!commit) console.log('\nDRY-RUN — nada foi escrito. Rode de novo com --commit para aplicar.');
await redis.quit();
