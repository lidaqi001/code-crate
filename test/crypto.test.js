import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash, createCipheriv, createDecipheriv, pbkdf2Sync } from 'node:crypto';

import {
  hmacHex,
  hmacBytes,
  digestHex,
  aesGcmEncrypt,
  aesGcmDecrypt,
  splitGcmTag,
  joinGcmTag,
  pbkdf2,
  validateAesKey,
  validateIv,
  generateAesKey,
  generateIv,
  formatBytes,
  verifyHmac,
  describeCiphertext,
  GCM_IV_BYTES,
  GCM_TAG_BYTES,
  AES_KEY_SIZES
} from '../src/tools/crypto/logic.js';
import { hexToBytes, bytesToHex, bytesToBase64, base64ToBytes, textToBytes, timingSafeEqual } from '../src/core/bytes.js';

/* ══════════════ node:crypto 参照实现 ══════════════
   用 Node 官方实现作为独立 oracle，双向交叉验证自己的实现。 */

const nodeHmac = (algorithm, key, message) =>
  createHmac(algorithm.replace('-', '').toLowerCase(), Buffer.from(key))
    .update(Buffer.from(message))
    .digest('hex');

const nodeDigest = (algorithm, message) =>
  createHash(algorithm.replace('-', '').toLowerCase()).update(Buffer.from(message)).digest('hex');

function nodeGcmEncrypt(key, iv, plaintext, aad) {
  const cipher = createCipheriv(`aes-${key.length * 8}-gcm`, Buffer.from(key), Buffer.from(iv));
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  return { ciphertext: new Uint8Array(ciphertext), tag: new Uint8Array(cipher.getAuthTag()) };
}

function nodeGcmDecrypt(key, iv, ciphertext, tag, aad) {
  const decipher = createDecipheriv(`aes-${key.length * 8}-gcm`, Buffer.from(key), Buffer.from(iv));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag));
  return new Uint8Array(Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]));
}

/* ── HMAC：RFC 4231 官方向量 ──────────────────────────────── */

test('HMAC 符合 RFC 4231 测试向量', async () => {
  const key1 = new Uint8Array(20).fill(0x0b);
  assert.equal(
    await hmacHex('SHA-256', key1, 'Hi There'),
    'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
  );
  assert.equal(
    await hmacHex('SHA-1', key1, 'Hi There'),
    'b617318655057264e28bc0b6fb378c8ef146be00'
  );

  const key2 = textToBytes('Jefe');
  assert.equal(
    await hmacHex('SHA-256', key2, 'what do ya want for nothing?'),
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'
  );
  assert.equal(
    await hmacHex('SHA-1', key2, 'what do ya want for nothing?'),
    'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79'
  );
});

test('HMAC 与 node:crypto 完全一致（全部算法）', async () => {
  const cases = [
    ['SHA-1', 'sha1'],
    ['SHA-256', 'sha256'],
    ['SHA-384', 'sha384'],
    ['SHA-512', 'sha512']
  ];
  const key = textToBytes('codecrate-secret');
  const message = textToBytes('The quick brown fox 跳过了懒狗');

  for (const [algorithm] of cases) {
    const mine = await hmacHex(algorithm, key, message);
    assert.equal(mine, nodeHmac(algorithm, key, message), algorithm);
  }
});

test('HMAC 支持任意长度密钥（含超长密钥）', async () => {
  for (const size of [1, 16, 64, 200]) {
    const key = new Uint8Array(size).fill(size % 251);
    const mine = await hmacHex('SHA-256', key, 'data');
    assert.equal(mine, nodeHmac('SHA-256', key, 'data'), `密钥长度 ${size}`);
  }
});

test('HMAC 空密钥报错', async () => {
  await assert.rejects(() => hmacHex('SHA-256', new Uint8Array(0), 'x'), /不能为空/);
  await assert.rejects(() => hmacHex('MD5', textToBytes('k'), 'x'), /不支持/);
});

/* ── 摘要 ─────────────────────────────────────────────────── */

