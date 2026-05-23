# Setup Circle Agent Wallet

Panduan step-by-step untuk membuat Circle Developer-Controlled Wallet.

---

## Prasyarat

Kamu perlu **Circle API Key**. Cara mendapatkannya:

1. Buka [Circle Console](https://console.circle.com)
2. Login / daftar akun
3. Buat **project baru** (jika belum ada)
4. Pilih environment **Testnet**
5. Buka menu **Keys** → **Create API Key**
6. Copy API Key (format: `TEST_API_KEY:...`)
7. Isi ke file `.env`:
   ```bash
   CIRCLE_API_KEY=TEST_API_KEY:your-id:your-secret
   ```

---

## Langkah Setup

### 1. Generate Entity Secret (untuk API key baru)

Entity Secret adalah kunci 32-byte yang menandatangani semua operasi wallet.
**Hanya diperlukan jika API key belum pernah register entity secret.**

```bash
node scripts/generate-entity-secret.mjs
```

Contoh output:
```
=== Generate Entity Secret ===

✅ Entity Secret generated: a1b2c3d4... (64 hex chars)
✅ Circle public key fetched
✅ Entity Secret Ciphertext: M8OAwbJ8...
✅ Saved to .env.wallet
```

> ⚠️ **PENTING**: Simpan `ENTITY_SECRET` di tempat aman.
> Jika hilang, wallet tidak bisa diakses lagi.
> Jangan pernah share atau commit ke git.

### 2. Setup Agent Wallet

Script ini akan mendeteksi wallet yang sudah ada atau membuat yang baru:

```bash
node scripts/setup-wallet.mjs
```

**Skenario A — Wallet sudah ada** (API key sudah punya wallet):
```
=== Setup Agent Wallet ===

Found 10 existing ARC-TESTNET wallets.
Available wallet sets on ARC-TESTNET:
  [2544dfc0…] ID:087b8224…  Addr:0x67c0…  Type:SCA
  [2544dfc0…] ID:ff192969…  Addr:0x9ddb…  Type:SCA
  ...

Using wallet set 2544dfc0-94f9-5699-9f1b-8c772be17b6c:
  Trading: 087b8224-1f84-551e-a5ee-9d604d2374ee  → 0x67c0...
  Reserve: ff192969-6ef7-5f23-9c82-158c47e02003 → 0x9ddb...

✅ Credentials saved to .env.wallet and .env
```

**Skenario B — Wallet belum ada** (API key baru):
```
=== Setup Agent Wallet ===

No existing ARC-TESTNET wallets found. Creating new ones...

[1/3] Registering entity secret with Circle...
   ✅ Entity secret registered
[2/3] Creating wallet set...
   ✅ Wallet Set ID: 9d4f...
[3/3] Creating wallet on ARC-TESTNET (SCA)...
   ✅ Wallet ID: 1f29...
   ✅ Wallet Address: 0x1234...
   ✅ Blockchain: ARC-TESTNET

✅ Credentials saved to .env.wallet and .env
```

### 3. Verifikasi Setup

```bash
node scripts/verify-setup.mjs
```

Contoh output:
```
=== VERIFICATION REPORT ===

  ✅ Circle API Key: Valid
  ✅ Entity Secret: Already registered (using existing wallets)
  ✅ Entity Secret Cipher: N/A (using existing wallets)
  ✅ Wallet Set ID: 2544dfc0-... 
  ✅ Wallet ID: 087b8224-...
  ✅ Wallet Address: 0x67c06dcde...
  ✅ Circle Wallet API: 0x67c06dcde... (ARC-TESTNET)
  ✅ Arc Testnet RPC: Connected — Chain ID 5042002
  ✅ USDC Balance: 23.00 USDC

===========================
  ✅ All checks passed!
  The agent wallet is ready to use.
===========================
```

### 4. Isi Testnet USDC (jika balance = 0)

Gunakan [Circle Faucet](https://faucet.circle.com) untuk minta testnet USDC di ARC-TESTNET.

---

## File-file penting

| File | Isi | Git |
|------|-----|-----|
| `.env` | API key, konfigurasi agent, wallet IDs | ❌ di-ignore |
| `.env.wallet` | Entity secret, ciphertext, wallet IDs | ❌ di-ignore |
| `.env.example` | Template env (tanpa rahasia) | ✅ di-commit |
| `scripts/generate-entity-secret.mjs` | Generate entity secret | ✅ di-commit |
| `scripts/setup-wallet.mjs` | Deteksi/ buat wallet set + wallet | ✅ di-commit |
| `scripts/verify-setup.mjs` | Verifikasi semua komponen | ✅ di-commit |

---

## Entity Secret & Write Operations

Entity Secret diperlukan untuk operasi **write** (transfer USDC, sign, place bet):

| Operasi | Entity Secret dibutuhkan? |
|---------|--------------------------|
| Check balance | ❌ Tidak |
| Scan markets | ❌ Tidak |
| EV calculation | ❌ Tidak |
| Transfer USDC | ✅ **Ya** |
| Place Polymarket bet | ✅ **Ya** |
| Sign message | ✅ **Ya** |

Jika entity secret tidak tersedia tapi agent perlu execute bets, ada 2 opsi:

- **Opsi 1**: Cari entity secret original dari creator wallet sebelumnya
- **Opsi 2**: Buat API key baru di Circle Console → register entity secret baru → jalankan ulang setup

---

## Hasil Akhir

Setelah semua langkah berhasil, file `.env` akan berisi:

```ini
CIRCLE_API_KEY=TEST_API_KEY:...
CIRCLE_WALLET_SET_ID=2544dfc0-...
CIRCLE_WALLET_ID=087b8224-...
CIRCLE_WALLET_ADDRESS=0x67c06dcde...
```

Sekarang kamu bisa menjalankan agent:
```bash
npm start            # Autonomous loop
npm start -- --once  # Single cycle
npm run server       # Dashboard web UI
```
