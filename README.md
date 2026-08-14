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
- **RecoveryController runtime code hash:** `0x7f48f74ed39fe889bbb83c7b6a2244cc8e3d7a0cb370fd1c3b32b215d6bbb62e`

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
   - `controllerCodeHash`
   - `cadmosToken`
   - `knownTokens`

3. Build and serve the self-contained production files:

```bash
npm run serve
```

4. Open http://localhost:8080.

Follow the on-page checklist and review the plan output before executing.

Before a plan is shown, the UI verifies that the deployed RecoveryController
runtime bytecode matches the pinned production hash and that the Smart Account,
vault, and configured token addresses contain contract code. Manually supplied token
contracts require a separate acknowledgement.

For each operation, **Recover Now**:

1. reads the relevant live balance or vault metric;
2. simulates the exact target call from the Smart Account before requesting a signature;
3. signs one operation at the live nonce;
4. simulates the exact signed `executeSignedCalls` request with fail-fast behavior;
5. broadcasts that simulated request; and
6. requires the matching controller event and expected post-transaction state decrease.

The deployed Smart Account is treated as a black box: the signed controller simulation
checks its current authorization behavior without requiring its source in this repository.

The production page does not load JavaScript, styles, or fonts from third parties.
`viem` is installed from the pinned lockfile and compiled into a content-hashed local
bundle. `dist/build-manifest.json` records the bundle path, SHA-256 digest, and bundled
`viem` version. Commit the generated `dist/` files with every frontend release so the
static deployment always has a reviewed artifact.

The Cloudflare Worker applies the recovery Content Security Policy and the remaining
browser security headers in code. HTML and the build manifest use `no-store`; only
content-hashed assets receive immutable caching.

`wrangler.toml` sets `run_worker_first = true`. Cloudflare otherwise serves any request
matching a file in `dist/` straight from the static asset layer without invoking
`worker.js`, so the recovery page and its bundle would be published with none of these
headers while the Worker ran only on the not-found path.

Deploying is not the same as being protected. After every deployment, verify the live
response headers against the reviewed policy:

```bash
npm run check:deployment
```

The check reads `dist/build-manifest.json`, requests the page, manifest, content-hashed
bundle, stylesheet, and a not-found path, and fails if any response is missing a security
header, carries the wrong cache policy, delivers a bundle whose SHA-256 differs from the
reviewed manifest digest, or serves a page that loads anything other than the reviewed
bundle. It defaults to the production host and accepts an alternative base URL as its
first argument. `.github/workflows/deployment-check.yml`
runs the same check daily and on demand. It is deliberately excluded from `npm test` so
pull-request CI stays hermetic.

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

The CLI never signs or broadcasts. It verifies the same pinned controller runtime hash
and requires code at every configured contract address before generating a plan. Sign
`nextStep.typedData` with a trusted external or hardware wallet, submit only that
operation, then regenerate before the next step. Any failed RPC, nonce, vault, or token
read aborts plan generation.

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
audits the complete locked dependency tree at moderate severity or higher and verifies
that rebuilding does not change the committed `dist/` artifact.

`npm test` covers the delivery policy and the Worker routing that policy depends on, but
it cannot observe production. Run `npm run check:deployment` against the live host after
every deployment.

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

- A green build does not prove the live site is hardened. `npm run check:deployment`
  is the only check that reads what users actually receive.

- Plan exports are unsigned. The UI signs and submits one live-nonce operation at a time.

- Vault and token read failures block recovery planning instead of being treated as zero balances.

- The production RecoveryController runtime bytecode must match the pinned hash before planning.

- Target simulation happens before signing; exact signed-call simulation happens before broadcast.

- A matching controller event and balance/vault-state decrease are required after submission.

- Manually supplied token contracts require a fresh acknowledgement after their inputs change.

- Security headers and cache policy are defined in `worker.js` and covered by automated tests.

---

## License

MIT
