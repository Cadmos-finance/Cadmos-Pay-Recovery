// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../contracts/RecoveryController.sol";

contract MockUserWallet {
    uint256 public callCount;
    address public lastTarget;
    bytes public lastData;

    function call(
        address target,
        address,
        bytes calldata data,
        bytes calldata,
        uint256
    ) external returns (bytes memory) {
        callCount += 1;
        lastTarget = target;
        lastData = data;

        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }
}

contract MockTarget {
    uint256 public hits;

    function ping() external {
        hits += 1;
    }
}

contract MockReverter {
    error Boom();

    function fail() external pure {
        revert Boom();
    }
}

contract MockERC20Approve {
    address public lastSpender;
    uint256 public lastAmount;
    uint256 public approveCalls;

    function approve(address spender, uint256 amount) external returns (bool) {
        lastSpender = spender;
        lastAmount = amount;
        approveCalls += 1;
        return true;
    }
}

contract MockAdapter {
    uint256 public recoverAllCalls;
    uint256 public recoverWithAmountsCalls;
    address public lastDestination;
    address public lastCadmosToken;
    uint256 public lastCadmosAssetAmount;
    uint256[] public lastTokenAmounts;
    address[] public lastTokens;

    function recoverAll(
        address destination,
        address cadmosToken,
        address[] calldata tokens
    ) external returns (bool) {
        recoverAllCalls += 1;
        lastDestination = destination;
        lastCadmosToken = cadmosToken;
        delete lastTokens;
        for (uint256 i = 0; i < tokens.length; ++i) {
            lastTokens.push(tokens[i]);
        }
        return true;
    }

    function recoverWithAmounts(
        address destination,
        address cadmosToken,
        uint256 cadmosAssetAmount,
        address[] calldata tokens,
        uint256[] calldata tokenAmounts
    ) external returns (bool) {
        recoverWithAmountsCalls += 1;
        lastDestination = destination;
        lastCadmosToken = cadmosToken;
        lastCadmosAssetAmount = cadmosAssetAmount;

        delete lastTokens;
        for (uint256 i = 0; i < tokens.length; ++i) {
            lastTokens.push(tokens[i]);
        }

        delete lastTokenAmounts;
        for (uint256 i = 0; i < tokenAmounts.length; ++i) {
            lastTokenAmounts.push(tokenAmounts[i]);
        }

        return true;
    }
}

