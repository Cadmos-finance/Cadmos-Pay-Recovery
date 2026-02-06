import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  isAddress,
  parseAbi,
} from "https://esm.sh/viem@2.24.3";
import { CADMOS_PROFILES } from "./profiles.js";

const walletAbi = parseAbi(["function nonce() view returns (uint256)"]);

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

const controllerAbi = parseAbi([
  "function executeSignedCalls(address wallet, (address target,address signatory,bytes data,bytes signature,uint256 deadline)[] calls, bool continueOnFailure) returns (bool[] successes, bytes[] returnData)",
  "event WalletCallExecuted(uint256 indexed index,address indexed wallet,address indexed target,bool success,bytes returnData)",
]);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const STORAGE_KEY = "cadmos_panic_recovery_v1";
const DEFAULT_CHAIN_ID = 42161;
const DEFAULT_CHAIN_HEX = "0xa4b1";
const SELECTOR_WITHDRAW = "0xb460af94";
const SELECTOR_REDEEM = "0xba087652";
const ARBITRUM_CHAIN = {
  id: DEFAULT_CHAIN_ID,
  name: "Arbitrum One",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://arb1.arbitrum.io/rpc"] },
    public: { http: ["https://arb1.arbitrum.io/rpc"] },
  },
  blockExplorers: {
    default: { name: "Arbiscan", url: "https://arbiscan.io" },
  },
};
const DEFAULT_OUTPUT_MESSAGE =
  "Connect your signatory wallet, paste your Cadmos Smart Account address, then click \"Scan & Build Plan\".\n\n" +
  "Before recovering, review:\n" +
  "- Network\n" +
  "- Destination address\n" +
  "- Token list + amounts\n" +
  "- Number of steps\n\n" +
  "Only proceed if everything looks correct.";

const state = {
  account: null,
  chainId: null,
  profile: null,
  scannedPlan: null,
  generated: null,
  generatedFingerprint: null,
};

const els = {
  connectBtn: document.getElementById("connectBtn"),
  walletBadge: document.getElementById("walletBadge"),
  chainBadge: document.getElementById("chainBadge"),
  profileBadge: document.getElementById("profileBadge"),
  nonceBadge: document.getElementById("nonceBadge"),
  chainWarning: document.getElementById("chainWarning"),

  controllerInput: document.getElementById("controllerInput"),
  cadmosInput: document.getElementById("cadmosInput"),
  knownTokensView: document.getElementById("knownTokensView"),

  walletInput: document.getElementById("walletInput"),
  signatoryInput: document.getElementById("signatoryInput"),
  deadlineInput: document.getElementById("deadlineInput"),
  modeInput: document.getElementById("modeInput"),
  continueOnFailureInput: document.getElementById("continueOnFailureInput"),
  includeRedeemFallbackInput: document.getElementById("includeRedeemFallbackInput"),
  extraTokensInput: document.getElementById("extraTokensInput"),

  manualSection: document.getElementById("manualSection"),
  cadmosManualAmountInput: document.getElementById("cadmosManualAmountInput"),
  tokenOverridesInput: document.getElementById("tokenOverridesInput"),
  confirmReviewInput: document.getElementById("confirmReviewInput"),

  scanBtn: document.getElementById("scanBtn"),
  recoverBtn: document.getElementById("recoverBtn"),
  copyJsonBtn: document.getElementById("copyJsonBtn"),
  downloadJsonBtn: document.getElementById("downloadJsonBtn"),
  copyCalldataBtn: document.getElementById("copyCalldataBtn"),

  output: document.getElementById("output"),
};

function setOutput(value) {
  els.output.textContent = value;
}

function setChainWarning(message) {
  if (!message) {
    els.chainWarning.classList.remove("active");
    return;
  }
  els.chainWarning.textContent = message;
  els.chainWarning.classList.add("active");
}

function updateChainBadge() {
  if (state.chainId === DEFAULT_CHAIN_ID && state.profile) {
    els.chainBadge.textContent = `Chain: ${state.profile.chainName} (${state.chainId})`;
    return;
  }
  if (state.chainId !== null) {
    els.chainBadge.textContent = `Chain: ${state.chainId}`;
    return;
  }
  els.chainBadge.textContent = "Chain: Not detected";
}

