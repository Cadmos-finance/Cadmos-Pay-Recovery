# Cadmos Emergency Recovery Frontend

A static, open-source recovery UI designed for **emergency use only** — specifically if the Cadmos app or infrastructure is unavailable.

Cadmos is **self-custodial**: your assets remain on-chain in your wallet. This page exists so you can recover independently, without relying on Cadmos services.

---

## Production Deployment Addresses

**Arbitrum One (Chain ID: 42161)**

- **RecoveryController:** `0xEd092dE12cD5c2CbfDE051b42Fad5d27567DF01d`
- **RecoveryController runtime code hash:** `0x7f48f74ed39fe889bbb83c7b6a2244cc8e3d7a0cb370fd1c3b32b215d6bbb62e`

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
- The UI blocks planning if the controller runtime hash differs or a configured contract has no code.
- Each target call is simulated before signing, then the exact signed controller call is simulated before broadcast.
- Successful submission still requires the expected controller event and an observable source-state decrease.

---

## Step-by-Step Recovery

1. Open the static page (`index.html`) from a trusted source.
2. Switch your wallet network to the correct chain (must match your Smart Account deployment).
3. Fund your signatory wallet with enough native gas token.
4. Click **Connect Signatory Wallet**.
5. Confirm the profile values are loaded (e.g., **RecoveryController**, **Cadmos Token/Vault**, token list).
6. Enter your **Cadmos Smart Account address**.
7. (Optional) Add missing token addresses under **Extra Token Addresses** (one per line).
8. If you entered an extra/manual token contract, independently verify it and confirm the separate arbitrary-contract warning.
9. Click **Scan & Build Plan** and review planned calls and contract checks in **Output**.
10. Confirm the network/destination safety checkbox.
11. Click **Recover Now**.
12. Sign each wallet prompt in order. No signature is requested for a step whose target simulation fails.
13. Wait for the signed simulation, transaction, event, and postcondition checks to complete.

---

## If a Recovery Transaction Fails

- Stop and regenerate the plan against the Smart Account's live **nonce** and balances.
- Do not reuse previously exported typed data after a failure or state change.
- A vault, nonce, or token read error blocks plan generation; it is never interpreted as a zero balance.

---

## Modes

### `standard` (recommended)
- Uses `maxWithdraw` plus optional `maxRedeem` fallback (for vault-like assets)
- Transfers full balances for known + discovered ERC-20 tokens

### `manual` (advanced)
- Allows manual Cadmos amount and per-token overrides (`token,amount`)
- Useful when automatic scanning is incomplete or a token behaves unusually

---

## Unsigned Review and Hardware-Wallet Export

**Copy unsigned plan** and **Download unsigned plan** never request signatures and
cannot move funds. The plan lists every discovered operation, but only `nextStep` is
bound to the current live nonce. **Copy next-step typed data** exports that one EIP-712
request for review or signing with a trusted external tool.

Submit at most that one operation, then regenerate. The normal **Recover Now** flow
already follows this rule by reading the live nonce, signing, and submitting each
operation individually.

---

## Before Release (Maintainers)

When adding or updating a production profile, configure `profiles.js` with:

- `controller` address
- `controllerCodeHash` of the exact deployed runtime bytecode
- `cadmosToken` address
- known token addresses

You can keep `profiles.example.js` as the template.

Build from the repository root and commit the generated `dist/` artifact:

```bash
npm ci
npm test
```

The build bundles the exact lockfile version of `viem`, rejects remote module imports,
and emits a content-hashed script plus its SHA-256 digest in
`dist/build-manifest.json`. The production page must not load third-party executable,
style, or font resources.

The Cloudflare Worker must remain the source of truth for CSP and the other browser
security headers. Do not rely on dashboard-only header rules: `npm test` verifies the
policy encoded in `worker.js`.

---

## Run Locally

```bash
npm run serve
```

Then open http://localhost:8080.
