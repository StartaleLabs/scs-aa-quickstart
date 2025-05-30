import "dotenv/config";
import ora from "ora";
import { http, type Address, type Hex, createPublicClient, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { soneiumMinato } from "viem/chains";
import { Counter as CounterAbi } from "../abi/Counter";
import { createSCSPaymasterClient, createSmartAccountClient, toStartaleSmartAccount } from "@startale-scs/aa-sdk";
import chalk from "chalk";
import pLimit from "p-limit";

// ────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────

const bundlerUrl = process.env.MINATO_BUNDLER_URL!;
const paymasterUrl = process.env.PAYMASTER_SERVICE_URL!;
const privateKey = process.env.OWNER_PRIVATE_KEY!;
const counterContract = process.env.COUNTER_CONTRACT_ADDRESS as Address;

const chain = soneiumMinato;
const publicClient = createPublicClient({ transport: http(), chain });
const scsPaymasterClient = createSCSPaymasterClient({ transport: http(paymasterUrl) as any });
const signer = privateKeyToAccount(privateKey as Hex);

// pm_test_managed_usage_limit : no of userops
// pm_test_managed_usdspent_policy: usd spent
// pm_test_managed_gascost_policy: gas cost
// pm_test_managed: no limits

const scsContext = { calculateGasLimits: true, paymasterId: "pm_test_managed_usage_limit" };

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

// ────────────────────────────────────────────────────────────────
// Core send operation
// ────────────────────────────────────────────────────────────────

async function sendUserOp(index: number, nonceKey: bigint): Promise<{ success: boolean; duration?: number }> {
  const start = Date.now();

  try {
    const smartAccountClient = createSmartAccountClient({
      account: await toStartaleSmartAccount({
        signer,
        chain,
        transport: http(),
        index: BigInt(206122)
      }),
      transport: http(bundlerUrl),
      client: publicClient,
      paymaster: scsPaymasterClient,
      paymasterContext: scsContext,
    });

    const callData = encodeFunctionData({
      abi: CounterAbi,
      functionName: "count",
    });

    const currentNonce = await smartAccountClient.account.getNonce({ key: nonceKey });

    const hash = await smartAccountClient.sendUserOperation({
      calls: [{ to: counterContract, value: 0n, data: callData }],
      nonce: currentNonce,
    });

    const receipt = await smartAccountClient.waitForUserOperationReceipt({ hash });
    const duration = Date.now() - start;

    console.log(chalk.green(`✔️ [${index}] Success: ${receipt?.userOpHash} (nonce: ${nonceKey}, ${duration}ms)`));
    return { success: true, duration };
  } catch (error) {
    console.error(chalk.red(`❌ [${index}] Failed: ${(error as Error).message}`));
    return { success: false };
  }
}

// ────────────────────────────────────────────────────────────────
// Modes
// ────────────────────────────────────────────────────────────────

async function runLoadTest(total: number, batchSize: number, delayMs: number) {
  console.log(chalk.cyan(`🚀 Running burst test: ${batchSize} ops every ${delayMs}ms`));
  let currentIndex = 1;
  let movingKey = 1n;
  const results: { success: boolean; duration?: number }[] = [];

  while (currentIndex <= total) {
    const batch = [];
    for (let i = 0; i < batchSize && currentIndex <= total; i++, currentIndex++) {
      batch.push(sendUserOp(currentIndex, movingKey));
      movingKey++;
    }

    const batchResults = await Promise.all(batch);
    results.push(...batchResults);
    await delay(delayMs);
  }

  printSummary(results);
}

async function runSmoothLoad(total: number, delayPerOp: number) {
  console.log(chalk.cyan(`🚶 Running smooth test: 1 op every ${delayPerOp}ms`));
  const results: { success: boolean; duration?: number }[] = [];
  let movingKey = 1n;

  for (let i = 1; i <= total; i++, movingKey++) {
    results.push(await sendUserOp(i, movingKey));
    await delay(delayPerOp);
  }

  printSummary(results);
}

async function runLimitedStreamLoad(total: number, delayPerOp: number, concurrency: number = 5) {
  console.log(chalk.cyan(`🧠 Running limited stream: max ${concurrency} ops, ${delayPerOp}ms spacing`));
  const limit = pLimit(concurrency);
  const results: Promise<{ success: boolean; duration?: number }>[] = [];

  let movingKey = 1n;

  for (let i = 1; i <= total; i++, movingKey++) {
    results.push(limit(() => sendUserOp(i, movingKey)));
    await delay(delayPerOp);
  }

  printSummary(await Promise.all(results));
}

// ────────────────────────────────────────────────────────────────
// Summary Reporter
// ────────────────────────────────────────────────────────────────

function printSummary(results: { success: boolean; duration?: number }[]) {
  const success = results.filter((r) => r.success).length;
  const failed = results.length - success;
  const durations = results.filter((r) => r.success && r.duration).map((r) => r.duration!);

  const avg = durations.length ? (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2) : "N/A";
  const max = durations.length ? Math.max(...durations) : "N/A";
  const min = durations.length ? Math.min(...durations) : "N/A";

  console.log(chalk.yellow(`\n📊 Test Summary:`));
  console.log(`✅ Success: ${success}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⏱️ Latency (ms): avg=${avg}, min=${min}, max=${max}`);
}

// ────────────────────────────────────────────────────────────────
// CLI Entry
// ────────────────────────────────────────────────────────────────

const mode = process.argv[2] || "burst";

switch (mode) {
  case "burst":
    runLoadTest(100, 10, 2000); // just to test the system
    break;
  case "smooth":
    runSmoothLoad(20, 400); // smooth
    break;
  case "limited":
    runLimitedStreamLoad(100, 100, 5); // production like
    break;
  default:
    console.error(chalk.red(`❓ Unknown mode: ${mode}. Use "burst", "smooth", or "limited"`));
}

// Can be good to test global limit but we have to use new smart account everytime (modify script to use different index)
// ts-node src/startale-minato/stress.ts burst    # 10 ops every 2s

// Can be good to test user limit with spacing to respect bundler limit of no of userops with same sender in mempool
// ts-node src/startale-minato/stress.ts smooth   # 1 op every 250ms

// Can be good to test global limit but we have to use new smart account everytime (modify script to use different index)
// ts-node src/startale-minato/stress.ts limited  # up to 5 in parallel, 100ms between ops

