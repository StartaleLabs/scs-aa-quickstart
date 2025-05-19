import "dotenv/config";
import ora from "ora";
import {
  http,
  type Hex,
  createPublicClient,
  parseEther,
} from "viem";
import {
  type GetPaymasterDataParameters,
  createPaymasterClient,
} from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { soneiumMinato } from "viem/chains";

import {
  createSmartAccountClient,
  toStartaleSmartAccount,
} from "startale-aa-sdk";

import chalk from "chalk";

const bundlerUrl = process.env.BUNDLER_URL;
const paymasterUrl = process.env.PAYMASTER_SERVICE_URL;
const privateKey = process.env.OWNER_PRIVATE_KEY;

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

const main = async () => {
  const spinner = ora({ spinner: "bouncingBar" });

  try {
    spinner.start("Initializing smart account...");

    const smartAccountClient = createSmartAccountClient({
      account: await toStartaleSmartAccount({
        signer: signer as any,
        chain: chain as any,
        transport: http() as any,
      }),
      transport: http(bundlerUrl) as any,
      client: publicClient as any,
      paymaster: {
        async getPaymasterData(pmDataParams: GetPaymasterDataParameters) {
          pmDataParams.paymasterPostOpGasLimit = BigInt(100000);
          pmDataParams.paymasterVerificationGasLimit = BigInt(200000);
          pmDataParams.verificationGasLimit = BigInt(500000);
          const paymasterResponse = await paymasterClient.getPaymasterData(
            pmDataParams
          );
          return paymasterResponse;
        },
        async getPaymasterStubData(
          pmStubDataParams: GetPaymasterDataParameters
        ) {
          const paymasterStubResponse =
            await paymasterClient.getPaymasterStubData(pmStubDataParams);
          return paymasterStubResponse;
        },
      },
      paymasterContext: scsContext,
      userOperation: {
        estimateFeesPerGas: async () => {
          return {
            maxFeePerGas: BigInt(10000000),
            maxPriorityFeePerGas: BigInt(10000000),
          };
        },
      },
    });

    const smartAccountAddress = smartAccountClient.account.address;
    console.log("Smart Account Address:", smartAccountAddress);

    console.log("Signer address: ", signer.address);

    const hash = await smartAccountClient.sendUserOperation({
      account: smartAccountClient.account,
      calls: [
        {
          to: "0x8955ed5CAAC29A457F600c3467424373D5745f37",
          value: parseEther("0"),
        },
      ],
    });

    const receipt = await smartAccountClient.waitForUserOperationReceipt({
      hash,
    });
    console.log("Receipt: ", receipt);

    spinner.succeed("All transactions completed");
  } catch (error) {
    spinner.fail(chalk.red(`Error: ${(error as Error).message}`));
    console.error(error);
  }
  process.exit(0);
};

main();
