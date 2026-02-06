# Cadmos Recovery Contracts

## Contracts

- `RecoveryController.sol`
  - Main entrypoint for direct recovery.
  - Stores `adapter` as an immutable deployment parameter.
  - Deployment order: deploy `RecoveryAdapter` first, then `RecoveryController(adapter)`.
  - Relays signed `UserWallet.call(...)` actions in sequence.
  - `executeSignedCalls(wallet, calls, continueOnFailure)` for generic execution.
  - Direct call pattern (no approvals needed):
    1. Cadmos `withdraw(...)` and optional `redeem(...)` fallback
    2. ERC20 `transfer(destination, amount)` for each token

- `RecoveryAdapter.sol`
  - Adapter helper for adapter-based sweeping (requires approvals).
  - Expected caller: Cadmos `UserWallet`.
  - `recoverAll(destination, cadmosToken, tokens)`
    - Cadmos default path: attempts `maxWithdraw(wallet)` + `withdraw(...)`.
    - Fallback path: if default withdraw fails, attempts `maxRedeem(wallet)` + `redeem(...)`.
    - ERC20 path: for each token, attempts `transferFrom(wallet, destination, balanceOf(wallet))`.
    - Best effort: per-token failures do not revert the whole call.
  - `recoverWithAmounts(destination, cadmosToken, cadmosAssetAmount, tokens, tokenAmounts)`
    - Same as above, but with optional manual caps.
    - `cadmosAssetAmount == 0` means default all-in path.
    - For ERC20: `tokenAmounts[i] == 0` (or missing) means full balance.

  - `executeRecoveryPlan(...)` and `executeRecoveryPlanWithAmounts(...)` are legacy convenience paths.

## Signature Order

Cadmos `UserWallet` nonces are sequential. Signatures must be produced in this exact order:

1. Cadmos direct call(s) (usually `withdraw`, optionally `redeem` fallback)
2. ERC20 direct `transfer` call for each token in order

If order changes, nonces mismatch and execution fails.