test('摘要与 node:crypto 一致', async () => {
  for (const algorithm of ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']) {
    const mine = await digestHex(algorithm, 'codecrate');
    assert.equal(mine, nodeDigest(algorithm, textToBytes('codecrate')), algorithm);
  }
});

/* ── AES-GCM：与 node:crypto 双向交叉验证 ─────────────────── */

test('node 加密的密文能被我们解开', async () => {
  for (const size of AES_KEY_SIZES) {
    const key = new Uint8Array(size).fill(0x42);
    const iv = new Uint8Array(GCM_IV_BYTES).fill(0x24);
    const plaintext = textToBytes('跨实现验证：node → 我们');

    const { ciphertext, tag } = nodeGcmEncrypt(key, iv, plaintext);
    const combined = joinGcmTag(ciphertext, tag);
    const decrypted = await aesGcmDecrypt({ ciphertext: combined, keyBytes: key, ivBytes: iv });
    assert.equal(bytesToHex(decrypted), bytesToHex(plaintext), `密钥 ${size} 字节`);
  }
});

test('我们加密的密文能被 node 解开', async () => {
  for (const size of AES_KEY_SIZES) {
    const key = new Uint8Array(size).fill(0x17);
    const iv = new Uint8Array(GCM_IV_BYTES).fill(0x99);
    const plaintext = textToBytes('跨实现验证：我们 → node');

    const combined = await aesGcmEncrypt({ plaintext, keyBytes: key, ivBytes: iv });
    const { ciphertext, tag } = splitGcmTag(combined);
    const decrypted = nodeGcmDecrypt(key, iv, ciphertext, tag);
    assert.equal(bytesToHex(decrypted), bytesToHex(plaintext), `密钥 ${size} 字节`);
  }
});

test('带附加数据（AAD）时与 node 一致', async () => {
  const key = new Uint8Array(32).fill(0x01);
  const iv = new Uint8Array(GCM_IV_BYTES).fill(0x02);
  const aad = textToBytes('header-v1');
  const plaintext = textToBytes('重要内容');

  const mine = await aesGcmEncrypt({ plaintext, keyBytes: key, ivBytes: iv, additionalData: aad });
  const { ciphertext, tag } = splitGcmTag(mine);
  const viaNode = nodeGcmDecrypt(key, iv, ciphertext, tag, aad);
  assert.equal(bytesToHex(viaNode), bytesToHex(plaintext));

  const nodeResult = nodeGcmEncrypt(key, iv, plaintext, aad);
  const fromNode = await aesGcmDecrypt({
    ciphertext: joinGcmTag(nodeResult.ciphertext, nodeResult.tag),
    keyBytes: key,
    ivBytes: iv,
    additionalData: aad
  });
  assert.equal(bytesToHex(fromNode), bytesToHex(plaintext));
});

test('密文与 node 逐字节一致（确定性输入）', async () => {
  const key = new Uint8Array(32).fill(0x0a);
  const iv = new Uint8Array(GCM_IV_BYTES).fill(0x0b);
  const plaintext = textToBytes('deterministic');

  const mine = await aesGcmEncrypt({ plaintext, keyBytes: key, ivBytes: iv });
  const theirs = nodeGcmEncrypt(key, iv, plaintext);
  assert.equal(bytesToHex(mine), bytesToHex(joinGcmTag(theirs.ciphertext, theirs.tag)));
});

test('AES-GCM 加解密往返（含中文与二进制）', async () => {
  const key = generateAesKey(32);
  const iv = generateIv();
  const samples = ['', 'hello', '中文内容', 'a'.repeat(1000)];

  for (const sample of samples) {
    const combined = await aesGcmEncrypt({ plaintext: textToBytes(sample), keyBytes: key, ivBytes: iv });
    const decrypted = await aesGcmDecrypt({ ciphertext: combined, keyBytes: key, ivBytes: iv });
    assert.equal(bytesToHex(decrypted), bytesToHex(textToBytes(sample)), `长度 ${sample.length}`);
  }
});

