# Cadmos Emergency Recovery Frontend

A static, open-source recovery UI designed for **emergency use only** — specifically if the Cadmos app or infrastructure is unavailable.

Cadmos is **self-custodial**: your assets remain on-chain in your wallet. This page exists so you can recover independently, without relying on Cadmos services.

---

## Production Deployment Addresses

**Arbitrum One (Chain ID: 42161)**

- **RecoveryController:** `0xEd092dE12cD5c2CbfDE051b42Fad5d27567DF01d`

> Note: Always verify you are on the correct network before signing anything.

---

## What You Need (User Checklist)

You only need a few things:

- Your **Cadmos Smart Account address** (your Cadmos wallet address)
- A connected **signatory wallet** (your seed/hardware wallet that controls the Smart Account)
- Enough **native gas token** in the signatory wallet (for signatures + at least one on-chain transaction)
- Optional: **extra token contract addresses** (only if the profile token list is incomplete)

**Destination:** recovered assets are sent to the **connected signatory wallet address** by default.

**Default network:** Arbitrum One (42161).  
(If your Smart Account lives on another chain, switch to that chain.)

Everything else is driven by the on-chain protocol profile.

---

## Security Notes (Read This)

- **Only use the official recovery URL**. Bookmark it. Avoid links from DMs/ads.
- This recovery UI will **never** ask for your seed phrase or private key.
- You are responsible for what you sign — **review network + destination + plan output** before executing.

---

## Step-by-Step Recovery

1. Open the static page (`index.html`) from a trusted source.
2. Switch your wallet network to the correct chain (must match your Smart Account deployment).
3. Fund your signatory wallet with enough native gas token.
4. Click **Connect Signatory Wallet**.
5. Confirm the profile values are loaded (e.g., **RecoveryController**, **Cadmos Token/Vault**, token list).
6. Enter your **Cadmos Smart Account address**.
7. (Optional) Add missing token addresses under **Extra Token Addresses** (one per line).
8. Click **Scan & Build Plan** and review planned calls in **Output**.
9. Confirm the safety checkbox.
10. Click **Recover Now**.
11. Sign each wallet prompt in order.
12. Wait for confirmations.

---

## If a Recovery Transaction Fails

- Re-generate the plan/signatures if the Smart Account **nonce** or balances changed.
- Use **Copy JSON** or **Copy Calldata** to execute via a block explorer (manual fallback).

---

## Modes

### `standard` (recommended)
- Uses `maxWithdraw` plus optional `maxRedeem` fallback (for vault-like assets)
- Transfers full balances for known + discovered ERC-20 tokens

### `manual` (advanced)
- Allows manual Cadmos amount and per-token overrides (`token,amount`)
- Useful when automatic scanning is incomplete or a token behaves unusually

---

## Explorer / Etherscan Fallback

Use **Copy JSON**, **Copy Calldata**, or **Download JSON** to execute manually via a block explorer if needed.

---

## Before Release (Maintainers)

Configure `profiles.js` with real production values:

- `controller` address
- `cadmosToken` address
- known token addresses

You can keep `profiles.example.js` as the template.

---

## Run Locally

```bash
cd frontend
python3 -m http.server 8080
