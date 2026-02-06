import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

type Address = `0x${string}`;
type Hex = `0x${string}`;

type RecoverMode = "all" | "withAmounts";

type Config = {
  rpcUrl: string;
  privateKey: Hex;
  wallet: Address;
  signatory: Address;
  controller: Address;
  cadmosToken: Address;
  tokens: Address[];
  deadlineSeconds: number;
  mode: RecoverMode;
  cadmosAssetAmount?: string;
  tokenAmounts?: string[];
  includeRedeemFallback?: boolean;
};

type CallPayload = {
  target: Address;
  signatory: Address;
  data: Hex;
  signature: Hex;
  deadline: string;
  nonce: string;
};

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

function loadConfig(path: string): Config {
  return JSON.parse(readFileSync(path, "utf8")) as Config;
}

function parseBigInt(value: string | undefined, fallback: bigint = 0n): bigint {
  if (!value || value.length === 0) return fallback;
  return BigInt(value);
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

async function safeRead<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

async function main() {
  const configPath = process.argv[2] ?? "./recovery/scripts/recovery-config.example.json";
  const config = loadConfig(configPath);

  const account = privateKeyToAccount(config.privateKey);
  if (account.address.toLowerCase() !== config.signatory.toLowerCase()) {
    throw new Error("private key does not match config.signatory");
  }

  const publicClient = createPublicClient({ transport: http(config.rpcUrl) });
  const walletClient = createWalletClient({ account, transport: http(config.rpcUrl) });

  const chainId = await publicClient.getChainId();
  const currentNonce = await publicClient.readContract({
    address: config.wallet,
    abi: userWalletAbi,
    functionName: "nonce",
  });

  const baseDeadline = BigInt(Math.floor(Date.now() / 1000) + config.deadlineSeconds);
  const includeRedeemFallback = config.includeRedeemFallback ?? true;
  const destination = config.signatory;

  const tokenCaps = (config.tokenAmounts ?? []).map((v) => parseBigInt(v, 0n));
  const unsignedCalls: Array<{ target: Address; data: Hex; deadline: bigint; note: string }> = [];

  const maxWithdraw = await safeRead(
    () =>
      publicClient.readContract({
        address: config.cadmosToken,
        abi: cadmosAbi,
        functionName: "maxWithdraw",
        args: [config.wallet],
      }),
    0n
  );

  const requestedCadmos = parseBigInt(config.cadmosAssetAmount, 0n);
  const withdrawAssets =
    config.mode === "withAmounts" && requestedCadmos > 0n
      ? (maxWithdraw > 0n ? min(requestedCadmos, maxWithdraw) : requestedCadmos)
      : maxWithdraw;

  if (withdrawAssets > 0n) {
    unsignedCalls.push({
      target: config.cadmosToken,
      data: encodeFunctionData({
        abi: cadmosAbi,
        functionName: "withdraw",
        args: [withdrawAssets, destination, config.wallet],
      }),
      deadline: baseDeadline,
      note: `cadmos.withdraw assets=${withdrawAssets}`,
    });
  }

  if (config.mode === "all" && includeRedeemFallback) {
    const maxRedeem = await safeRead(
      () =>
        publicClient.readContract({
          address: config.cadmosToken,
          abi: cadmosAbi,
          functionName: "maxRedeem",
          args: [config.wallet],
        }),
      0n
    );

    if (maxRedeem > 0n) {
      unsignedCalls.push({
        target: config.cadmosToken,
        data: encodeFunctionData({
          abi: cadmosAbi,
          functionName: "redeem",
          args: [maxRedeem, destination, config.wallet],
        }),
        deadline: baseDeadline,
        note: `cadmos.redeem shares=${maxRedeem}`,
      });
    }
  }

  for (let i = 0; i < config.tokens.length; i++) {
    const token = config.tokens[i];
    const balance = await safeRead(
      () =>
        publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [config.wallet],
        }),
      0n
    );

    const cap = i < tokenCaps.length ? tokenCaps[i] : 0n;
    const transferAmount = cap > 0n ? min(balance, cap) : balance;

    if (transferAmount == 0n) continue;

    unsignedCalls.push({
      target: token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [destination, transferAmount],
      }),
      deadline: baseDeadline,
      note: `token.transfer token=${token} amount=${transferAmount}`,
    });
  }

  const signedCalls: CallPayload[] = [];

  for (let i = 0; i < unsignedCalls.length; i++) {
    const nonce = currentNonce + BigInt(i);
    const call = unsignedCalls[i];

    const signature = await walletClient.signTypedData({
      account,
      domain: {
        name: "Cadmos UserWallet",
        version: "1",
        chainId,
        verifyingContract: config.wallet,
      },
      types: {
        Request: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
      primaryType: "Request",
      message: {
        target: call.target,
        value: 0n,
        deadline: call.deadline,
        nonce,
        data: call.data,
      },
    });

    signedCalls.push({
      target: call.target,
      signatory: config.signatory,
      data: call.data,
      signature,
      deadline: call.deadline.toString(),
      nonce: nonce.toString(),
    });
  }

  const output = {
    chainId,
    wallet: config.wallet,
    controller: config.controller,
    continueOnFailure: true,
    mode: config.mode,
    callPlanNotes: unsignedCalls.map((c) => c.note),
    executeSignedCallsInput: {
      wallet: config.wallet,
      calls: signedCalls,
      continueOnFailure: true,
    },
    notes: [
      "Direct mode: UserWallet calls Cadmos/ERC20 contracts directly. No approvals needed.",
      "Destination is the signatory wallet in this script mode.",
      "Call order must remain unchanged or signatures fail (nonce mismatch).",
      "If wallet balances change before execution, regenerate signatures.",
    ],
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
