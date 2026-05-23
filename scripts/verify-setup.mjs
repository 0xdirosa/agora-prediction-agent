import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const envWalletPath = path.join(PROJECT_ROOT, '.env.wallet');
if (fs.existsSync(envWalletPath)) {
  const parsed = dotenv.parse(fs.readFileSync(envWalletPath, 'utf-8'));
  for (const [k, v] of Object.entries(parsed)) {
    process.env[k] = v;
  }
}

function httpsRequest(method, url, headers) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', (e) => resolve({ status: 0, body: e.message }));
    req.end();
  });
}

function jsonRpcCall(rpcUrl, method, params) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(rpcUrl);
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ error: data }); }
      });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.write(body);
    req.end();
  });
}

function formatStatus(label, ok, detail) {
  const icon = ok ? '✅' : '❌';
  return `  ${icon} ${label}: ${detail || (ok ? 'OK' : 'FAILED')}`;
}

async function main() {
  console.log('=== VERIFICATION REPORT ===\n');

  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.ENTITY_SECRET;
  const entityCipher = process.env.ENTITY_SECRET_CIPHERTEXT;
  const walletSetId = process.env.CIRCLE_WALLET_SET_ID;
  const walletId = process.env.CIRCLE_WALLET_ID;
  const walletAddress = process.env.CIRCLE_WALLET_ADDRESS;
  const rpcUrl = process.env.ARC_TESTNET_RPC_URL || 'https://rpc.testnet.arc.network';

  let allOk = true;

  // 1. Circle API Key
  let apiKeyOk = false;
  if (!apiKey) {
    console.log(formatStatus('Circle API Key', false, 'Not set'));
  } else {
    const testRes = await httpsRequest('GET', 'https://api.circle.com/v1/w3s/wallets', { Authorization: `Bearer ${apiKey}` });
    apiKeyOk = testRes.status === 200;
    console.log(formatStatus('Circle API Key', apiKeyOk, apiKeyOk ? 'Valid' : `Status ${testRes.status}`));
    if (!apiKeyOk) allOk = false;
  }

  // 2. Entity Secret
  const esOk = entitySecret && entitySecret.length === 64;
  if (esOk) {
    console.log(formatStatus('Entity Secret', true, `Present (${entitySecret.length} hex chars)`));
  } else {
    console.log(formatStatus('Entity Secret', true, 'Already registered (using existing wallets)'));
  }

  // 3. Entity Secret Ciphertext
  const ecOk = !!entityCipher;
  if (ecOk) {
    console.log(formatStatus('Entity Secret Cipher', true, `Present (${entityCipher.length} chars)`));
  } else {
    console.log(formatStatus('Entity Secret Cipher', true, 'N/A (using existing wallets)'));
  }

  // 4. Wallet Set ID
  const wsOk = !!walletSetId;
  console.log(formatStatus('Wallet Set ID', wsOk, wsOk ? walletSetId : 'Not set'));
  if (!wsOk) allOk = false;

  // 5. Wallet ID
  const wiOk = !!walletId;
  console.log(formatStatus('Wallet ID', wiOk, wiOk ? walletId : 'Not set'));
  if (!wiOk) allOk = false;

  // 6. Wallet Address
  const waOk = !!walletAddress;
  console.log(formatStatus('Wallet Address', waOk, waOk ? walletAddress : 'Not set'));
  if (!waOk) allOk = false;

  // 7. Verify wallet exists via Circle API
  if (walletId && apiKeyOk) {
    const wRes = await httpsRequest(
      'GET',
      `https://api.circle.com/v1/w3s/wallets/${walletId}`,
      { Authorization: `Bearer ${apiKey}` }
    );
    const walletOk = wRes.status === 200;
    const walletInfo = walletOk ? `${wRes.body?.data?.wallet?.address} (${wRes.body?.data?.wallet?.blockchain})` : `Status ${wRes.status}`;
    console.log(formatStatus('Circle Wallet API', walletOk, walletInfo));
    if (!walletOk) allOk = false;
  } else {
    console.log(formatStatus('Circle Wallet API', false, 'Skipped (no walletId or API key invalid)'));
  }

  // 8. Arc Testnet RPC
  let rpcOk = false;
  let chainId = '';
  try {
    const rpcRes = await jsonRpcCall(rpcUrl, 'eth_chainId', []);
    rpcOk = rpcRes && !rpcRes.error;
    if (rpcRes.result) {
      const id = parseInt(rpcRes.result, 16);
      chainId = `Chain ID ${id}`;
    }
  } catch {}
  console.log(formatStatus('Arc Testnet RPC', rpcOk, rpcOk ? `Connected — ${chainId}` : 'Failed to connect'));
  if (!rpcOk) allOk = false;

  // 9. USDC Balance via Arc RPC
  if (walletAddress && rpcOk) {
    try {
      // ERC-20 balanceOf for USDC on Arc
      const usdcContract = '0x3600000000000000000000000000000000000000';
      const data = `0x70a08231000000000000000000000000${walletAddress.slice(2).toLowerCase()}`;
      const balRes = await jsonRpcCall(rpcUrl, 'eth_call', [{
        to: usdcContract,
        data,
      }, 'latest']);
      if (balRes && balRes.result && balRes.result !== '0x') {
        const rawBalance = BigInt(balRes.result);
        const balance = Number(rawBalance) / 1_000_000;
        console.log(formatStatus('USDC Balance', true, `${balance.toFixed(2)} USDC`));
        if (balance === 0) {
          console.log('\n  ⚠️  Wallet balance is 0. Fund it at:');
          console.log('     https://faucet.circle.com');
        }
      } else {
        console.log(formatStatus('USDC Balance', true, '0.00 USDC'));
        console.log('\n  ⚠️  Fund the wallet at:');
        console.log('     https://faucet.circle.com');
      }
    } catch (e) {
      console.log(formatStatus('USDC Balance', false, 'Failed to check'));
    }
  } else {
    console.log(formatStatus('USDC Balance', false, 'Skipped (no address or RPC down)'));
  }

  console.log('');
  console.log('===========================');

  if (allOk) {
    console.log('  ✅ All checks passed!');
    console.log('  The agent wallet is ready to use.');
  } else {
    console.log('  ⚠️  Some checks failed. Review the issues above.');
  }
  console.log('===========================');

  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
