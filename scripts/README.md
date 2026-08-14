# Recovery Scripts

- `generateRecoveryPlan.mjs` — secret-free unsigned recovery planner.
- `checkDeployedSecurity.mjs` — post-deployment check of the live security headers.
- `buildFrontend.mjs` — reproducible frontend bundler.

---

# Unsigned Recovery Planner

`generateRecoveryPlan.mjs` inspects live wallet/vault/token state and emits a
secret-free recovery plan. It never accepts a private key, requests a signature, or
broadcasts a transaction.

## Setup

Install the exact locked dependencies from the repository root:

```bash
npm ci
```

Copy the example to the ignored local configuration path and fill in public addresses:

```bash
cp scripts/recovery-config.example.json scripts/recovery-config.json
```

The configuration contains the RPC URL, chain ID, wallet, signatory, controller,
pinned controller runtime code hash, Cadmos vault, and token addresses. The example
already contains the Arbitrum production protocol values; replace only the example
wallet/signatory and adjust the token list if needed. Do not add a private key or
seed phrase.

## Generate a Plan

```bash
npm run generate -- ./scripts/recovery-config.json --step 0
```

The output contains:

- `operations`: the current unsigned recovery operations discovered on-chain;
- `nextStep`: exactly one selected operation bound to the wallet's current live nonce;
- `nextStep.typedData`: EIP-712 data for a trusted external or hardware wallet;
- no signatures and no executable controller calldata.

`--step` selects which current operation is exposed as `nextStep`. This is useful when
the first operation failed and a displayed fallback operation is required. Always
inspect the newly generated `operations` list before selecting an index.

## Safety Rules

- Sign and submit at most `nextStep`; never pre-sign the later operations.
- Regenerate after every submitted, failed, or externally executed operation.
- If the wallet nonce, vault state, or balances change, discard the old output.
- Any RPC, nonce, vault, or token read failure aborts generation. A read failure is
  never converted into a zero balance.
- Generation aborts unless the RecoveryController bytecode matches the pinned
  production runtime hash and every configured wallet/vault/token address contains
  contract code.
- Use the recovery web UI for the normal stepwise signing and submission flow.

## Modes

- `"mode": "all"` discovers full vault and token balances and includes the optional
  vault redeem fallback.
- `"mode": "withAmounts"` applies `cadmosAssetAmount` and `tokenAmounts` caps while
  still reading and validating the live balances.

---

# Deployed Security Check

`checkDeployedSecurity.mjs` fetches the live recovery site and compares each response
against the exact policy in `worker.js`. It reads no secrets and sends no wallet data.

```bash
npm run check:deployment
npm run check:deployment -- https://staging.example.invalid
```

It checks the page, `build-manifest.json`, the content-hashed bundle from
`dist/build-manifest.json`, the stylesheet, and a not-found path, then exits non-zero if
any response is missing a security header, carries the wrong `Cache-Control`, delivers a
bundle whose SHA-256 differs from the reviewed manifest digest, or serves a page that
loads a different bundle or any cross-origin resource.

Headers alone are not enough. A correct Content Security Policy on a substituted bundle
still executes the substituted code, so the digest comparison is what ties the delivered
bytes to the build that was reviewed and committed.

Run it after every deployment. A passing `npm test` only proves the policy is correct in
source; if Cloudflare serves assets without invoking `worker.js`, the unit tests stay
green while users receive an unhardened page. That failure mode is what this script
detects.
