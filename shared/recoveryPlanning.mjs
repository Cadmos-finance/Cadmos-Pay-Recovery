const REQUEST_TYPES = {
  Request: [
    { name: "target", type: "address" },
    { name: "value", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "data", type: "bytes" },
  ],
};

function errorMessage(error) {
  if (error && typeof error === "object" && typeof error.shortMessage === "string") {
    return error.shortMessage;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function requiredRead(label, read) {
  try {
    return await read();
  } catch (error) {
    throw new Error(
      `Recovery blocked: unable to read ${label}. No plan was generated. ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

export function createUnsignedRecoveryPlan(plan, selectedOperation = 0) {
  if (!Array.isArray(plan.calls) || plan.calls.length === 0) {
    throw new Error("No recovery operations are available to export");
  }
  if (
    !Number.isSafeInteger(selectedOperation) ||
    selectedOperation < 0 ||
    selectedOperation >= plan.calls.length
  ) {
    throw new Error(
      `Selected operation ${selectedOperation} is outside the current plan (0-${plan.calls.length - 1})`,
    );
  }

  const operations = plan.calls.map((call, index) => ({
    index,
    target: call.target,
    value: 0n,
    data: call.data,
    deadline: call.deadline,
    note: call.note,
  }));
  const operation = operations[selectedOperation];
  const typedData = {
    domain: {
      name: "Cadmos UserWallet",
      version: "1",
      chainId: plan.chainId,
      verifyingContract: plan.wallet,
    },
    types: REQUEST_TYPES,
    primaryType: "Request",
    message: {
      target: operation.target,
      value: operation.value,
      deadline: operation.deadline,
      nonce: plan.currentNonce,
      data: operation.data,
    },
  };

  return {
    format: "cadmos-unsigned-recovery-plan-v1",
    unsigned: true,
    chainId: plan.chainId,
    controller: plan.controller,
    wallet: plan.wallet,
    signatory: plan.signatory,
    destination: plan.destination,
    mode: plan.mode,
    currentNonce: plan.currentNonce,
    operations,
    nextStep: {
      index: selectedOperation,
      signatory: plan.signatory,
      operation,
      typedData,
    },
    warnings: [
      "This file is unsigned and cannot move funds.",
      "Only nextStep is bound to the current live wallet nonce.",
      "Sign and submit only nextStep, then regenerate the plan before any later operation.",
      "If a read, signature, or transaction fails, do not reuse this plan.",
    ],
  };
}
