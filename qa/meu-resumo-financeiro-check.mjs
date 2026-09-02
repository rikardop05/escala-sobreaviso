import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function collectText(dir, suffix) {
  const files = await readdir(dir, { withFileTypes: true });
  const texts = [];
  for (const file of files) {
    if (['node_modules', 'dist', '.git'].includes(file.name)) continue;
    const path = join(dir, file.name);
    if (file.isDirectory()) texts.push(...await collectText(path, suffix));
    else if (file.name.endsWith(suffix)) texts.push({ path, text: await readFile(path, 'utf8') });
  }
  return texts;
}

const srcFiles = await collectText(join(repoRoot, 'src'), '.jsx');
const apiFiles = await collectText(join(repoRoot, 'api'), '.js');
const allFiles = [...srcFiles, ...apiFiles];
const allSource = allFiles.map(file => file.text).join('\n');
const personalFiles = allFiles.filter(file => /meu-resumo|resumo-financeiro|Meu Resumo Financeiro/i.test(`${file.path}\n${file.text}`));
const personalSource = personalFiles.map(file => file.text).join('\n');

const checks = [
  ['personal-tab-integration', /Meu Resumo Financeiro/.test(personalSource)],
  ['memberId-gating', /memberId/.test(personalSource) && /role/.test(personalSource)],
  ['personal-backend-route', apiFiles.some(file => /meu|resumo|financeiro/i.test(file.path))],
  ['personal-csv-export', /CSV/.test(personalSource) && /download/.test(personalSource)],
  ['remuneration-visibility', /remunera[cç][aã]o/i.test(personalSource) && /eye|ocult/i.test(personalSource)],
  ['situations', /pendente/.test(personalSource) && /rejeitad/.test(personalSource) && /realizado/.test(personalSource)],
  ['snapshot-support', /ch_closed|snapshot/i.test(personalSource)],
  ['no-admin-actions', personalFiles.length > 0 && personalFiles.every(file => !/aprovar|rejeitar|Editar lançamento/.test(file.text))],
  ['demo-route', /meu-resumo|resumo-financeiro/i.test(allSource) && /#.*(meu|resumo).*demo/i.test(allSource)],
];

const failed = checks.filter(([, passed]) => !passed);
for (const [id, passed] of checks) console.log(`${passed ? 'PASS' : 'FAIL'} ${id}`);
console.log(`\n${checks.length} checks: ${checks.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) process.exitCode = 1;