function syncRecoverButtonState() {
  els.recoverBtn.disabled = !state.account || !els.confirmReviewInput.checked;
}

function clearGeneratedState() {
  state.scannedPlan = null;
  state.generated = null;
  state.generatedFingerprint = null;
}

async function enforceExpectedChain(publicClient) {
  const liveChainId = await publicClient.getChainId();
  state.chainId = liveChainId;
  updateChainBadge();

  if (liveChainId !== DEFAULT_CHAIN_ID) {
    setChainWarning("Stop: wallet network does not match Arbitrum One (42161). Switch network before proceeding.");
    syncRecoverButtonState();
    throw new Error("Wrong network. Switch wallet to Arbitrum One (42161).");
  }

  setChainWarning("");
  syncRecoverButtonState();
  return liveChainId;
}

function parseChainIdValue(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    const parsedHex = Number.parseInt(trimmed, 16);
    return Number.isNaN(parsedHex) ? null : parsedHex;
  }
  const parsedDec = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsedDec) ? null : parsedDec;
}

function bigintReplacer(_, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function inputFingerprint() {
  return JSON.stringify({
    wallet: els.walletInput.value.trim(),
    deadline: els.deadlineInput.value.trim(),
    mode: els.modeInput.value,
    continueOnFailure: els.continueOnFailureInput.checked,
    includeRedeemFallback: els.includeRedeemFallbackInput.checked,
    extraTokens: els.extraTokensInput.value,
    cadmosManualAmount: els.cadmosManualAmountInput.value.trim(),
    tokenOverrides: els.tokenOverridesInput.value,
    chainId: state.chainId,
    profileController: state.profile?.controller ?? "",
    profileCadmosToken: state.profile?.cadmosToken ?? "",
  });
}

function parseAddress(label, value) {
  if (!isAddress(value)) {
    throw new Error(`${label} is not a valid address`);
  }
  const normalized = getAddress(value);
  if (normalized === ZERO_ADDRESS) {
    throw new Error(`${label} cannot be zero address`);
  }
  return normalized;
}

function parseTokenList(raw) {
  const split = raw
    .split(/[\n,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const deduped = [];
  const seen = new Set();

  for (const token of split) {
    if (!isAddress(token)) {
      throw new Error(`Invalid token address: ${token}`);
    }
    const checksummed = getAddress(token);
    if (checksummed === ZERO_ADDRESS) continue;
    const key = checksummed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(checksummed);
    }
  }

  return deduped;
}

function parseOverrides(raw) {
  const lines = raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const map = new Map();

  for (const line of lines) {
    const [addrRaw, amountRaw] = line.split(/[\s,]+/).filter(Boolean);
    if (!addrRaw || !amountRaw) {
      throw new Error(`Invalid manual override line: ${line}`);
    }
    if (!isAddress(addrRaw)) {
      throw new Error(`Invalid manual override token: ${addrRaw}`);
    }
    const token = getAddress(addrRaw);
    if (token === ZERO_ADDRESS) continue;
    const amount = BigInt(amountRaw);
    if (amount < 0n) {
      throw new Error(`Invalid manual override amount for ${token}`);
    }
    map.set(token, amount);
  }

  return map;
}

function min(a, b) {
  return a < b ? a : b;
}

function requireProvider() {
  if (!window.ethereum) {
    throw new Error("No EVM wallet found. Install MetaMask or Rabby.");
  }
}

function clients() {
  requireProvider();
  const transport = custom(window.ethereum);
  return {
    publicClient: createPublicClient({ transport, chain: ARBITRUM_CHAIN }),
    walletClient: createWalletClient({ transport, chain: ARBITRUM_CHAIN }),
  };
}

async function safeRead(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function resolveProfile(chainId) {
  const profile = CADMOS_PROFILES[String(chainId)];
  if (!profile) {
    throw new Error(`No profile for chain ${chainId}. Add it in profiles.js`);
  }

  if (!profile.controller || !profile.cadmosToken) {
    throw new Error(`Profile for chain ${chainId} is missing controller/cadmosToken in profiles.js`);
  }

  const controller = parseAddress("Profile controller", profile.controller);
  const cadmosToken = parseAddress("Profile Cadmos token", profile.cadmosToken);

  const knownTokens = (profile.knownTokens ?? [])
    .filter((t) => t && isAddress(t.address) && getAddress(t.address) !== ZERO_ADDRESS)
    .map((t) => ({ symbol: t.symbol || "TOKEN", address: getAddress(t.address) }));

  return {
    chainName: profile.chainName || `Chain ${chainId}`,
    controller,
    cadmosToken,
    knownTokens,
  };
}

function applyProfileToUI() {
  if (!state.profile) {
    els.controllerInput.value = "";
    els.cadmosInput.value = "";
    els.knownTokensView.value = "";
    els.profileBadge.textContent = "Profile: Not loaded";
    return;
  }

  els.controllerInput.value = state.profile.controller;
  els.cadmosInput.value = state.profile.cadmosToken;
  els.knownTokensView.value = state.profile.knownTokens.length
    ? state.profile.knownTokens.map((t) => `${t.symbol}: ${t.address}`).join("\n")
    : "No known tokens configured";
  els.profileBadge.textContent = `Profile: ${state.profile.chainName}`;
}

function persistInputs() {
  const payload = {
    wallet: els.walletInput.value,
    deadline: els.deadlineInput.value,
    mode: els.modeInput.value,
    continueOnFailure: els.continueOnFailureInput.checked,
    includeRedeemFallback: els.includeRedeemFallbackInput.checked,
    extraTokens: els.extraTokensInput.value,
    cadmosManualAmount: els.cadmosManualAmountInput.value,
    tokenOverrides: els.tokenOverridesInput.value,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function restoreInputs() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  try {
    const v = JSON.parse(raw);
    if (typeof v.wallet === "string") els.walletInput.value = v.wallet;
    if (typeof v.deadline === "string") els.deadlineInput.value = v.deadline;
    if (typeof v.mode === "string") els.modeInput.value = v.mode;
    if (typeof v.continueOnFailure === "boolean") els.continueOnFailureInput.checked = v.continueOnFailure;
    if (typeof v.includeRedeemFallback === "boolean") els.includeRedeemFallbackInput.checked = v.includeRedeemFallback;
    if (typeof v.extraTokens === "string") els.extraTokensInput.value = v.extraTokens;
    if (typeof v.cadmosManualAmount === "string") els.cadmosManualAmountInput.value = v.cadmosManualAmount;
    if (typeof v.tokenOverrides === "string") els.tokenOverridesInput.value = v.tokenOverrides;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function toggleManualSection() {
  const manual = els.modeInput.value === "manual";
  if (manual) {
    els.manualSection.classList.add("active");
  } else {
    els.manualSection.classList.remove("active");
  }
}

async function connectWallet() {
  requireProvider();
  const { publicClient, walletClient } = clients();

  const [account] = await walletClient.requestAddresses();
  let chainId = await publicClient.getChainId();

  if (chainId !== DEFAULT_CHAIN_ID) {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: DEFAULT_CHAIN_HEX }],
      });
    } catch {
      setChainWarning("Stop: switch wallet network to Arbitrum One (42161) before proceeding.");
      throw new Error("Please switch your wallet network to Arbitrum One (42161) and reconnect.");
    }
    chainId = await publicClient.getChainId();
  }

  if (chainId !== DEFAULT_CHAIN_ID) {
    setChainWarning("Stop: wallet network does not match Arbitrum One (42161).");
    throw new Error("Wrong network. Use Arbitrum One (42161).");
  }

  state.account = getAddress(account);
  state.chainId = chainId;
  state.profile = resolveProfile(chainId);
  clearGeneratedState();

  els.signatoryInput.value = state.account;
  els.walletBadge.textContent = `Connected: ${state.account.slice(0, 6)}...${state.account.slice(-4)}`;
  updateChainBadge();

  applyProfileToUI();
  setChainWarning("");
  syncRecoverButtonState();
  setOutput(
    `Signatory connected: ${state.account}\n` +
      "Next: confirm you have enough gas, paste your Cadmos Smart Account address, and click Scan & Build Plan."
  );
}

async function buildUnsignedPlan() {
  if (!state.account) throw new Error("Connect signatory wallet first.");

  const { publicClient } = clients();
  await enforceExpectedChain(publicClient);
  if (!state.profile) {
    state.profile = resolveProfile(state.chainId);
    applyProfileToUI();
  }
  if (!state.profile) throw new Error("No profile loaded for current chain.");

  const wallet = parseAddress("Cadmos wallet", els.walletInput.value.trim());
  const signatory = parseAddress("Signatory", els.signatoryInput.value.trim());
  const destination = signatory;

  const deadlineSeconds = BigInt(els.deadlineInput.value || "3600");
  if (deadlineSeconds < 120n) {
    throw new Error("Deadline must be at least 120 seconds.");
  }

  const mode = els.modeInput.value;
  const includeRedeemFallback = els.includeRedeemFallbackInput.checked;

  const manualCadmosAmount = BigInt(els.cadmosManualAmountInput.value || "0");
  const manualOverrides = parseOverrides(els.tokenOverridesInput.value);

  const tokenSet = new Map();
  for (const t of state.profile.knownTokens) {
    tokenSet.set(t.address, t.symbol);
  }

  for (const t of parseTokenList(els.extraTokensInput.value)) {
    if (!tokenSet.has(t)) tokenSet.set(t, "EXTRA");
  }

  for (const [token] of manualOverrides.entries()) {
    if (!tokenSet.has(token)) tokenSet.set(token, "MANUAL");
  }

  const currentNonce = await publicClient.readContract({
    address: wallet,
    abi: walletAbi,
    functionName: "nonce",
  });

  const deadline = BigInt(Math.floor(Date.now() / 1000)) + deadlineSeconds;

  const calls = [];
  const notes = [];

  const maxWithdraw = await safeRead(
    () =>
      publicClient.readContract({
        address: state.profile.cadmosToken,
        abi: cadmosAbi,
        functionName: "maxWithdraw",
        args: [wallet],
      }),
    0n
  );

  const withdrawAssets =
    mode === "manual" && manualCadmosAmount > 0n
      ? (maxWithdraw > 0n ? min(manualCadmosAmount, maxWithdraw) : manualCadmosAmount)
      : maxWithdraw;

  if (withdrawAssets > 0n) {
    calls.push({
      target: state.profile.cadmosToken,
      data: encodeFunctionData({
        abi: cadmosAbi,
        functionName: "withdraw",
        args: [withdrawAssets, destination, wallet],
      }),
      deadline,
      note: `cadmos.withdraw assets=${withdrawAssets}`,
    });
    notes.push(`cadmos.withdraw assets=${withdrawAssets}`);
  }

  if (mode === "standard" && includeRedeemFallback) {
    const maxRedeem = await safeRead(
      () =>
        publicClient.readContract({
          address: state.profile.cadmosToken,
          abi: cadmosAbi,
          functionName: "maxRedeem",
          args: [wallet],
        }),
      0n
    );

    if (maxRedeem > 0n) {
      calls.push({
        target: state.profile.cadmosToken,
        data: encodeFunctionData({
          abi: cadmosAbi,
          functionName: "redeem",
          args: [maxRedeem, destination, wallet],
        }),
        deadline,
        note: `cadmos.redeem shares=${maxRedeem} (fallback)`,
      });
      notes.push(`cadmos.redeem shares=${maxRedeem} fallback`);
    }
  }

  for (const [token, source] of tokenSet.entries()) {
    const balance = await safeRead(
      () =>
        publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [wallet],
        }),
      0n
    );

    const override = manualOverrides.get(token);
    const amount = mode === "manual" && override !== undefined ? min(balance, override) : balance;

    if (amount === 0n) continue;

    calls.push({
      target: token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [destination, amount],
      }),
      deadline,
      note: `token.transfer token=${token} amount=${amount} source=${source}`,
    });
    notes.push(`token.transfer token=${token} amount=${amount}`);
  }

  if (calls.length === 0) {
    throw new Error("No recoverable non-zero calls found.");
  }

  return {
    wallet,
    signatory,
    destination,
    currentNonce,
    deadline,
    mode,
    continueOnFailure: els.continueOnFailureInput.checked,
    controller: state.profile.controller,
    chainId: state.chainId,
    calls,
    notes,
  };
}

