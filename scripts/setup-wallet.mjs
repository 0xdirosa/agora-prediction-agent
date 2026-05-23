import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const envWalletPath = path.join(PROJECT_ROOT, '.env.wallet');
if (fs.existsSync(envWalletPath)) {
  const parsed = dotenv.parse(fs.readFileSync(envWalletPath, 'utf-8'));
  for (const [k, v] of Object.entries(parsed)) process.env[k] = v;
}

function httpsRequest(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname, port: 443,
      path: urlObj.pathname + urlObj.search, method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function encryptRaw(secretHex) {
  const pubKeyUrl = 'https://api.circle.com/v1/w3s/config/entity/publicKey';
  return new Promise((resolve, reject) => {
    https.get(pubKeyUrl, { headers: { Authorization: `Bearer ${process.env.CIRCLE_API_KEY}` } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const pk = JSON.parse(data)?.data?.publicKey;
          if (!pk) return reject(new Error('No publicKey'));
          const enc = crypto.publicEncrypt(
            { key: pk, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
            Buffer.from(secretHex, 'hex')
          );
          resolve(enc.toString('base64'));
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

const uuid = () => crypto.randomUUID();

async function findExistingWallets(apiKey) {
  const res = await httpsRequest('GET', 'https://api.circle.com/v1/w3s/wallets', { Authorization: `Bearer ${apiKey}` });
  if (res.status !== 200) return [];
  return res.body?.data?.wallets?.filter(w => w.blockchain === 'ARC-TESTNET' && w.custodyType === 'DEVELOPER') || [];
}

async function main() {
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) throw new Error('CIRCLE_API_KEY not found in .env');

  console.log('=== Setup Agent Wallet ===\n');

  // Check for existing wallets first
  const existingWallets = await findExistingWallets(apiKey);
  if (existingWallets.length > 0) {
    console.log(`Found ${existingWallets.length} existing ARC-TESTNET wallets.\n`);

    // Group by walletSetId
    const bySet = {};
    for (const w of existingWallets) {
      (bySet[w.walletSetId] ||= []).push(w);
    }

    console.log('Available wallet sets on ARC-TESTNET:');
    for (const [setId, wallets] of Object.entries(bySet)) {
      for (const w of wallets) {
        console.log(`  [${setId.substring(0,8)}…] ID:${w.id.substring(0,8)}…  Addr:${w.address}  Type:${w.accountType}`);
      }
    }

    // Pick the wallet set with 2 SCA wallets (trading + reserve pattern)
    const preferredSet = Object.entries(bySet).find(([, w]) =>
      w.length >= 2 && w.every(x => x.accountType === 'SCA'));

    if (preferredSet) {
      const [setId, wallets] = preferredSet;
      const trading = wallets[0];
      const reserve = wallets[1];
      console.log(`\nUsing wallet set ${setId}:`);
      console.log(`  Trading: ${trading.id}  → ${trading.address}`);
      console.log(`  Reserve: ${reserve.id} → ${reserve.address}`);

      // Save to .env.wallet
      const envWalletData = [
        '# === EXISTING WALLETS (detected by scripts/setup-wallet.mjs) ===',
        '# Entity secret is already registered with Circle.',
        `CIRCLE_WALLET_SET_ID=${setId}`,
        `CIRCLE_WALLET_ID=${trading.id}`,
        `CIRCLE_WALLET_ADDRESS=${trading.address}`,
        '',
      ].join('\n');
      fs.writeFileSync(envWalletPath, envWalletData, 'utf-8');

      // Save to .env
      const envPath = path.join(PROJECT_ROOT, '.env');
      let envContent = fs.readFileSync(envPath, 'utf-8');
      const updates = {
        CIRCLE_WALLET_SET_ID: setId,
        CIRCLE_WALLET_ID: trading.id,
        CIRCLE_WALLET_ADDRESS: trading.address,
      };
      for (const [key, val] of Object.entries(updates)) {
        const re = new RegExp(`^${key}=.*$`, 'm');
        if (re.test(envContent)) envContent = envContent.replace(re, `${key}=${val}`);
        else envContent += `\n${key}=${val}`;
      }
      fs.writeFileSync(envPath, envContent, 'utf-8');

      console.log('\n✅ Credentials saved to .env.wallet and .env');
      console.log('');
      console.log('=== SUMMARY ===');
      console.log(`  Wallet Set ID:  ${setId}`);
      console.log(`  Wallet ID:      ${trading.id}`);
      console.log(`  Wallet Address: ${trading.address}`);
      console.log(`  Blockchain:     ARC-TESTNET`);
      console.log(`  Account Type:   ${trading.accountType}`);
      console.log('');
      console.log('  Entity secret is already registered (value known by original creator).');
      console.log('  To create FRESH wallets, use a new API key from Circle Console.');
      console.log('  Verify: node scripts/verify-setup.mjs');
    } else {
      // Just use the first wallet
      const w = existingWallets[0];
      console.log(`\nNo matching 2-wallet SCA set found. Using first wallet:`);
      console.log(`  ID: ${w.id}  → ${w.address}`);

      const envWalletData = [
        '# === EXISTING WALLET (detected by scripts/setup-wallet.mjs) ===',
        `CIRCLE_WALLET_SET_ID=${w.walletSetId}`,
        `CIRCLE_WALLET_ID=${w.id}`,
        `CIRCLE_WALLET_ADDRESS=${w.address}`,
        '',
      ].join('\n');
      fs.writeFileSync(envWalletPath, envWalletData, 'utf-8');
      console.log('\n✅ Wallet info saved to .env.wallet');
    }
    return;
  }

  // No existing wallets — try to create new ones
  console.log('No existing ARC-TESTNET wallets found. Creating new ones...\n');

  const rawSecret = process.env.ENTITY_SECRET;
  if (!rawSecret) throw new Error('ENTITY_SECRET not found in .env.wallet — run scripts/generate-entity-secret.mjs first');

  const { registerEntitySecretCiphertext } = await import('@circle-fin/developer-controlled-wallets');

  try {
    console.log('[1/3] Registering entity secret with Circle...');
    await registerEntitySecretCiphertext({
      apiKey, entitySecret: rawSecret,
      recoveryFileDownloadPath: path.join(PROJECT_ROOT, 'recovery'),
    });
    console.log('   ✅ Entity secret registered');
  } catch (e) {
    if (e.message?.includes('already been set')) {
      console.log('   ℹ️  Entity secret already registered (reusing)');
    } else {
      throw e;
    }
  }

  console.log('[2/3] Creating wallet set...');
  const ct1 = await encryptRaw(rawSecret);
  const wsRes = await httpsRequest('POST',
    'https://api.circle.com/v1/w3s/developer/walletSets',
    { Authorization: `Bearer ${apiKey}` },
    { name: 'AgentWalletSet', entitySecretCiphertext: ct1, idempotencyKey: uuid() }
  );
  if (wsRes.status >= 400) throw new Error(`Wallet set creation failed (${wsRes.status})`);

  const walletSetId = wsRes.body?.data?.walletSet?.id;
  if (!walletSetId) throw new Error(`No walletSet.id in response`);

  console.log(`   ✅ Wallet Set ID: ${walletSetId}`);

  console.log('[3/3] Creating wallet on ARC-TESTNET (SCA)...');
  const ct2 = await encryptRaw(rawSecret);
  const walletRes = await httpsRequest('POST',
    'https://api.circle.com/v1/w3s/developer/wallets',
    { Authorization: `Bearer ${apiKey}` },
    { idempotencyKey: uuid(), entitySecretCiphertext: ct2, blockchains: ['ARC-TESTNET'], count: 1, walletSetId, accountType: 'SCA' }
  );
  if (walletRes.status >= 400) throw new Error(`Wallet creation failed (${walletRes.status})`);

  const wallet = walletRes.body?.data?.wallets?.[0];
  if (!wallet) throw new Error(`No wallet in response`);

  console.log(`   ✅ Wallet ID: ${wallet.id}`);
  console.log(`   ✅ Wallet Address: ${wallet.address}`);
  console.log(`   ✅ Blockchain: ${wallet.blockchain}`);

  const envWalletData = [
    '# === GENERATED BY scripts/setup-wallet.mjs ===',
    `ENTITY_SECRET=${rawSecret}`,
    `ENTITY_SECRET_CIPHERTEXT=${process.env.ENTITY_SECRET_CIPHERTEXT || ct1}`,
    `CIRCLE_WALLET_SET_ID=${walletSetId}`,
    `CIRCLE_WALLET_ID=${wallet.id}`,
    `CIRCLE_WALLET_ADDRESS=${wallet.address}`,
    '',
  ].join('\n');
  fs.writeFileSync(envWalletPath, envWalletData, 'utf-8');

  // Also update .env
  const envPath = path.join(PROJECT_ROOT, '.env');
  let envContent = fs.readFileSync(envPath, 'utf-8');
  const updates = {
    CIRCLE_WALLET_SET_ID: walletSetId,
    CIRCLE_WALLET_ID: wallet.id,
    CIRCLE_WALLET_ADDRESS: wallet.address,
  };
  for (const [key, val] of Object.entries(updates)) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(envContent)) envContent = envContent.replace(re, `${key}=${val}`);
    else envContent += `\n${key}=${val}`;
  }
  fs.writeFileSync(envPath, envContent, 'utf-8');

  console.log('\n✅ Credentials saved to .env.wallet and .env');
  console.log('\n  NEXT: node scripts/verify-setup.mjs');
}

main().catch((err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
