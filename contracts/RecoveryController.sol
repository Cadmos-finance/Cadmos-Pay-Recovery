// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/// @title Cadmos recovery controller
/// @notice Relays signed `UserWallet.call(...)` operations in sequence.
contract RecoveryController {
    address public immutable adapter;

    bytes4 private constant SELECTOR_WALLET_CALL = bytes4(keccak256("call(address,address,bytes,bytes,uint256)"));
    bytes4 private constant SELECTOR_APPROVE = bytes4(keccak256("approve(address,uint256)"));
    string private constant REQUEST_TYPE = "Request(address target,uint256 value,uint256 deadline,uint256 nonce,bytes data)";
    string private constant DOMAIN_NAME = "Cadmos UserWallet";
    string private constant DOMAIN_VERSION = "1";

    bytes4 private constant SELECTOR_RECOVER_ALL = bytes4(keccak256("recoverAll(address,address,address[])"));
    bytes4 private constant SELECTOR_RECOVER_WITH_AMOUNTS = bytes4(keccak256("recoverWithAmounts(address,address,uint256,address[],uint256[])"));

    error ZeroAddress();
    error BadArrayLength();
    error WalletCallFailed(uint256 index, bytes reason);

    struct SignedWalletCall {
        address target;
        address signatory;
        bytes data;
        bytes signature;
        uint256 deadline;
    }

    struct RecoveryPlan {
        address wallet;
        address signatory;
        address cadmosToken;
        address destination;
        address[] tokens;
        bytes[] signatures;
        uint256[] deadlines;
        bool continueOnFailure;
    }

    struct RecoveryPlanWithAmounts {
        address wallet;
        address signatory;
        address cadmosToken;
        address destination;
        uint256 cadmosAssetAmount;
        address[] tokens;
        uint256[] tokenAmounts;
        bytes[] signatures;
        uint256[] deadlines;
        bool continueOnFailure;
    }

    event WalletCallExecuted(
        uint256 indexed index,
        address indexed wallet,
        address indexed target,
        bool success,
        bytes returnData
    );

    /**
     * @param adapter_ Adapter address fixed at deployment.
     * Deploy adapter first, then deploy this controller with that address.
     */
    constructor(address adapter_) {
        if (adapter_ == address(0)) revert ZeroAddress();
        adapter = adapter_;
    }

    /**
     * @notice Returns the exact EIP-712 struct type used by Cadmos UserWallet.
     * @dev This matches the wallet implementation `REQUEST_TYPE`.
     */
    function signingRequestType() external pure returns (string memory) {
        return REQUEST_TYPE;
    }

    /**
     * @notice Returns the EIP-712 domain name expected by Cadmos UserWallet.
     */
    function signingDomainName() external pure returns (string memory) {
        return DOMAIN_NAME;
    }

    /**
     * @notice Returns the EIP-712 domain version expected by Cadmos UserWallet.
     */
    function signingDomainVersion() external pure returns (string memory) {
        return DOMAIN_VERSION;
    }

    /// @notice Execute any list of signed wallet calls in order.
    /// @dev Calls are best-effort when `continueOnFailure` is true.
    /// @dev ------------------------------------------------------------------
    /// Signing payload required for each `calls[i]`:
    ///   Domain:
    ///     name: "Cadmos UserWallet"
    ///     version: "1"
    ///     chainId: current chain id
    ///     verifyingContract: `wallet`
    ///
    ///   Types:
    ///     Request(address target,uint256 value,uint256 deadline,uint256 nonce,bytes data)
    ///
    ///   Message mapping:
    ///     target   -> calls[i].target
    ///     value    -> 0
    ///     deadline -> calls[i].deadline
    ///     nonce    -> wallet.nonce() + i (assuming no external nonce consumption)
    ///     data     -> calls[i].data
    ///
    /// Signature/authorization rules enforced by UserWallet:
    ///   1) signature signer must equal calls[i].signatory
    ///   2) calls[i].signatory must be an authorized signatory in `wallet`
    ///   3) deadline must not be expired
    ///   4) calls must be executed in the same order they were signed
    ///      because each successful call increments wallet nonce by 1.
    ///
    /// Practical integration note:
    ///   If wallet nonce or balances changed after signing, regenerate payloads.
    /// -----------------------------------------------------------------------
    function executeSignedCalls(
        address wallet,
        SignedWalletCall[] calldata calls,
        bool continueOnFailure
    ) external returns (bool[] memory successes, bytes[] memory returnData) {
        if (wallet == address(0)) revert ZeroAddress();

        successes = new bool[](calls.length);
        returnData = new bytes[](calls.length);

        for (uint256 i = 0; i < calls.length; ++i) {
            (bool success, bytes memory result) = _executeWalletCall(
                wallet,
                calls[i].target,
                calls[i].signatory,
                calls[i].data,
                calls[i].signature,
                calls[i].deadline
            );

            successes[i] = success;
            returnData[i] = result;

            emit WalletCallExecuted(i, wallet, calls[i].target, success, result);

            if (!success && !continueOnFailure) {
                revert WalletCallFailed(i, result);
            }
        }
    }

    /// @notice Convenience flow: approve immutable adapter on Cadmos + listed tokens, then call `recoverAll`.
    /// @dev `signatures` and `deadlines` must be ordered as: cadmos approval, token approvals..., adapter recovery call.
    function executeRecoveryPlan(
        RecoveryPlan calldata plan
    ) external returns (bool[] memory successes, bytes[] memory returnData) {
        if (
            plan.wallet == address(0) ||
            plan.signatory == address(0) ||
            plan.destination == address(0)
        ) {
            revert ZeroAddress();
        }

        uint256 expectedLen = plan.tokens.length + 2;
        if (plan.signatures.length != expectedLen || plan.deadlines.length != expectedLen) {
            revert BadArrayLength();
        }

        successes = new bool[](expectedLen);
        returnData = new bytes[](expectedLen);

        // Step 0: approve Cadmos token to adapter.
        {
            bytes memory approveData = abi.encodeWithSelector(SELECTOR_APPROVE, adapter, type(uint256).max);
            (successes[0], returnData[0]) = _executeWalletCall(
                plan.wallet,
                plan.cadmosToken,
                plan.signatory,
                approveData,
                plan.signatures[0],
                plan.deadlines[0]
            );
            emit WalletCallExecuted(0, plan.wallet, plan.cadmosToken, successes[0], returnData[0]);
            if (!successes[0] && !plan.continueOnFailure) revert WalletCallFailed(0, returnData[0]);
        }

        // Step 1..N: approve each ERC20 token to adapter.
        for (uint256 i = 0; i < plan.tokens.length; ++i) {
            bytes memory approveData = abi.encodeWithSelector(SELECTOR_APPROVE, adapter, type(uint256).max);
            (successes[i + 1], returnData[i + 1]) = _executeWalletCall(
                plan.wallet,
                plan.tokens[i],
                plan.signatory,
                approveData,
                plan.signatures[i + 1],
                plan.deadlines[i + 1]
            );
            emit WalletCallExecuted(i + 1, plan.wallet, plan.tokens[i], successes[i + 1], returnData[i + 1]);
            if (!successes[i + 1] && !plan.continueOnFailure) revert WalletCallFailed(i + 1, returnData[i + 1]);
        }

        // Final step: run adapter.recoverAll.
        {
            uint256 finalIndex = expectedLen - 1;
            bytes memory recoverData = abi.encodeWithSelector(
                SELECTOR_RECOVER_ALL,
                plan.destination,
                plan.cadmosToken,
                plan.tokens
            );

            (successes[finalIndex], returnData[finalIndex]) = _executeWalletCall(
                plan.wallet,
                adapter,
                plan.signatory,
                recoverData,
                plan.signatures[finalIndex],
                plan.deadlines[finalIndex]
            );
            emit WalletCallExecuted(finalIndex, plan.wallet, adapter, successes[finalIndex], returnData[finalIndex]);
            if (!successes[finalIndex] && !plan.continueOnFailure) revert WalletCallFailed(finalIndex, returnData[finalIndex]);
        }
    }

    /// @notice Convenience flow with manual amount safeguards for Cadmos and ERC20 tokens.
    /// @dev `signatures` and `deadlines` must be ordered as: cadmos approval, token approvals..., adapter recovery call.
    function executeRecoveryPlanWithAmounts(
        RecoveryPlanWithAmounts calldata plan
    ) external returns (bool[] memory successes, bytes[] memory returnData) {
        if (
            plan.wallet == address(0) ||
            plan.signatory == address(0) ||
            plan.destination == address(0)
        ) {
            revert ZeroAddress();
        }

        uint256 expectedLen = plan.tokens.length + 2;
        if (plan.signatures.length != expectedLen || plan.deadlines.length != expectedLen) {
            revert BadArrayLength();
        }

        successes = new bool[](expectedLen);
        returnData = new bytes[](expectedLen);

        // Step 0: approve Cadmos token to adapter.
        {
            bytes memory approveData = abi.encodeWithSelector(SELECTOR_APPROVE, adapter, type(uint256).max);
            (successes[0], returnData[0]) = _executeWalletCall(
                plan.wallet,
                plan.cadmosToken,
                plan.signatory,
                approveData,
                plan.signatures[0],
                plan.deadlines[0]
            );
            emit WalletCallExecuted(0, plan.wallet, plan.cadmosToken, successes[0], returnData[0]);
            if (!successes[0] && !plan.continueOnFailure) revert WalletCallFailed(0, returnData[0]);
        }

        // Step 1..N: approve each ERC20 token to adapter.
        for (uint256 i = 0; i < plan.tokens.length; ++i) {
            bytes memory approveData = abi.encodeWithSelector(SELECTOR_APPROVE, adapter, type(uint256).max);
            (successes[i + 1], returnData[i + 1]) = _executeWalletCall(
                plan.wallet,
                plan.tokens[i],
                plan.signatory,
                approveData,
                plan.signatures[i + 1],
                plan.deadlines[i + 1]
            );
            emit WalletCallExecuted(i + 1, plan.wallet, plan.tokens[i], successes[i + 1], returnData[i + 1]);
            if (!successes[i + 1] && !plan.continueOnFailure) revert WalletCallFailed(i + 1, returnData[i + 1]);
        }

        // Final step: run adapter.recoverWithAmounts.
        {
            uint256 finalIndex = expectedLen - 1;
            bytes memory recoverData = abi.encodeWithSelector(
                SELECTOR_RECOVER_WITH_AMOUNTS,
                plan.destination,
                plan.cadmosToken,
                plan.cadmosAssetAmount,
                plan.tokens,
                plan.tokenAmounts
            );

            (successes[finalIndex], returnData[finalIndex]) = _executeWalletCall(
                plan.wallet,
                adapter,
                plan.signatory,
                recoverData,
                plan.signatures[finalIndex],
                plan.deadlines[finalIndex]
            );
            emit WalletCallExecuted(finalIndex, plan.wallet, adapter, successes[finalIndex], returnData[finalIndex]);
            if (!successes[finalIndex] && !plan.continueOnFailure) revert WalletCallFailed(finalIndex, returnData[finalIndex]);
        }
    }

    function _executeWalletCall(
        address wallet,
        address target,
        address signatory,
        bytes memory data,
        bytes memory signature,
        uint256 deadline
    ) internal returns (bool success, bytes memory result) {
        (success, result) = wallet.call(
            abi.encodeWithSelector(
                SELECTOR_WALLET_CALL,
                target,
                signatory,
                data,
                signature,
                deadline
            )
        );
    }
}
