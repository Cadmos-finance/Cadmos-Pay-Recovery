# Cadmos Emergency Recovery (Open Source)

Open-source **self-custody recovery kit** for Cadmos users.

Cadmos is self-custodial: your assets stay on-chain in a wallet you control.  
This repo exists so you can **recover independently** if the Cadmos app or infrastructure is unavailable.

This repo contains:

- `contracts/RecoveryController.sol` — main on-chain executor
- `contracts/RecoveryAdapter.sol` — adapter helper (deploy first)
- `frontend/` — recovery UI source (no backend required)
- `dist/` — self-contained, content-hashed production build
- `scripts/` — secret-free unsigned recovery planner

---

## Production Deployment

**Recovery Front-end:** [https://recovery.cadmos.dev/](https://recovery.cadmos.dev/)

**Arbitrum One (Chain ID: 42161)**

- **RecoveryController:** `0xEd092dE12cD5c2CbfDE051b42Fad5d27567DF01d`

> Always verify you are on the correct chain before signing or broadcasting transactions.

---

## What Users Can Do

- Recover to their **signatory wallet address** (destination = connected signatory).
- Recover **Cadmos vault assets** + **ERC-20 balances**.
- Add extra token addresses manually if the profile list is incomplete.
- Export an unsigned plan or the next operation's EIP-712 typed data for independent review.

---

## Quick Start (Frontend)

1. Install the exact locked dependencies:

```bash
npm ci
```

2. Configure addresses in `frontend/profiles.js`:
   - `controller`
   - `cadmosToken`
   - `knownTokens`

3. Build and serve the self-contained production files:

```bash
npm run serve
```

4. Open http://localhost:8080.

Follow the on-page checklist and review the plan output before executing.

The production page does not load JavaScript, styles, or fonts from third parties.
`viem` is installed from the pinned lockfile and compiled into a content-hashed local
bundle. `dist/build-manifest.json` records the bundle path, SHA-256 digest, and bundled
`viem` version. Commit the generated `dist/` files with every frontend release so the
static deployment always has a reviewed artifact.

The Cloudflare Worker applies the recovery Content Security Policy and the remaining
browser security headers in code. HTML and the build manifest use `no-store`; only
content-hashed assets receive immutable caching.

---

## Quick Start (Script)

1. Install the exact locked dependencies:

```bash
npm ci
```

2. Copy `scripts/recovery-config.example.json` to an ignored local file and configure
   the public addresses. The configuration never contains a private key:

```bash
cp scripts/recovery-config.example.json scripts/recovery-config.json
```

3. Generate an unsigned plan. Only the selected operation is bound to the current
   live wallet nonce:

```bash
npm run generate -- ./scripts/recovery-config.json --step 0
```

The CLI never signs or broadcasts. Sign `nextStep.typedData` with a trusted external
or hardware wallet, submit only that operation, then regenerate before the next step.
Any failed RPC, nonce, vault, or token read aborts plan generation.

---

## Smart Contract Review

Main contract to review:

- `contracts/RecoveryController.sol`

It includes an in-contract explanation of the exact EIP-712 payload required to sign Cadmos UserWallet.call(...) requests.
The controller constructor takes adapter and stores it as immutable.

---

## Deployment Order

1. Deploy `RecoveryAdapter.sol`.
2. Deploy `RecoveryController` with the adapter address in the constructor.

---

## Contract Compile

If you have Foundry:

```bash
forge build
```

---

## Tests

```bash
npm test
forge test
```

Pull requests and changes to `master` run these checks in GitHub Actions. CI also
audits dependencies, verifies that rebuilding does not change the committed `dist/`
artifact, and reviews dependency changes introduced by pull requests.

---

Current coverage focus:

- executeSignedCalls success and fail-fast behavior

- immutable adapter wiring in executeRecoveryPlan*

- revert cases (ZeroAddress, BadArrayLength, fail-fast custom error)

---

## Security Notes

- Always verify chain + contract addresses before signing.

- After any submitted or failed operation, regenerate against the live nonce and balances.

- Never commit or share private keys or seed phrases.

- This repo is designed to work without requiring any Cadmos backend.

- `npm test` rejects remote module imports and cross-origin page resources.

- Plan exports are unsigned. The UI signs and submits one live-nonce operation at a time.

- Vault and token read failures block recovery planning instead of being treated as zero balances.

- Security headers and cache policy are defined in `worker.js` and covered by automated tests.

---

## License

MIT
