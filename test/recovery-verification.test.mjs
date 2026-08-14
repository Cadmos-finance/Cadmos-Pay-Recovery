import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { encodeFunctionResult, keccak256, parseAbi } from "viem";

import {
  assertErc20TransferSimulation,
  assertSingleCallSimulation,
  evaluateOperationPostcondition,
  verifyContractIdentity,
} from "../shared/recoveryVerification.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const transferAbi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

test("contract identity verification accepts the pinned runtime hash", async () => {
  const bytecode = "0x6001600055";
  const expectedCodeHash = keccak256(bytecode);
  const publicClient = {
    async getBytecode() {
      return bytecode;
    },
  };

  const identity = await verifyContractIdentity(publicClient, {
    label: "RecoveryController",
    address: "0x1111111111111111111111111111111111111111",
    expectedCodeHash,
  });

  assert.equal(identity.codeHash, expectedCodeHash);
  assert.equal(identity.pinned, true);
});

test("contract identity verification rejects empty code and hash mismatches", async () => {
  await assert.rejects(
    verifyContractIdentity(
      {
        async getBytecode() {
          return "0x";
        },
      },
      {
        label: "Cadmos Smart Account",
        address: "0x1111111111111111111111111111111111111111",
      },
    ),
    /Cadmos Smart Account.*has no contract code/,
  );

  await assert.rejects(
    verifyContractIdentity(
      {
        async getBytecode() {
          return "0x6000";
        },
      },
      {
        label: "RecoveryController",
        address: "0x2222222222222222222222222222222222222222",
        expectedCodeHash: `0x${"11".repeat(32)}`,
      },
    ),
    /RecoveryController code hash mismatch/,
  );
});

test("ERC-20 target simulation accepts true and no-return tokens but rejects false", () => {
  const trueResult = encodeFunctionResult({
    abi: transferAbi,
    functionName: "transfer",
    result: true,
  });
  const falseResult = encodeFunctionResult({
    abi: transferAbi,
    functionName: "transfer",
    result: false,
  });

  assert.equal(assertErc20TransferSimulation("0x").returnStyle, "no-return");
  assert.equal(assertErc20TransferSimulation(trueResult).returnStyle, "boolean");
  assert.throws(
    () => assertErc20TransferSimulation(falseResult),
    /token transfer simulation returned false/,
  );
  assert.throws(
    () => assertErc20TransferSimulation("0x1234"),
    /malformed return data/,
  );
});

test("signed controller simulation must contain exactly one successful wallet call", () => {
  const accepted = assertSingleCallSimulation([[true], ["0x1234"]]);
  assert.equal(accepted.returnData, "0x1234");

  assert.throws(
    () => assertSingleCallSimulation([[false], ["0xdead"]]),
    /signed operation was rejected.*0xdead/,
  );
  assert.throws(
    () => assertSingleCallSimulation([[], []]),
    /unexpected result shape/,
  );
});

test("postconditions require the intended token decrease or a vault-state decrease", () => {
  const tokenVerified = evaluateOperationPostcondition(
    {
      metric: "erc20-balance",
      observedBefore: 100n,
      minimumDecrease: 40n,
    },
    60n,
  );
  const tokenIncomplete = evaluateOperationPostcondition(
    {
      metric: "erc20-balance",
      observedBefore: 100n,
      minimumDecrease: 40n,
    },
    61n,
  );
  const vaultVerified = evaluateOperationPostcondition(
    {
      metric: "max-withdraw",
      observedBefore: 100n,
      minimumDecrease: 100n,
    },
    99n,
  );

  assert.equal(tokenVerified.verified, true);
  assert.equal(tokenVerified.observedDecrease, 40n);
  assert.equal(tokenIncomplete.verified, false);
  assert.equal(vaultVerified.verified, true);
  assert.equal(
    evaluateOperationPostcondition(
      {
        metric: "max-redeem",
        observedBefore: 100n,
        minimumDecrease: 100n,
      },
      100n,
    ).verified,
    false,
  );
});

test("browser and CLI enforce black-box verification before execution or export", async () => {
  const [frontend, profile, cli, html] = await Promise.all([
    readFile(path.join(repositoryRoot, "frontend", "app.js"), "utf8"),
    readFile(path.join(repositoryRoot, "frontend", "profiles.js"), "utf8"),
    readFile(path.join(repositoryRoot, "scripts", "generateRecoveryPlan.mjs"), "utf8"),
    readFile(path.join(repositoryRoot, "frontend", "index.html"), "utf8"),
  ]);

  assert.match(profile, /controllerCodeHash/);
  assert.match(frontend, /verifyRecoveryContracts/);
  assert.match(frontend, /simulateContract/);
  assert.match(frontend, /assertSingleCallSimulation/);
  assert.match(frontend, /evaluateOperationPostcondition/);
  assert.match(frontend, /args:\s*\[plan\.wallet, callTuple, false\]/);
  assert.match(cli, /verifyRecoveryContracts/);
  assert.match(cli, /controllerCodeHash/);
  assert.match(html, /confirmUnknownTokensInput/);
});