async function signPlan(plan) {
  const { walletClient } = clients();

  setOutput(`Signing ${plan.calls.length} message(s). Confirm each signature in wallet...`);

  const signedCalls = [];

  for (let i = 0; i < plan.calls.length; i++) {
    const requestNonce = plan.currentNonce + BigInt(i);
    const call = plan.calls[i];

    setOutput(`Signing message ${i + 1}/${plan.calls.length}: ${call.note}`);

    const signature = await walletClient.signTypedData({
      account: state.account,
      domain: {
        name: "Cadmos UserWallet",
        version: "1",
        chainId: plan.chainId,
        verifyingContract: plan.wallet,
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
        nonce: requestNonce,
        data: call.data,
      },
    });

    signedCalls.push({
      target: call.target,
      signatory: plan.signatory,
      data: call.data,
      signature,
      deadline: call.deadline,
      nonce: requestNonce,
      note: call.note,
    });
  }

  const callTuples = signedCalls.map((c) => ({
    target: c.target,
    signatory: c.signatory,
    data: c.data,
    signature: c.signature,
    deadline: c.deadline,
  }));

  const executeCalldata = encodeFunctionData({
    abi: controllerAbi,
    functionName: "executeSignedCalls",
    args: [plan.wallet, callTuples, plan.continueOnFailure],
  });

  return {
    chainId: plan.chainId,
    controller: plan.controller,
    wallet: plan.wallet,
    continueOnFailure: plan.continueOnFailure,
    mode: plan.mode,
    walletNonce: plan.currentNonce,
    destination: plan.destination,
    calls: signedCalls,
    callTuples,
    callPlanNotes: plan.notes,
    executeSignedCallsCalldata: executeCalldata,
  };
}

