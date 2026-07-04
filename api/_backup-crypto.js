import crypto from 'node:crypto';

// Criptografia simétrica dos dumps de backup.
// O dump contém dados financeiros e o e-mail do admin (closedBy nos fechamentos).
// O store do Blob é privado (URL só acessível com token); a cifra é a 2ª camada:
// mesmo que o token/URL vaze ou um blob seja exposto por engano, o conteúdo é inútil sem a chave.
//
// BACKUP_ENCRYPTION_KEY: 32 bytes em hex (64 chars) ou base64. Gere com:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// Formato do arquivo: base64( iv[12] || authTag[16] || ciphertext ) — AES-256-GCM.

function loadKey() {
  const raw = process.env.BACKUP_ENCRYPTION_KEY;
  if (!raw) throw new Error('BACKUP_ENCRYPTION_KEY ausente');
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY deve ter 32 bytes (hex de 64 chars ou base64)');
  return key;
}

export function encrypt(plaintext) {
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(b64) {
  const key = loadKey();
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