contract RecoveryControllerTest {
    MockAdapter internal adapter;
    RecoveryController internal controller;
    MockUserWallet internal wallet;

    function setUp() public {
        adapter = new MockAdapter();
        controller = new RecoveryController(address(adapter));
        wallet = new MockUserWallet();
    }

    function testExecuteSignedCallsContinueOnFailure() public {
        MockTarget ok1 = new MockTarget();
        MockReverter bad = new MockReverter();
        MockTarget ok2 = new MockTarget();

        RecoveryController.SignedWalletCall[] memory calls = new RecoveryController.SignedWalletCall[](3);
        calls[0] = _call(address(ok1), abi.encodeWithSignature("ping()"));
        calls[1] = _call(address(bad), abi.encodeWithSignature("fail()"));
        calls[2] = _call(address(ok2), abi.encodeWithSignature("ping()"));

        (bool[] memory successes, bytes[] memory returnData) =
            controller.executeSignedCalls(address(wallet), calls, true);

        require(successes.length == 3, "bad success length");
        require(successes[0], "call 0 should succeed");
        require(!successes[1], "call 1 should fail");
        require(successes[2], "call 2 should succeed");
        require(ok1.hits() == 1, "ok1 not hit");
        require(ok2.hits() == 1, "ok2 not hit");
        require(returnData[1].length >= 4, "missing revert data");
    }

    function testExecuteSignedCallsFailFastRevertsWithWalletCallFailed() public {
        MockTarget ok = new MockTarget();
        MockReverter bad = new MockReverter();

        RecoveryController.SignedWalletCall[] memory calls = new RecoveryController.SignedWalletCall[](2);
        calls[0] = _call(address(ok), abi.encodeWithSignature("ping()"));
        calls[1] = _call(address(bad), abi.encodeWithSignature("fail()"));

        (bool okCall, bytes memory ret) = address(controller).call(
            abi.encodeWithSelector(
                controller.executeSignedCalls.selector,
                address(wallet),
                calls,
                false
            )
        );

        require(!okCall, "expected revert");
        require(_selector(ret) == RecoveryController.WalletCallFailed.selector, "wrong revert selector");
    }

    function testExecuteRecoveryPlanUsesImmutableAdapter() public {
        MockERC20Approve cadmos = new MockERC20Approve();
        MockERC20Approve token1 = new MockERC20Approve();
        MockERC20Approve token2 = new MockERC20Approve();

        address[] memory tokens = new address[](2);
        tokens[0] = address(token1);
        tokens[1] = address(token2);

        bytes[] memory signatures = _dummySignatures(4);
        uint256[] memory deadlines = _deadlines(4);

        RecoveryController.RecoveryPlan memory plan = RecoveryController.RecoveryPlan({
            wallet: address(wallet),
            signatory: address(0xBEEF),
            cadmosToken: address(cadmos),
            destination: address(0xCAFE),
            tokens: tokens,
            signatures: signatures,
            deadlines: deadlines,
            continueOnFailure: true
        });

        (bool[] memory successes,) = controller.executeRecoveryPlan(plan);
        require(successes.length == 4, "bad length");
        for (uint256 i = 0; i < successes.length; ++i) {
            require(successes[i], "expected all success");
        }

        require(cadmos.lastSpender() == address(adapter), "cadmos spender mismatch");
        require(token1.lastSpender() == address(adapter), "token1 spender mismatch");
        require(token2.lastSpender() == address(adapter), "token2 spender mismatch");
        require(adapter.recoverAllCalls() == 1, "recoverAll not called");
        require(adapter.lastDestination() == address(0xCAFE), "bad destination");
    }

    function testExecuteRecoveryPlanWithAmountsUsesImmutableAdapter() public {
        MockERC20Approve cadmos = new MockERC20Approve();
        MockERC20Approve token1 = new MockERC20Approve();

        address[] memory tokens = new address[](1);
        tokens[0] = address(token1);

        uint256[] memory tokenAmounts = new uint256[](1);
        tokenAmounts[0] = 123;

        bytes[] memory signatures = _dummySignatures(3);
        uint256[] memory deadlines = _deadlines(3);

        RecoveryController.RecoveryPlanWithAmounts memory plan = RecoveryController.RecoveryPlanWithAmounts({
            wallet: address(wallet),
            signatory: address(0xBEEF),
            cadmosToken: address(cadmos),
            destination: address(0xCAFE),
            cadmosAssetAmount: 999,
            tokens: tokens,
            tokenAmounts: tokenAmounts,
            signatures: signatures,
            deadlines: deadlines,
            continueOnFailure: true
        });

        (bool[] memory successes,) = controller.executeRecoveryPlanWithAmounts(plan);
        require(successes.length == 3, "bad length");
        for (uint256 i = 0; i < successes.length; ++i) {
            require(successes[i], "expected all success");
        }

        require(cadmos.lastSpender() == address(adapter), "cadmos spender mismatch");
        require(token1.lastSpender() == address(adapter), "token spender mismatch");
        require(adapter.recoverWithAmountsCalls() == 1, "recoverWithAmounts not called");
        require(adapter.lastCadmosAssetAmount() == 999, "bad cadmos amount");
    }

    function testConstructorRevertsOnZeroAdapter() public {
        try new RecoveryController(address(0)) returns (RecoveryController) {
            revert("expected constructor revert");
        } catch (bytes memory reason) {
            require(_selector(reason) == RecoveryController.ZeroAddress.selector, "wrong revert selector");
        }
    }

    function testExecuteSignedCallsRevertsOnZeroWallet() public {
        RecoveryController.SignedWalletCall[] memory calls = new RecoveryController.SignedWalletCall[](0);

        (bool okCall, bytes memory reason) = address(controller).call(
            abi.encodeWithSelector(
                controller.executeSignedCalls.selector,
                address(0),
                calls,
                true
            )
        );

        require(!okCall, "expected revert");
        require(_selector(reason) == RecoveryController.ZeroAddress.selector, "wrong revert selector");
    }

    function testExecuteRecoveryPlanRevertsOnBadArrayLength() public {
        MockERC20Approve cadmos = new MockERC20Approve();

        address[] memory tokens = new address[](1);
        tokens[0] = address(new MockERC20Approve());

        bytes[] memory signatures = _dummySignatures(1);
        uint256[] memory deadlines = _deadlines(1);

        RecoveryController.RecoveryPlan memory plan = RecoveryController.RecoveryPlan({
            wallet: address(wallet),
            signatory: address(0xBEEF),
            cadmosToken: address(cadmos),
            destination: address(0xCAFE),
            tokens: tokens,
            signatures: signatures,
            deadlines: deadlines,
            continueOnFailure: true
        });

        (bool okCall, bytes memory reason) = address(controller).call(
            abi.encodeWithSelector(controller.executeRecoveryPlan.selector, plan)
        );

        require(!okCall, "expected revert");
        require(_selector(reason) == RecoveryController.BadArrayLength.selector, "wrong revert selector");
    }

    function testExecuteRecoveryPlanWithAmountsRevertsOnBadArrayLength() public {
        MockERC20Approve cadmos = new MockERC20Approve();

        address[] memory tokens = new address[](1);
        tokens[0] = address(new MockERC20Approve());

        uint256[] memory tokenAmounts = new uint256[](1);
        tokenAmounts[0] = 10;

        bytes[] memory signatures = _dummySignatures(1);
        uint256[] memory deadlines = _deadlines(1);

        RecoveryController.RecoveryPlanWithAmounts memory plan = RecoveryController.RecoveryPlanWithAmounts({
            wallet: address(wallet),
            signatory: address(0xBEEF),
            cadmosToken: address(cadmos),
            destination: address(0xCAFE),
            cadmosAssetAmount: 10,
            tokens: tokens,
            tokenAmounts: tokenAmounts,
            signatures: signatures,
            deadlines: deadlines,
            continueOnFailure: true
        });

        (bool okCall, bytes memory reason) = address(controller).call(
            abi.encodeWithSelector(controller.executeRecoveryPlanWithAmounts.selector, plan)
        );

        require(!okCall, "expected revert");
        require(_selector(reason) == RecoveryController.BadArrayLength.selector, "wrong revert selector");
    }

    function _call(address target, bytes memory data)
        internal
        pure
        returns (RecoveryController.SignedWalletCall memory c)
    {
        c = RecoveryController.SignedWalletCall({
            target: target,
            signatory: address(0xBEEF),
            data: data,
            signature: hex"1234",
            deadline: 9999999999
        });
    }

    function _dummySignatures(uint256 n) internal pure returns (bytes[] memory sigs) {
        sigs = new bytes[](n);
        for (uint256 i = 0; i < n; ++i) {
            sigs[i] = hex"1234";
        }
    }

    function _deadlines(uint256 n) internal pure returns (uint256[] memory ds) {
        ds = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) {
            ds[i] = 9999999999;
        }
    }

    function _selector(bytes memory reason) internal pure returns (bytes4 sel) {
        if (reason.length < 4) return bytes4(0);
        assembly {
            sel := mload(add(reason, 32))
        }
    }
}