function renderPlanPreview(plan) {
  els.nonceBadge.textContent = `Smart Account nonce: ${plan.currentNonce.toString()}`;

  const preview = {
    chainId: plan.chainId,
    controller: plan.controller,
    wallet: plan.wallet,
    destination: plan.destination,
    continueOnFailure: plan.continueOnFailure,
    mode: plan.mode,
    walletNonce: plan.currentNonce.toString(),
    callCount: plan.calls.length,
    callPlanNotes: plan.notes,
  };

  const reviewHeader =
    `Review before recovering:\n` +
    `Network: ${plan.chainId}\n` +
    `Destination: ${plan.destination}\n` +
    `Steps: ${plan.calls.length}\n\n`;

  setOutput(reviewHeader + JSON.stringify(preview, bigintReplacer, 2));
}

function renderGenerated(bundle) {
  const out = {
    chainId: bundle.chainId,
    controller: bundle.controller,
    wallet: bundle.wallet,
    destination: bundle.destination,
    continueOnFailure: bundle.continueOnFailure,
    mode: bundle.mode,
    walletNonce: bundle.walletNonce.toString(),
    callPlanNotes: bundle.callPlanNotes,
    calls: bundle.calls.map((c) => ({
      target: c.target,
      signatory: c.signatory,
      data: c.data,
      signature: c.signature,
      deadline: c.deadline.toString(),
      nonce: c.nonce.toString(),
      note: c.note,
    })),
    executeSignedCallsCalldata: bundle.executeSignedCallsCalldata,
  };

  const reviewHeader =
    `Signed recovery bundle ready:\n` +
    `Network: ${bundle.chainId}\n` +
    `Destination: ${bundle.destination}\n` +
    `Signed calls: ${bundle.calls.length}\n\n`;

  setOutput(reviewHeader + JSON.stringify(out, null, 2));
}

