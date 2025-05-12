import "dotenv/config";
import ora from "ora";
import {
  http,
  type Address,
  type Hex,
  createPublicClient,
  encodeFunctionData,
  formatEther,
  rpcSchema,
  toHex,
  encodePacked,
  zeroAddress,
  encodeAbiParameters,
  toBytes,
  pad,
  concatHex,
  parseEther,
} from "viem";
import {
  type EntryPointVersion,
  type GetPaymasterDataParameters,
  type PaymasterClient,
  type PrepareUserOperationParameters,
  type PrepareUserOperationRequest,
  type UserOperation,
  bundlerActions,
  createBundlerClient,
  createPaymasterClient,
  entryPoint07Address,
  getUserOperationHash,
  type BundlerClient,
} from "viem/account-abstraction";
import { generatePrivateKey, privateKeyToAccount, sign } from "viem/accounts";
import { baseSepolia, soneiumMinato } from "viem/chains";
import { Counter as CounterAbi } from "../abi/Counter";
import { SponsorshipPaymaster as PaymasterAbi } from "../abi/SponsorshipPaymaster";
// import { erc7579Actions } from "permissionless/actions/erc7579";
// import { type InstallModuleParameters } from "permissionless/actions/erc7579";

import { createSmartAccountClient, toStartaleSmartAccount } from "startale-aa-sdk";

import cliTable = require("cli-table3");
import chalk from "chalk";


const bundlerUrl = process.env.BUNDLER_URL;
const paymasterUrl = process.env.PAYMASTER_SERVICE_URL;
const privateKey = process.env.OWNER_PRIVATE_KEY;
const counterContract = process.env.COUNTER_CONTRACT_ADDRESS as Address;

if (!bundlerUrl || !paymasterUrl || !privateKey) {
  throw new Error("BUNDLER_RPC or PAYMASTER_SERVICE_URL or PRIVATE_KEY is not set");
}

type PaymasterRpcSchema = [
    {
      Method: "pm_getPaymasterData";
      Parameters: [PrepareUserOperationRequest, { mode: string; calculateGasLimits: boolean }];
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
    },
];

const chain = soneiumMinato;
const publicClient = createPublicClient({
  transport: http(),
  chain,
});

const bundlerClient = createBundlerClient({
  client: publicClient,
  transport: http(bundlerUrl),
});

const paymasterClient = createPaymasterClient({
  transport: http(paymasterUrl),
  rpcSchema: rpcSchema<PaymasterRpcSchema>(),
});

const signer = privateKeyToAccount(privateKey as Hex);

const entryPoint = {
  address: entryPoint07Address as Address,
  version: "0.7" as EntryPointVersion,
};

// Note: we MUST use calculateGasLimits true otherwise we get verificationGasLimit too low
// pm_1 is for postpaid pm for local db
// pm_test is is for dev env 
// pm_2 is fo prepaid pm with local db
const scsContext = { calculateGasLimits: true, paymasterId: "pm_2" }

const main = async () => {
    const spinner = ora({ spinner: "bouncingBar" });

    const tableConfig = {
      colWidths: [30, 60], // Requires fixed column widths
      wordWrap: true,
      wrapOnWordBoundary: false,
    };
  
    try {
      spinner.start("Initializing smart account...");
      const tableBefore = new cliTable(tableConfig);

      const eoaAddress = signer.address;
      console.log("eoaAddress", eoaAddress); 

      const smartAccountClient = createSmartAccountClient({
          account: await toStartaleSmartAccount({ 
          signer: signer as any, 
          chain: chain as any,
          transport: http() as any,
          index: BigInt(10936)
        }),
        transport: http(bundlerUrl) as any,
        client: publicClient as any,
        paymaster: {
            async getPaymasterData(pmDataParams: GetPaymasterDataParameters) {
              pmDataParams.paymasterPostOpGasLimit = BigInt(100000);
              pmDataParams.paymasterVerificationGasLimit = BigInt(200000);
              pmDataParams.verificationGasLimit = BigInt(500000);
              console.log("Called getPaymasterData: ", pmDataParams);
              const paymasterResponse = await paymasterClient.getPaymasterData(pmDataParams);
              console.log("Paymaster Response: ", paymasterResponse);
              return paymasterResponse;
            },
            async getPaymasterStubData(pmStubDataParams: GetPaymasterDataParameters) {
              console.log("Called getPaymasterStubData: ", pmStubDataParams);
              const paymasterStubResponse = await paymasterClient.getPaymasterStubData(pmStubDataParams);
              console.log("Paymaster Stub Response: ", paymasterStubResponse);
              // Review: work on this so we do not have to hardcode
              paymasterStubResponse.paymasterPostOpGasLimit = BigInt(100000);
              paymasterStubResponse.paymasterVerificationGasLimit = BigInt(200000);
              return paymasterStubResponse;
            },
          },
          paymasterContext: scsContext,
        // Note: Otherise makes a call to a different endpoint as of now. WIP on the sdk
          userOperation: {
            estimateFeesPerGas: async ({ account, bundlerClient, userOperation }: { 
              account: any; 
              bundlerClient: any; 
              userOperation: any;
            }) => {
              return {
                maxFeePerGas: BigInt(10000000),
                maxPriorityFeePerGas: BigInt(10000000)
              }
            }
          }
      })

      const address = smartAccountClient.account.address;
      console.log("address", address);

      const counterStateBefore = (await publicClient.readContract({
        address: counterContract,
        abi: CounterAbi,
        functionName: "counters",
        args: [smartAccountClient.account.address],
      })) as bigint;

      // Construct call data
      const callData = encodeFunctionData({
        abi: CounterAbi,
        functionName: "count",
      });

      const hash = await smartAccountClient.sendUserOperation({ 
        calls: [
          {
            to: counterContract as Address,
            value: BigInt(0),
            data: callData,
          },
        ],
      }); 
      const receipt = await smartAccountClient.waitForUserOperationReceipt({ hash }); 
      console.log("receipt", receipt);
    } catch (error) {
      spinner.fail(chalk.red(`Error: ${(error as Error).message}`));  
    }
    process.exit(0);
}

main();