test('篡改密文会被检出', async () => {
  const key = generateAesKey(32);
  const iv = generateIv();
  const combined = await aesGcmEncrypt({ plaintext: textToBytes('原文'), keyBytes: key, ivBytes: iv });

  const tampered = Uint8Array.from(combined);
  tampered[0] ^= 0x01;
  await assert.rejects(
    () => aesGcmDecrypt({ ciphertext: tampered, keyBytes: key, ivBytes: iv }),
    /解密失败/
  );

  // 只改认证标签也要被发现
  const tamperedTag = Uint8Array.from(combined);
  tamperedTag[tamperedTag.length - 1] ^= 0x01;
  await assert.rejects(
    () => aesGcmDecrypt({ ciphertext: tamperedTag, keyBytes: key, ivBytes: iv }),
    /解密失败/
  );
});

test('错误的密钥或 IV 会解密失败而不是返回乱码', async () => {
  const key = generateAesKey(32);
  const iv = generateIv();
  const combined = await aesGcmEncrypt({ plaintext: textToBytes('secret'), keyBytes: key, ivBytes: iv });

  const wrongKey = generateAesKey(32);
  await assert.rejects(() => aesGcmDecrypt({ ciphertext: combined, keyBytes: wrongKey, ivBytes: iv }), /解密失败/);

  const wrongIv = generateIv();
  await assert.rejects(() => aesGcmDecrypt({ ciphertext: combined, keyBytes: key, ivBytes: wrongIv }), /解密失败/);
});

test('附加数据不匹配也会失败', async () => {
  const key = generateAesKey(32);
  const iv = generateIv();
  const combined = await aesGcmEncrypt({
    plaintext: textToBytes('x'),
    keyBytes: key,
    ivBytes: iv,
    additionalData: textToBytes('aad-1')
  });
  await assert.rejects(
    () => aesGcmDecrypt({ ciphertext: combined, keyBytes: key, ivBytes: iv, additionalData: textToBytes('aad-2') }),
    /解密失败/
  );
});

/* ── 密文与标签的拆分 ─────────────────────────────────────── */

test('splitGcmTag 与 joinGcmTag 互逆', async () => {
  const key = generateAesKey(32);
  const iv = generateIv();
  const combined = await aesGcmEncrypt({ plaintext: textToBytes('payload'), keyBytes: key, ivBytes: iv });
  const { ciphertext, tag } = splitGcmTag(combined);

  assert.equal(tag.length, GCM_TAG_BYTES);
  assert.equal(ciphertext.length, combined.length - GCM_TAG_BYTES);
  assert.equal(bytesToHex(joinGcmTag(ciphertext, tag)), bytesToHex(combined));
});

test('标签长度不对时报错', () => {
  assert.throws(() => joinGcmTag(new Uint8Array(4), new Uint8Array(8)), /必须是 16 字节/);
  assert.throws(() => splitGcmTag(new Uint8Array(8)), /至少要有 16 字节/);
});

test('describeCiphertext 给出两种表示', async () => {
  const key = generateAesKey(32);
  const iv = generateIv();
  const combined = await aesGcmEncrypt({ plaintext: textToBytes('abcd'), keyBytes: key, ivBytes: iv });
  const info = describeCiphertext(combined);

  assert.equal(info.total, combined.length);
  assert.equal(info.ciphertextLength, 4);
  assert.equal(info.tagLength, GCM_TAG_BYTES);
  assert.equal(info.ciphertextHex.length, 8);
  assert.equal(info.tagHex.length, GCM_TAG_BYTES * 2);
  assert.equal(bytesToHex(base64ToBytes(info.tagBase64)), info.tagHex);
});

/* ── 密钥与 IV 校验 ───────────────────────────────────────── */

