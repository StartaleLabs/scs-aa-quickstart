import "dotenv/config";
import ora from "ora";
import {
  http,
  type Address,
  type Hex,
  createPublicClient,
  encodeFunctionData,
  rpcSchema,
} from "viem";
import {
  type EntryPointVersion,
  type GetPaymasterDataParameters,
  type PrepareUserOperationRequest,
  createBundlerClient,
  createPaymasterClient,
  entryPoint07Address,
} from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { soneiumMinato } from "viem/chains";
import { Counter as CounterAbi } from "../abi/Counter";

import {
  createSmartAccountClient,
  toStartaleSmartAccount,
} from "startale-aa-sdk";

import chalk from "chalk";

const bundlerUrl = process.env.BUNDLER_URL;
const paymasterUrl = process.env.PAYMASTER_SERVICE_URL;
const privateKey = process.env.OWNER_PRIVATE_KEY;
const counterContract = process.env.COUNTER_CONTRACT_ADDRESS as Address;

if (!bundlerUrl || !paymasterUrl || !privateKey) {
  throw new Error(
    "BUNDLER_RPC or PAYMASTER_SERVICE_URL or PRIVATE_KEY is not set"
  );
}

type PaymasterRpcSchema = [
  {
    Method: "pm_getPaymasterData";
    Parameters: [
      PrepareUserOperationRequest,
      { mode: string; calculateGasLimits: boolean }
    ];
    ReturnType: {
      callGasLimit: bigint;
      verificationGasLimit: bigint;
      preVerificationGas: bigint;
      paymasterVerificationGasLimit: bigint;
      paymasterPostOpGasLimit: bigint;
      maxFeePerGas: bigint;
      maxPriorityFeePerGas: bigint;
      paymasterData: string;
      paymaster: string;
    };
  }
];

const chain = soneiumMinato;
const publicClient = createPublicClient({
  transport: http(),
  chain,
});

const paymasterClient = createPaymasterClient({
  transport: http(paymasterUrl),
  rpcSchema: rpcSchema<PaymasterRpcSchema>(),
});

const signer = privateKeyToAccount(privateKey as Hex);

// Note: we MUST use calculateGasLimits true otherwise we get verificationGasLimit too low
const scsContext = { calculateGasLimits: true, policyId: "sudo" };

const calculatePercentile = (values: bigint[], percentile: number): bigint => {
  if (values.length === 0) return BigInt(0);

  const sorted = [...values].sort((a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
};

// Function to calculate average with proper BigInt handling
const calculateAverage = (values: bigint[]): bigint => {
  if (values.length === 0) return BigInt(0);
  console.log(values);
  const sum = values.reduce((acc, val): bigint => {
    return isNaN(Number(val)) ? acc : acc + BigInt(val);
  }, BigInt(0));
  return sum / BigInt(values.length);
};

// Function to find min with proper BigInt handling
const findMin = (values: bigint[]): bigint => {
  return values.reduce((a, b) => (a < b ? a : b), values[0] || BigInt(0));
};

// Function to find max with proper BigInt handling
const findMax = (values: bigint[]): bigint => {
  return values.reduce((a, b) => (a > b ? a : b), values[0] || BigInt(0));
};

const main = async () => {
  const spinner = ora({ spinner: "bouncingBar" });
  const NUM_ITERATIONS = 1; // Number of times to repeat the transaction

  try {
    spinner.start("Initializing smart account...");

    const eoaAddress = signer.address;
    console.log("EOA Address:", eoaAddress);

    const smartAccountClient = createSmartAccountClient({
      account: await toStartaleSmartAccount({
        signer: signer as any,
        chain: chain as any,
        transport: http() as any,
        index: BigInt(1093),
      }),
      transport: http(bundlerUrl) as any,
      client: publicClient as any,
      paymaster: {
        async getPaymasterData(pmDataParams: GetPaymasterDataParameters) {
          pmDataParams.paymasterPostOpGasLimit = BigInt(100000);
          pmDataParams.paymasterVerificationGasLimit = BigInt(200000);
          pmDataParams.verificationGasLimit = BigInt(500000);
          console.log("Called getPaymasterData: ", pmDataParams);
          const paymasterResponse = await paymasterClient.getPaymasterData(
            pmDataParams
          );
          console.log("Paymaster Response: ", paymasterResponse);
          return paymasterResponse;
        },
        async getPaymasterStubData(
          pmStubDataParams: GetPaymasterDataParameters
        ) {
          console.log("Called getPaymasterStubData: ", pmStubDataParams);
          const paymasterStubResponse =
            await paymasterClient.getPaymasterStubData(pmStubDataParams);
          console.log("Paymaster Stub Response: ", pmStubDataParams);
          return paymasterStubResponse;
        },
      },
      paymasterContext: scsContext,
      userOperation: {
        estimateFeesPerGas: async ({
          account,
          bundlerClient,
          userOperation,
        }: {
          account: any;
          bundlerClient: any;
          userOperation: any;
        }) => {
          return {
            maxFeePerGas: BigInt(10000000),
            maxPriorityFeePerGas: BigInt(10000000),
          };
        },
      },
    });

    const address = smartAccountClient.account.address;
    console.log("Smart Account Address:", address);

    // Arrays to store gas metrics
    const effectiveGasPrices: bigint[] = [];

    // Construct call data once
    const callData = encodeFunctionData({
      abi: CounterAbi,
      functionName: "count",
    });

    for (let i = 0; i < NUM_ITERATIONS; i++) {
      spinner.text = `Executing transaction ${i + 1}/${NUM_ITERATIONS}...`;

      // Get the user operation before sending
      const userOperation = await smartAccountClient.prepareUserOperation({
        calls: [
          {
            to: counterContract as Address,
            value: BigInt(0),
            data: callData,
          },
        ],
      });

      // Now send the user operation
      const hash = await smartAccountClient.sendUserOperation({
        calls: [
          {
            to: counterContract as Address,
            value: BigInt(0),
            data: callData,
          },
        ],
      });

      const receipt = await smartAccountClient.waitForUserOperationReceipt({
        hash,
      });
      console.log('Receipt: ',receipt);
      effectiveGasPrices.push(receipt.receipt.effectiveGasPrice);

      console.log(`Transaction ${i + 1} completed`);
    }

    spinner.succeed("All transactions completed");

    // Calculate statistics
    const calculateStats = (values: bigint[], name: string) => {
      return {
        metric: name,
        average: calculateAverage(values),
        p90: calculatePercentile(values, 90),
        min: findMin(values),
        max: findMax(values),
        unit: "wei",
      };
    };

    const stats = [
      calculateStats(effectiveGasPrices, "Effective Gas Cost"),
    ];

    // Display results
    console.log("\nGas Fee Statistics (90th percentile):");
    console.log("====================================");
    console.table(
      stats.map((stat) => ({
        Metric: stat.metric,
        Average: stat.average.toString(),
        "90th Percentile": stat.p90.toString(),
        Min: stat.min.toString(),
        Max: stat.max.toString(),
        Unit: stat.unit,
      }))
    );
  } catch (error) {
    spinner.fail(chalk.red(`Error: ${(error as Error).message}`));
    console.error(error);
  }
  process.exit(0);
};

main();
