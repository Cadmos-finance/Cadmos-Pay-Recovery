import { readFile } from "node:fs/promises";

import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  parseAbi,
} from "viem";

import {
  createUnsignedRecoveryPlan,
  requiredRead,
} from "../shared/recoveryPlanning.mjs";

const userWalletAbi = parseAbi(["function nonce() view returns (uint256)"]);
const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);
const cadmosAbi = parseAbi([
  "function maxWithdraw(address owner) view returns (uint256)",
  "function maxRedeem(address owner) view returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
]);

function parseAddress(label, value) {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`${label} is not a valid address`);
  }
  return getAddress(value);
}

function parseBigInt(value, fallback = 0n) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = BigInt(value);
  if (parsed < 0n) throw new Error("Recovery amounts cannot be negative");
  return parsed;
}

function min(a, b) {
  return a < b ? a : b;
}

function parseSelectedOperation(args) {
  const equalsArgument = args.find((argument) => argument.startsWith("--step="));
  const flagIndex = args.indexOf("--step");
  const raw = equalsArgument?.slice("--step=".length) ??
    (flagIndex >= 0 ? args[flagIndex + 1] : "0");
  const parsed = Number(raw);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("--step must be a non-negative integer");
  }
  return parsed;
}

async function loadConfig(configPath) {
  const raw = JSON.parse(await readFile(configPath, "utf8"));
  const mode = raw.mode ?? "all";
  if (mode !== "all" && mode !== "withAmounts") {
    throw new Error('mode must be either "all" or "withAmounts"');
  }

  const deadlineSeconds = Number(raw.deadlineSeconds ?? 3600);
  if (!Number.isSafeInteger(deadlineSeconds) || deadlineSeconds < 120) {
    throw new Error("deadlineSeconds must be an integer of at least 120 seconds");
  }

  const expectedChainId = Number(raw.chainId);
  if (!Number.isSafeInteger(expectedChainId) || expectedChainId <= 0) {
    throw new Error("chainId must be a positive integer");
  }
  if (typeof raw.rpcUrl !== "string" || raw.rpcUrl.length === 0) {
    throw new Error("rpcUrl is required");
  }
  if (!Array.isArray(raw.tokens)) {
    throw new Error("tokens must be an array of token addresses");
  }
  if (raw.tokenAmounts !== undefined && !Array.isArray(raw.tokenAmounts)) {
    throw new Error("tokenAmounts must be an array of integer strings");
  }
  if (
    raw.includeRedeemFallback !== undefined &&
    typeof raw.includeRedeemFallback !== "boolean"
  ) {
    throw new Error("includeRedeemFallback must be a boolean");
  }

  return {
    rpcUrl: raw.rpcUrl,
    chainId: expectedChainId,
    wallet: parseAddress("wallet", raw.wallet),
    signatory: parseAddress("signatory", raw.signatory),
    controller: parseAddress("controller", raw.controller),
    cadmosToken: parseAddress("cadmosToken", raw.cadmosToken),
    tokens: raw.tokens.map((token, index) =>
      parseAddress(`tokens[${index}]`, token),
    ),
    deadlineSeconds,
    mode,
    cadmosAssetAmount: raw.cadmosAssetAmount,
    tokenAmounts: raw.tokenAmounts ?? [],
    includeRedeemFallback: raw.includeRedeemFallback ?? true,
  };
}

async function buildPlan(config) {
  const publicClient = createPublicClient({ transport: http(config.rpcUrl) });
  const chainId = await requiredRead("RPC chain ID", () => publicClient.getChainId());
  if (chainId !== config.chainId) {
    throw new Error(`Wrong network: expected chain ${config.chainId}, RPC returned ${chainId}`);
  }

  const currentNonce = await requiredRead("UserWallet nonce", () =>
    publicClient.readContract({
      address: config.wallet,
      abi: userWalletAbi,
      functionName: "nonce",
    }),
  );
  const deadline = BigInt(Math.floor(Date.now() / 1000) + config.deadlineSeconds);
  const destination = config.signatory;
  const calls = [];

  const maxWithdraw = await requiredRead("Cadmos maxWithdraw", () =>
    publicClient.readContract({
      address: config.cadmosToken,
      abi: cadmosAbi,
      functionName: "maxWithdraw",
      args: [config.wallet],
    }),
  );
  const requestedCadmos = parseBigInt(config.cadmosAssetAmount);
  const withdrawAssets =
    config.mode === "withAmounts" && requestedCadmos > 0n
      ? min(requestedCadmos, maxWithdraw)
      : maxWithdraw;

  if (withdrawAssets > 0n) {
    calls.push({
      target: config.cadmosToken,
      data: encodeFunctionData({
        abi: cadmosAbi,
        functionName: "withdraw",
        args: [withdrawAssets, destination, config.wallet],
      }),
      deadline,
      note: `cadmos.withdraw assets=${withdrawAssets}`,
    });
  }

  if (config.mode === "all" && config.includeRedeemFallback) {
    const maxRedeem = await requiredRead("Cadmos maxRedeem", () =>
      publicClient.readContract({
        address: config.cadmosToken,
        abi: cadmosAbi,
        functionName: "maxRedeem",
        args: [config.wallet],
      }),
    );

    if (maxRedeem > 0n) {
      calls.push({
        target: config.cadmosToken,
        data: encodeFunctionData({
          abi: cadmosAbi,
          functionName: "redeem",
          args: [maxRedeem, destination, config.wallet],
        }),
        deadline,
        note: `cadmos.redeem shares=${maxRedeem} (fallback only)`,
      });
    }
  }

  const tokenCaps = config.tokenAmounts.map((value) => parseBigInt(value));
  for (let index = 0; index < config.tokens.length; index += 1) {
    const token = config.tokens[index];
    const balance = await requiredRead(`token balance ${token}`, () =>
      publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [config.wallet],
      }),
    );
    const cap = tokenCaps[index] ?? 0n;
    const transferAmount = cap > 0n ? min(balance, cap) : balance;

    if (transferAmount > 0n) {
      calls.push({
        target: token,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [destination, transferAmount],
        }),
        deadline,
        note: `token.transfer token=${token} amount=${transferAmount}`,
      });
    }
  }

  return {
    chainId,
    controller: config.controller,
    wallet: config.wallet,
    signatory: config.signatory,
    destination,
    currentNonce,
    mode: config.mode,
    calls,
  };
}

function bigintReplacer(_, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

async function main() {
  const configPath = process.argv[2] ?? "./scripts/recovery-config.json";
  const selectedOperation = parseSelectedOperation(process.argv.slice(3));
  const config = await loadConfig(configPath);
  const plan = await buildPlan(config);
  const output = createUnsignedRecoveryPlan(plan, selectedOperation);
  process.stdout.write(`${JSON.stringify(output, bigintReplacer, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
