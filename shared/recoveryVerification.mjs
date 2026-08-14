import { decodeFunctionResult, keccak256, parseAbi } from "viem";

import { requiredRead } from "./recoveryPlanning.mjs";

const erc20TransferAbi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

function errorMessage(error) {
  if (error && typeof error === "object" && typeof error.shortMessage === "string") {
    return error.shortMessage;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function requiredVerification(
  label,
  verify,
  consequence = "The operation was not broadcast.",
) {
  try {
    return await verify();
  } catch (error) {
    throw new Error(
      `Recovery blocked: ${label} failed. ${consequence} ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

export async function verifyContractIdentity(
  publicClient,
  { label, address, expectedCodeHash },
) {
  const bytecode = await requiredRead(`${label} bytecode`, () =>
    publicClient.getBytecode({ address }),
  );

  if (!bytecode || bytecode === "0x") {
    throw new Error(
      `Recovery blocked: ${label} at ${address} has no contract code. No plan was generated.`,
    );
  }

  const codeHash = keccak256(bytecode);
  if (
    expectedCodeHash &&
    codeHash.toLowerCase() !== expectedCodeHash.toLowerCase()
  ) {
    throw new Error(
      `Recovery blocked: ${label} code hash mismatch at ${address}. ` +
        `Expected ${expectedCodeHash}, received ${codeHash}. No plan was generated.`,
    );
  }

  return {
    label,
    address,
    codeHash,
    pinned: Boolean(expectedCodeHash),
  };
}

export async function verifyRecoveryContracts(
  publicClient,
  { wallet, controller, controllerCodeHash, cadmosToken, tokens = [] },
) {
  const uniqueTokens = [...new Set(tokens.map((token) => token.toLowerCase()))];
  const tokenByLowercase = new Map(
    tokens.map((token) => [token.toLowerCase(), token]),
  );

  const [controllerIdentity, walletIdentity, cadmosIdentity, ...tokenIdentities] =
    await Promise.all([
      verifyContractIdentity(publicClient, {
        label: "RecoveryController",
        address: controller,
        expectedCodeHash: controllerCodeHash,
      }),
      verifyContractIdentity(publicClient, {
        label: "Cadmos Smart Account",
        address: wallet,
      }),
      verifyContractIdentity(publicClient, {
        label: "Cadmos Token/Vault",
        address: cadmosToken,
      }),
      ...uniqueTokens.map((token) =>
        verifyContractIdentity(publicClient, {
          label: `ERC-20 token ${tokenByLowercase.get(token)}`,
          address: tokenByLowercase.get(token),
        }),
      ),
    ]);

  return {
    controller: controllerIdentity,
    wallet: walletIdentity,
    cadmosToken: cadmosIdentity,
    tokens: tokenIdentities,
  };
}

export function assertErc20TransferSimulation(data) {
  if (!data || data === "0x") {
    return { returnStyle: "no-return" };
  }

  let returned;
  try {
    returned = decodeFunctionResult({
      abi: erc20TransferAbi,
      functionName: "transfer",
      data,
    });
  } catch (error) {
    throw new Error(
      `Recovery blocked: token transfer simulation returned malformed return data. ${errorMessage(error)}`,
    );
  }

  if (returned !== true) {
    throw new Error("Recovery blocked: token transfer simulation returned false.");
  }

  return { returnStyle: "boolean" };
}

export function assertSingleCallSimulation(result) {
  const successes = Array.isArray(result) ? result[0] : result?.successes;
  const returnData = Array.isArray(result) ? result[1] : result?.returnData;

  if (
    !Array.isArray(successes) ||
    !Array.isArray(returnData) ||
    successes.length !== 1 ||
    returnData.length !== 1
  ) {
    throw new Error(
      "Recovery blocked: signed simulation returned an unexpected result shape. The signed operation was not broadcast.",
    );
  }

  if (successes[0] !== true) {
    throw new Error(
      `Recovery blocked: signed operation was rejected by the Cadmos Smart Account. The signed operation was not broadcast. ${returnData[0]}`,
    );
  }

  return { returnData: returnData[0] };
}

export function evaluateOperationPostcondition(verification, observedAfter) {
  const observedBefore = BigInt(verification.observedBefore);
  const after = BigInt(observedAfter);
  const minimumDecrease = BigInt(verification.minimumDecrease);
  const observedDecrease = after < observedBefore ? observedBefore - after : 0n;

  let verified;
  if (verification.metric === "erc20-balance") {
    verified = minimumDecrease > 0n && observedDecrease >= minimumDecrease;
  } else if (
    verification.metric === "max-withdraw" ||
    verification.metric === "max-redeem"
  ) {
    verified = observedDecrease > 0n;
  } else {
    throw new Error(
      `Unknown recovery verification metric: ${verification.metric}`,
    );
  }

  return {
    metric: verification.metric,
    verified,
    observedBefore,
    observedAfter: after,
    observedDecrease,
    minimumDecrease,
  };
}