async function scanPlan() {
  const plan = await buildUnsignedPlan();
  clearGeneratedState();
  state.scannedPlan = plan;
  renderPlanPreview(plan);
}

async function ensureGenerated() {
  const fingerprint = inputFingerprint();
  if (state.generated && state.generatedFingerprint === fingerprint) {
    return state.generated;
  }

  const plan = await buildUnsignedPlan();
  const bundle = await signPlan(plan);

  state.scannedPlan = plan;
  state.generated = bundle;
  state.generatedFingerprint = fingerprint;

  renderGenerated(bundle);
  return bundle;
}

async function recoverNow() {
  if (!els.confirmReviewInput.checked) {
    throw new Error("Please confirm network and destination before recovering.");
  }
  const plan = await buildUnsignedPlan();
  const { publicClient, walletClient } = clients();
  await enforceExpectedChain(publicClient);

  const results = [];
  let cadmosWithdrawSucceeded = false;

  for (let i = 0; i < plan.calls.length; i++) {
    const step = plan.calls[i];
    const selector = (step.data || "").slice(0, 10).toLowerCase();
    const isCadmosCall =
      !!state.profile &&
      step.target.toLowerCase() === state.profile.cadmosToken.toLowerCase();
    const isRedeemFallbackCall = isCadmosCall && selector === SELECTOR_REDEEM;

    if (isRedeemFallbackCall && cadmosWithdrawSucceeded) {
      results.push({
        step: i,
        note: step.note,
        skipped: true,
        reason: "Skipped redeem fallback because withdraw already succeeded.",
      });
      continue;
    }

    const liveNonce = await publicClient.readContract({
      address: plan.wallet,
      abi: walletAbi,
      functionName: "nonce",
    });

    setOutput(
      `Executing step ${i + 1}/${plan.calls.length}\n` +
        `Nonce: ${liveNonce.toString()}\n` +
        `Action: ${step.note}\n` +
        "Please confirm signature and transaction in wallet..."
    );

    const signature = await walletClient.signTypedData({
      account: state.account,
      domain: {
        name: "Cadmos UserWallet",
        version: "1",
        chainId: plan.chainId,
        verifyingContract: plan.wallet,
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
        target: step.target,
        value: 0n,
        deadline: step.deadline,
        nonce: liveNonce,
        data: step.data,
      },
    });

    const callTuple = [
      {
        target: step.target,
        signatory: plan.signatory,
        data: step.data,
        signature,
        deadline: step.deadline,
      },
    ];

    const hash = await walletClient.writeContract({
      account: state.account,
      address: plan.controller,
      abi: controllerAbi,
      functionName: "executeSignedCalls",
      args: [plan.wallet, callTuple, true],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    let callSuccess = receipt.status === "success";
    let returnData = "0x";

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== plan.controller.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: controllerAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "WalletCallExecuted") {
          callSuccess = Boolean(decoded.args.success);
          returnData = decoded.args.returnData || "0x";
        }
      } catch {
        continue;
      }
    }

    results.push({
      step: i,
      note: step.note,
      nonce: liveNonce.toString(),
      txHash: hash,
      txStatus: receipt.status,
      callSuccess,
      returnData,
    });

    if (isCadmosCall && selector === SELECTOR_WITHDRAW && callSuccess) {
      cadmosWithdrawSucceeded = true;
    }

    if (!callSuccess && !plan.continueOnFailure) {
      break;
    }
  }

  setOutput(
    JSON.stringify(
      {
        chainId: plan.chainId,
        wallet: plan.wallet,
        destination: plan.destination,
        continueOnFailure: plan.continueOnFailure,
        totalSteps: plan.calls.length,
        executedSteps: results.length,
        results,
      },
      null,
      2
    )
  );
}

