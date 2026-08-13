import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createUnsignedRecoveryPlan,
  requiredRead,
} from "../shared/recoveryPlanning.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("required reads preserve legitimate zero values", async () => {
  const result = await requiredRead("USDC balance", async () => 0n);
  assert.equal(result, 0n);
});

test("required reads block plan generation on RPC or contract errors", async () => {
  await assert.rejects(
    requiredRead("USDC balance", async () => {
      throw new Error("RPC unavailable");
    }),
    /Recovery blocked: unable to read USDC balance.*RPC unavailable/,
  );
});

test("an exported plan binds only the selected operation to the live nonce", () => {
  const exported = createUnsignedRecoveryPlan(
    {
      chainId: 42161,
      controller: "0x4444444444444444444444444444444444444444",
      wallet: "0x1111111111111111111111111111111111111111",
      signatory: "0x2222222222222222222222222222222222222222",
      destination: "0x2222222222222222222222222222222222222222",
      currentNonce: 17n,
      mode: "standard",
      calls: [
        {
          target: "0x6666666666666666666666666666666666666666",
          data: "0xaaaa",
          deadline: 2_000_000_000n,
          note: "withdraw",
        },
        {
          target: "0x7777777777777777777777777777777777777777",
          data: "0xbbbb",
          deadline: 2_000_000_000n,
          note: "transfer",
        },
      ],
    },
    1,
  );

  assert.equal(exported.unsigned, true);
  assert.equal(exported.operations.length, 2);
  assert.equal(exported.nextStep.index, 1);
  assert.equal(exported.nextStep.typedData.message.nonce, 17n);
  assert.equal(exported.nextStep.typedData.message.data, "0xbbbb");
  assert.equal("signature" in exported.nextStep, false);
  assert.equal("executeSignedCallsInput" in exported, false);
});

test("an unsigned export rejects an operation outside the current live plan", () => {
  assert.throws(
    () =>
      createUnsignedRecoveryPlan(
        {
          calls: [
            {
              target: "0x6666666666666666666666666666666666666666",
              data: "0xaaaa",
              deadline: 2_000_000_000n,
              note: "withdraw",
            },
          ],
        },
        1,
      ),
    /outside the current plan \(0-0\)/,
  );
});

test("the CLI configuration and implementation contain no private-key signer", async () => {
  const [config, cliSource] = await Promise.all([
    readFile(path.join(repositoryRoot, "scripts", "recovery-config.example.json"), "utf8"),
    readFile(path.join(repositoryRoot, "scripts", "generateRecoveryPlan.mjs"), "utf8"),
  ]);

  assert.doesNotMatch(config, /privateKey/i);
  assert.doesNotMatch(cliSource, /privateKey|privateKeyToAccount|signTypedData/i);
});

test("the browser exports unsigned plans instead of pre-signed batches", async () => {
  const frontendSource = await readFile(
    path.join(repositoryRoot, "frontend", "app.js"),
    "utf8",
  );

  assert.doesNotMatch(frontendSource, /function safeRead|function signPlan|ensureGenerated/);
  assert.doesNotMatch(frontendSource, /executeSignedCallsCalldata/);
  assert.match(frontendSource, /createUnsignedRecoveryPlan/);
});