test('AES 密钥长度校验', () => {
  assert.doesNotThrow(() => validateAesKey(new Uint8Array(16)));
  assert.doesNotThrow(() => validateAesKey(new Uint8Array(32)));
  assert.throws(() => validateAesKey(new Uint8Array(20)), /必须是 16 \/ 24 \/ 32 字节/);
  assert.throws(() => validateAesKey('not bytes'), /格式不正确/);
  assert.throws(() => generateAesKey(20), /只能是/);
});

test('IV 校验', () => {
  assert.equal(generateIv().length, GCM_IV_BYTES);
  assert.equal(generateIv(16).length, 16);
  assert.throws(() => generateIv(0), /1-64/);
  assert.throws(() => generateIv(100), /1-64/);
  assert.throws(() => validateIv(new Uint8Array(0)), /不能为空/);
  assert.throws(() => validateIv(new Uint8Array(100)), /过长/);
});

test('随机密钥每次不同', () => {
  const a = generateAesKey(32);
  const b = generateAesKey(32);
  assert.notEqual(bytesToHex(a), bytesToHex(b));
  assert.equal(a.length, 32);
});

/* ── PBKDF2 ───────────────────────────────────────────────── */

test('PBKDF2 与 node:crypto 一致', async () => {
  const cases = [
    { hash: 'SHA-1', length: 20 },
    { hash: 'SHA-256', length: 32 },
    { hash: 'SHA-512', length: 64 }
  ];

  for (const { hash, length } of cases) {
    const mine = await pbkdf2({
      password: 'correct horse battery staple',
      salt: textToBytes('codecrate-salt'),
      iterations: 10000,
      hash,
      length
    });
    const theirs = pbkdf2Sync('correct horse battery staple', 'codecrate-salt', 10000, length, hash.replace('-', '').toLowerCase());
    assert.equal(bytesToHex(mine), theirs.toString('hex'), `${hash}/${length}`);
  }
});

test('PBKDF2 同参数结果稳定、不同盐结果不同', async () => {
  const base = { password: 'pw', iterations: 1000, hash: 'SHA-256', length: 16 };
  const a = await pbkdf2({ ...base, salt: textToBytes('salt-a') });
  const b = await pbkdf2({ ...base, salt: textToBytes('salt-a') });
  const c = await pbkdf2({ ...base, salt: textToBytes('salt-b') });
  assert.equal(bytesToHex(a), bytesToHex(b));
  assert.notEqual(bytesToHex(a), bytesToHex(c));
});

test('PBKDF2 参数校验', async () => {
  await assert.rejects(() => pbkdf2({ password: 'p', salt: '', iterations: 1000 }), /盐不能为空/);
  await assert.rejects(() => pbkdf2({ password: 'p', salt: 's', iterations: 0 }), /正整数/);
  await assert.rejects(() => pbkdf2({ password: 'p', salt: 's', iterations: 1000, length: 0 }), /1-128/);
  await assert.rejects(() => pbkdf2({ password: 'p', salt: 's', iterations: 1000, hash: 'MD5' }), /不支持的哈希/);
});

/* ── 输出格式与校验辅助 ───────────────────────────────────── */

test('formatBytes 支持分组', () => {
  const bytes = hexToBytes('deadbeef');
  assert.equal(formatBytes(bytes, 'hex'), 'deadbeef');
  assert.equal(formatBytes(bytes, 'hex', { group: 2 }), 'de ad be ef');
  assert.equal(bytesToHex(base64ToBytes(bytesToBase64(bytes))), 'deadbeef');
});

test('verifyHmac 判定正确与错误', async () => {
  const key = textToBytes('key');
  const message = 'message';
  const expected = nodeHmac('SHA-256', key, message);

  const good = await verifyHmac('SHA-256', key, message, expected);
  assert.equal(good.ok, true);

  const bad = await verifyHmac('SHA-256', key, 'other', expected);
  assert.equal(bad.ok, false);

  const wrongLength = await verifyHmac('SHA-256', key, message, 'abcd');
  assert.equal(wrongLength.ok, false);
  assert.match(wrongLength.error, /长度不匹配/);
});

test('timingSafeEqual 正确比较', () => {
  assert.equal(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.equal(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])), false);
});