async function copyJson() {
  const bundle = await ensureGenerated();

  const payload = {
    chainId: bundle.chainId,
    controller: bundle.controller,
    wallet: bundle.wallet,
    destination: bundle.destination,
    continueOnFailure: bundle.continueOnFailure,
    mode: bundle.mode,
    walletNonce: bundle.walletNonce.toString(),
    callPlanNotes: bundle.callPlanNotes,
    calls: bundle.calls.map((c) => ({
      target: c.target,
      signatory: c.signatory,
      data: c.data,
      signature: c.signature,
      deadline: c.deadline.toString(),
      nonce: c.nonce.toString(),
      note: c.note,
    })),
    executeSignedCallsCalldata: bundle.executeSignedCallsCalldata,
  };

  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  setOutput("Copied plan (JSON) to clipboard.");
}

async function copyCalldata() {
  const bundle = await ensureGenerated();
  await navigator.clipboard.writeText(bundle.executeSignedCallsCalldata);
  setOutput("Copied calldata for manual execution.");
}

async function downloadJson() {
  const bundle = await ensureGenerated();

  const payload = {
    chainId: bundle.chainId,
    controller: bundle.controller,
    wallet: bundle.wallet,
    destination: bundle.destination,
    continueOnFailure: bundle.continueOnFailure,
    mode: bundle.mode,
    walletNonce: bundle.walletNonce.toString(),
    callPlanNotes: bundle.callPlanNotes,
    calls: bundle.calls.map((c) => ({
      target: c.target,
      signatory: c.signatory,
      data: c.data,
      signature: c.signature,
      deadline: c.deadline.toString(),
      nonce: c.nonce.toString(),
      note: c.note,
    })),
    executeSignedCallsCalldata: bundle.executeSignedCallsCalldata,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const now = new Date().toISOString().replace(/[:.]/g, "-");

  const a = document.createElement("a");
  const href = URL.createObjectURL(blob);
  a.href = href;
  a.download = `cadmos-panic-recovery-${now}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);

  setOutput("Downloaded plan (JSON).");
}

function withErrors(fn) {
  return async () => {
    try {
      await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOutput(`Error: ${message}`);
    }
  };
}

function bindPersistence() {
  const fields = [
    els.walletInput,
    els.deadlineInput,
    els.modeInput,
    els.continueOnFailureInput,
    els.includeRedeemFallbackInput,
    els.extraTokensInput,
    els.cadmosManualAmountInput,
    els.tokenOverridesInput,
  ];

  for (const field of fields) {
    field.addEventListener("change", persistInputs);
    field.addEventListener("input", persistInputs);
  }
}

restoreInputs();
toggleManualSection();
bindPersistence();
syncRecoverButtonState();

els.modeInput.addEventListener("change", () => {
  toggleManualSection();
  persistInputs();
});
els.confirmReviewInput.addEventListener("change", syncRecoverButtonState);

els.connectBtn.addEventListener("click", withErrors(connectWallet));
els.scanBtn.addEventListener("click", withErrors(scanPlan));
els.recoverBtn.addEventListener("click", withErrors(recoverNow));
els.copyJsonBtn.addEventListener("click", withErrors(copyJson));
els.downloadJsonBtn.addEventListener("click", withErrors(downloadJson));
els.copyCalldataBtn.addEventListener("click", withErrors(copyCalldata));

if (window.ethereum?.on) {
  window.ethereum.on("chainChanged", (nextChainHex) => {
    const parsed = parseChainIdValue(nextChainHex);
    if (parsed !== null) {
      state.chainId = parsed;
    } else {
      state.chainId = null;
    }

    clearGeneratedState();
    if (state.chainId === DEFAULT_CHAIN_ID) {
      try {
        state.profile = resolveProfile(state.chainId);
        applyProfileToUI();
        setChainWarning("");
      } catch (error) {
        state.profile = null;
        applyProfileToUI();
        const message = error instanceof Error ? error.message : String(error);
        setChainWarning(`Stop: ${message}`);
      }
    } else {
      setChainWarning("Stop: wallet network does not match Arbitrum One (42161). Switch network before proceeding.");
    }
    updateChainBadge();
    syncRecoverButtonState();
  });

  window.ethereum.on("accountsChanged", (accounts) => {
    clearGeneratedState();
    if (!accounts || accounts.length === 0) {
      state.account = null;
      state.chainId = null;
      state.profile = null;
      els.signatoryInput.value = "";
      els.walletBadge.textContent = "Not connected";
      applyProfileToUI();
      updateChainBadge();
      setChainWarning("");
      syncRecoverButtonState();
      setOutput(DEFAULT_OUTPUT_MESSAGE);
      return;
    }

    state.account = getAddress(accounts[0]);
    els.signatoryInput.value = state.account;
    els.walletBadge.textContent = `Connected: ${state.account.slice(0, 6)}...${state.account.slice(-4)}`;
    syncRecoverButtonState();
  });
}

setOutput(DEFAULT_OUTPUT_MESSAGE);
