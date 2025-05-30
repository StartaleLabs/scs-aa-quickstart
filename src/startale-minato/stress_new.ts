// WIP
import "dotenv/config";
import ora from "ora";
import fs from "fs";
import chalk from "chalk";
import cliProgress from "cli-progress";
import { http, type Address, type Hex, createPublicClient, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { soneiumMinato } from "viem/chains";
import { Counter as CounterAbi } from "../abi/Counter";
import { createSCSPaymasterClient, createSmartAccountClient, toStartaleSmartAccount } from "@startale-scs/aa-sdk";
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
const scsContext = { calculateGasLimits: true, paymasterId: "pm_test_managed_gasused_policy" };

const logStream = fs.createWriteStream("results.csv", { flags: "a" });
logStream.write("index,nonceKey,timestamp,duration,success,error\n");

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

const progressBar = new cliProgress.SingleBar({
  format: 'Progress |{bar}| {percentage}% | {value}/{total} ops',
  barCompleteChar: '\u2588',
  barIncompleteChar: '\u2591',
}, cliProgress.Presets.shades_classic);

async function sendUserOp(index: number, nonceKey: bigint): Promise<{ success: boolean; duration?: number }> {
  const start = Date.now();
  const timestamp = new Date().toISOString();

  try {
    const smartAccountClient = createSmartAccountClient({
      account: await toStartaleSmartAccount({
        signer,
        chain,
        transport: http(),
        index: 1001498n,
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
    logStream.write(`${index},${nonceKey},${timestamp},${duration},true,\n`);
    progressBar.increment();
    return { success: true, duration };
  } catch (error) {
    const duration = Date.now() - start;
    const errorMessage = (error as Error).message.replace(/[\n\r,]/g, " ");
    console.error(chalk.red(`❌ [${index}] Failed: ${errorMessage}`));
    logStream.write(`${index},${nonceKey},${timestamp},${duration},false,"${errorMessage}"\n`);
    progressBar.increment();
    return { success: false };
  }
}

async function runLoadTest(total: number, batchSize: number, delayMs: number) {
  console.log(chalk.cyan(`🚀 Running burst test: ${batchSize} ops every ${delayMs}ms`));
  let currentIndex = 1;
  let movingKey = 1n;
  const results: { success: boolean; duration?: number }[] = [];

  progressBar.start(total, 0);

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

  progressBar.stop();
  printSummary(results);
}

async function runSmoothLoad(total: number, delayPerOp: number) {
  console.log(chalk.cyan(`🚶 Running smooth test: 1 op every ${delayPerOp}ms`));
  const results: { success: boolean; duration?: number }[] = [];
  let movingKey = 1n;

  progressBar.start(total, 0);

  for (let i = 1; i <= total; i++, movingKey++) {
    results.push(await sendUserOp(i, movingKey));
    await delay(delayPerOp);
  }

  progressBar.stop();
  printSummary(results);
}

async function runLimitedStreamLoad(total: number, delayPerOp: number, concurrency: number = 5) {
  console.log(chalk.cyan(`🧠 Running limited stream: max ${concurrency} ops, ${delayPerOp}ms spacing`));
  const limit = pLimit(concurrency);
  const results: Promise<{ success: boolean; duration?: number }>[] = [];

  let movingKey = 1n;
  progressBar.start(total, 0);

  for (let i = 1; i <= total; i++, movingKey++) {
    results.push(limit(() => sendUserOp(i, movingKey)));
    await delay(delayPerOp);
  }

  progressBar.stop();
  printSummary(await Promise.all(results));
}

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

const mode = process.argv[2] || "burst";

switch (mode) {
  case "burst":
    runLoadTest(100, 10, 2000);
    break;
  case "smooth":
    runSmoothLoad(100, 250);
    break;
  case "limited":
    runLimitedStreamLoad(100, 100, 5);
    break;
  default:
    console.error(chalk.red(`❓ Unknown mode: ${mode}. Use \"burst\", \"smooth\", or \"limited\"`));
} 
