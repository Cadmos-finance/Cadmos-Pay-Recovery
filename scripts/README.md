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
Cadmos vault, and token addresses. Do not add a private key or seed phrase.

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
- Use the recovery web UI for the normal stepwise signing and submission flow.

## Modes

- `"mode": "all"` discovers full vault and token balances and includes the optional
  vault redeem fallback.
- `"mode": "withAmounts"` applies `cadmosAssetAmount` and `tokenAmounts` caps while
  still reading and validating the live balances.
