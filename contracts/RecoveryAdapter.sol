// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/// @title Cadmos wallet recovery adapter
/// @notice Called by a Cadmos `UserWallet` to sweep Cadmos vault assets and ERC20 balances.
/// @dev This contract never takes custody for itself. It pulls from `msg.sender` (the wallet).
contract RecoveryAdapter {
    bytes4 private constant SELECTOR_MAX_WITHDRAW = bytes4(keccak256("maxWithdraw(address)"));
    bytes4 private constant SELECTOR_WITHDRAW = bytes4(keccak256("withdraw(uint256,address,address)"));
    bytes4 private constant SELECTOR_MAX_REDEEM = bytes4(keccak256("maxRedeem(address)"));
    bytes4 private constant SELECTOR_REDEEM = bytes4(keccak256("redeem(uint256,address,address)"));
    bytes4 private constant SELECTOR_BALANCE_OF = bytes4(keccak256("balanceOf(address)"));
    bytes4 private constant SELECTOR_TRANSFER_FROM = bytes4(keccak256("transferFrom(address,address,uint256)"));

    uint8 private constant MODE_WITHDRAW = 1;
    uint8 private constant MODE_REDEEM_FALLBACK = 2;

    error ZeroAddress();

    event CadmosRecoveryResult(
        address indexed wallet,
        address indexed cadmosToken,
        address indexed destination,
        uint8 mode,
        uint256 requestedAmount,
        uint256 attemptedAmount,
        bool success,
        bytes returnData
    );

    event ERC20RecoveryResult(
        address indexed wallet,
        address indexed token,
        address indexed destination,
        uint256 walletBalance,
        uint256 requestedAmount,
        uint256 attemptedAmount,
        bool success,
        bytes returnData
    );

    /// @notice Recover all available Cadmos vault assets and all listed ERC20 balances.
    /// @param destination Receiver of recovered funds.
    /// @param cadmosToken Cadmos token/vault contract.
    /// @param tokens Arbitrary ERC20 token addresses to sweep.
    function recoverAll(
        address destination,
        address cadmosToken,
        address[] calldata tokens
    ) external returns (bool cadmosSuccess) {
        if (destination == address(0)) revert ZeroAddress();

        if (cadmosToken != address(0)) {
            cadmosSuccess = _recoverCadmos(msg.sender, destination, cadmosToken, 0);
        }

        for (uint256 i = 0; i < tokens.length; ++i) {
            _recoverToken(msg.sender, destination, tokens[i], 0);
        }
    }

    /// @notice Recover Cadmos and ERC20 with optional per-asset limits.
    /// @dev For each ERC20, if `tokenAmounts[i] == 0` or not provided, full wallet balance is attempted.
    /// @param destination Receiver of recovered funds.
    /// @param cadmosToken Cadmos token/vault contract.
    /// @param cadmosAssetAmount Requested Cadmos asset amount. `0` means full default path.
    /// @param tokens Arbitrary ERC20 token addresses to sweep.
    /// @param tokenAmounts Optional caps per token index.
    function recoverWithAmounts(
        address destination,
        address cadmosToken,
        uint256 cadmosAssetAmount,
        address[] calldata tokens,
        uint256[] calldata tokenAmounts
    ) external returns (bool cadmosSuccess) {
        if (destination == address(0)) revert ZeroAddress();

        if (cadmosToken != address(0)) {
            cadmosSuccess = _recoverCadmos(msg.sender, destination, cadmosToken, cadmosAssetAmount);
        }

        for (uint256 i = 0; i < tokens.length; ++i) {
            uint256 requested = i < tokenAmounts.length ? tokenAmounts[i] : 0;
            _recoverToken(msg.sender, destination, tokens[i], requested);
        }
    }

    function _recoverCadmos(
        address wallet,
        address destination,
        address cadmosToken,
        uint256 requestedAssets
    ) internal returns (bool success) {
        uint256 maxWithdrawAssets;
        bool maxWithdrawOk;
        bytes memory maxWithdrawData;

        (maxWithdrawOk, maxWithdrawData) = cadmosToken.staticcall(
            abi.encodeWithSelector(SELECTOR_MAX_WITHDRAW, wallet)
        );

        if (maxWithdrawOk && maxWithdrawData.length >= 32) {
            maxWithdrawAssets = abi.decode(maxWithdrawData, (uint256));
        }

        uint256 assetsToAttempt;
        if (requestedAssets == 0) {
            if (!maxWithdrawOk) {
                emit CadmosRecoveryResult(
                    wallet,
                    cadmosToken,
                    destination,
                    MODE_WITHDRAW,
                    0,
                    0,
                    false,
                    maxWithdrawData
                );
                return false;
            }
            assetsToAttempt = maxWithdrawAssets;
        } else {
            assetsToAttempt = maxWithdrawOk ? _min(requestedAssets, maxWithdrawAssets) : requestedAssets;
        }

        if (assetsToAttempt == 0) {
            emit CadmosRecoveryResult(
                wallet,
                cadmosToken,
                destination,
                MODE_WITHDRAW,
                requestedAssets,
                0,
                true,
                ""
            );
            return true;
        }

        bytes memory withdrawData;
        (success, withdrawData) = cadmosToken.call(
            abi.encodeWithSelector(SELECTOR_WITHDRAW, assetsToAttempt, destination, wallet)
        );

        emit CadmosRecoveryResult(
            wallet,
            cadmosToken,
            destination,
            MODE_WITHDRAW,
            requestedAssets,
            assetsToAttempt,
            success,
            withdrawData
        );

        // Best-effort fallback for default all-in mode: redeem full shares if asset withdraw failed.
        if (!success && requestedAssets == 0) {
            success = _recoverCadmosByRedeemFallback(wallet, destination, cadmosToken);
        }
    }

    function _recoverCadmosByRedeemFallback(
        address wallet,
        address destination,
        address cadmosToken
    ) internal returns (bool success) {
        bool maxRedeemOk;
        bytes memory maxRedeemData;
        (maxRedeemOk, maxRedeemData) = cadmosToken.staticcall(
            abi.encodeWithSelector(SELECTOR_MAX_REDEEM, wallet)
        );

        if (!maxRedeemOk || maxRedeemData.length < 32) {
            emit CadmosRecoveryResult(
                wallet,
                cadmosToken,
                destination,
                MODE_REDEEM_FALLBACK,
                0,
                0,
                false,
                maxRedeemData
            );
            return false;
        }

        uint256 sharesToRedeem = abi.decode(maxRedeemData, (uint256));
        if (sharesToRedeem == 0) {
            emit CadmosRecoveryResult(
                wallet,
                cadmosToken,
                destination,
                MODE_REDEEM_FALLBACK,
                0,
                0,
                true,
                ""
            );
            return true;
        }

        bytes memory redeemData;
        (success, redeemData) = cadmosToken.call(
            abi.encodeWithSelector(SELECTOR_REDEEM, sharesToRedeem, destination, wallet)
        );

        emit CadmosRecoveryResult(
            wallet,
            cadmosToken,
            destination,
            MODE_REDEEM_FALLBACK,
            0,
            sharesToRedeem,
            success,
            redeemData
        );
    }

    function _recoverToken(
        address wallet,
        address destination,
        address token,
        uint256 requestedAmount
    ) internal {
        if (token == address(0)) {
            emit ERC20RecoveryResult(wallet, token, destination, 0, requestedAmount, 0, false, "");
            return;
        }

        bool balanceOk;
        bytes memory balanceData;
        (balanceOk, balanceData) = token.staticcall(
            abi.encodeWithSelector(SELECTOR_BALANCE_OF, wallet)
        );

        if (!balanceOk || balanceData.length < 32) {
            emit ERC20RecoveryResult(wallet, token, destination, 0, requestedAmount, 0, false, balanceData);
            return;
        }

        uint256 balance = abi.decode(balanceData, (uint256));
        uint256 amountToAttempt = requestedAmount == 0 ? balance : _min(balance, requestedAmount);

        if (amountToAttempt == 0) {
            emit ERC20RecoveryResult(wallet, token, destination, balance, requestedAmount, 0, true, "");
            return;
        }

        bool success;
        bytes memory transferData;
        (success, transferData) = token.call(
            abi.encodeWithSelector(SELECTOR_TRANSFER_FROM, wallet, destination, amountToAttempt)
        );

        if (success && transferData.length > 0) {
            if (transferData.length >= 32) {
                success = abi.decode(transferData, (bool));
            } else {
                success = false;
            }
        }

        emit ERC20RecoveryResult(
            wallet,
            token,
            destination,
            balance,
            requestedAmount,
            amountToAttempt,
            success,
            transferData
        );
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
