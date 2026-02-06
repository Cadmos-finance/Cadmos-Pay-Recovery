# Cadmos Panic Recovery (Open Source)

Open-source emergency recovery kit for Cadmos users.

This repo contains:

- `contracts/RecoveryController.sol` (main on-chain executor)
- `contracts/RecoveryAdapter.sol` (adapter helper, deploy first)
- `frontend/` static panic recovery UI
- `scripts/` offline payload/signature generation script

## What Users Can Do

- Recover to their signatory wallet address (destination = signatory).
- Recover Cadmos vault assets + ERC-20 balances.
- Add extra token addresses manually if profile list is incomplete.
- Use Etherscan fallback via exported calldata/JSON.

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

3. Open `http://localhost:8080`.
4. Follow the on-page Emergency Checklist.

## Quick Start (Script)

1. Install deps:

```bash
npm install
```

2. Edit `scripts/recovery-config.example.json`.
3. Generate payloads:

```bash
npm run generate
```

## Smart Contract Review

Main contract to review/show:

- `contracts/RecoveryController.sol`

It includes an in-contract explanation of the exact EIP-712 payload required to sign Cadmos `UserWallet.call(...)` requests.
The controller constructor takes `adapter` and stores it as immutable.

## Deployment Order

1. Deploy `RecoveryAdapter`.
2. Deploy `RecoveryController` with adapter address in constructor.

## Contract Compile

If you have Foundry:

```bash
forge build
```

## Tests

```bash
forge test
```

Current coverage focus:

- `executeSignedCalls` success and fail-fast behavior
- immutable adapter wiring in `executeRecoveryPlan*`
- revert cases (`ZeroAddress`, `BadArrayLength`, fail-fast custom error)

## Security Notes

- Always verify chain + contract addresses before signing.
- If nonce or balances changed, regenerate signatures.
- Keep private keys outside this repo.

## License

MIT
