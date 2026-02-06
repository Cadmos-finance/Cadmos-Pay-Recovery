# Recovery Signing Script

`generateRecoveryPayloads.ts` builds signed `UserWallet.call(...)` payloads in the required nonce order.

## Prerequisites

- Node.js
- `viem`

Install once:

```bash
npm install viem
```

## Usage

1. Copy `recovery-config.example.json` and fill real addresses/keys.
2. Run:

```bash
node --experimental-strip-types ./scripts/generateRecoveryPayloads.ts ./scripts/recovery-config.example.json
```

The script prints JSON for `RecoveryController.executeSignedCalls(...)`.

## Modes

- `"mode": "all"`
  - Builds direct calls:
    - Cadmos `withdraw(maxWithdraw, signatory, wallet)`
    - Optional Cadmos fallback `redeem(maxRedeem, signatory, wallet)`
    - ERC20 `transfer(signatory, balance)`
- `"mode": "withAmounts"`
  - Uses `cadmosAssetAmount` and optional `tokenAmounts` as safety caps.
  - Calls are still direct wallet-to-token calls.

## Important

- Signature order must not change.
- If you regenerate signatures, use a fresh wallet nonce.
- Keep private keys out of git and production frontends.
