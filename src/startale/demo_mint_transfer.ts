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
  type GetPaymasterDataParameters,
  type PrepareUserOperationRequest,
  createPaymasterClient,
} from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { soneiumMinato } from "viem/chains";

import {
  createSmartAccountClient,
  toStartaleSmartAccount,
} from "startale-aa-sdk";

import chalk from "chalk";
import { demoItemAbi } from "src/abi/DemoItem";

const bundlerUrl = process.env.BUNDLER_URL;
const paymasterUrl = process.env.PAYMASTER_SERVICE_URL;
const privateKey = process.env.OWNER_PRIVATE_KEY;
const demoItemContract = process.env.DEMO_ITEM_CONTRACT_ADDRESS as Address;

if (!bundlerUrl || !paymasterUrl || !privateKey) {
  throw new Error(
    "BUNDLER_RPC or PAYMASTER_SERVICE_URL or PRIVATE_KEY is not set"
  );
}

const chain = soneiumMinato;
const publicClient = createPublicClient({
  transport: http(),
  chain,
});

const paymasterClient = createPaymasterClient({
  transport: http(paymasterUrl),
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

const calculateAverage = (values: bigint[]): bigint => {
  if (values.length === 0) return BigInt(0);
  console.log(values);
  const sum = values.reduce((acc, val): bigint => {
    return isNaN(Number(val)) ? acc : acc + BigInt(val);
  }, BigInt(0));
  return sum / BigInt(values.length);
};

const findMin = (values: bigint[]): bigint => {
  return values.reduce((a, b) => (a < b ? a : b), values[0] || BigInt(0));
};

const findMax = (values: bigint[]): bigint => {
  return values.reduce((a, b) => (a > b ? a : b), values[0] || BigInt(0));
};

const main = async () => {
  const spinner = ora({ spinner: "bouncingBar" });
  const NUM_ITERATIONS = 1;

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

    const smartAccountAddress = smartAccountClient.account.address;
    console.log("Smart Account Address:", smartAccountAddress);

    const actualGasCosts: bigint[] = [];
    const randomMetadataId = Math.floor(Math.random() * 2599);
    const currentSupply = await publicClient.readContract({
      address: demoItemContract as Address,
      abi: demoItemAbi,
      functionName: "totalSupply",
    });
    console.log(`Current total supply: ${currentSupply}`);

    for (let i = 0; i < NUM_ITERATIONS; i++) {
      spinner.text = `Executing transaction ${i + 1}/${NUM_ITERATIONS}...`;

      const mintData = encodeFunctionData({
        abi: demoItemAbi,
        functionName: "safeMint",
        args: [smartAccountAddress, randomMetadataId + i],
      });

      console.log("Signer address: ", signer.address);
      const mintUserOp = await smartAccountClient.prepareUserOperation({
        calls: [
          {
            to: demoItemContract as Address,
            data: mintData,
          },
        ],
      });

      const transferData = encodeFunctionData({
        abi: demoItemAbi,
        functionName: "safeTransferFrom",
        args: [
          smartAccountAddress,
          "0x3DC120168Ae0F3Cd10fE5DcC8E344E4fe90F9448",
          (currentSupply as bigint) - BigInt(1) + BigInt(i),
        ],
      });
      const transferUserOp = await smartAccountClient.prepareUserOperation({
        calls: [
          {
            to: demoItemContract as Address,
            data: transferData,
          },
        ],
      });

      const hash = await smartAccountClient.sendUserOperation({
        calls: [
          {
            to: demoItemContract as Address,
            data: mintData,
          },
          {
            to: demoItemContract as Address,
            data: transferData,
          },
        ],
      });

      const receipt = await smartAccountClient.waitForUserOperationReceipt({
        hash,
      });
      console.log("Receipt: ", receipt);
      actualGasCosts.push(BigInt(receipt.receipt.cumulativeGasUsed) * BigInt(receipt.receipt.effectiveGasPrice));

      console.log(`Transaction ${i + 1} completed`);
    }

    spinner.succeed("All transactions completed");

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

    const stats = [calculateStats(actualGasCosts, "Actual Gas Cost")];

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
