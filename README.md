# Cadmos Emergency Recovery (Open Source)

Open-source **self-custody recovery kit** for Cadmos users.

Cadmos is self-custodial: your assets stay on-chain in a wallet you control.  
This repo exists so you can **recover independently** if the Cadmos app or infrastructure is unavailable.

This repo contains:

- `contracts/RecoveryController.sol` — main on-chain executor
- `contracts/RecoveryAdapter.sol` — adapter helper (deploy first)
- `frontend/` — static recovery UI (no backend required)
- `scripts/` — offline payload/signature generation script

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
- Use an explorer fallback (e.g., Etherscan) via exported calldata/JSON.

---

## Quick Start (Frontend)

1. Configure addresses in `frontend/profiles.js`:
   - `controller`
   - `cadmosToken`
   - `knownTokens`

2. Run:

```bash
cd frontend
python3 -m http.server 8080
```
3. Open http://localhost:8080.

Follow the on-page checklist and review the plan output before executing.

---

## Quick Start (Script)

1. Install dependencies:

```bash
npm install
```

2. Edit scripts/recovery-config.example.json.

3. Generate payloads:

```bash
npm run generate
```

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
forge test
```

---

Current coverage focus:

- executeSignedCalls success and fail-fast behavior

- immutable adapter wiring in executeRecoveryPlan*

- revert cases (ZeroAddress, BadArrayLength, fail-fast custom error)

---

## Security Notes

- Always verify chain + contract addresses before signing.

- If nonce or balances change, regenerate signatures.

- Never commit or share private keys or seed phrases.

- This repo is designed to work without requiring any Cadmos backend.

---

## License

MIT
