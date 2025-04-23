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
const scsContext = { calculateGasLimits: true, policyId: "sudo" }

const main = async () => {
    const spinner = ora({ spinner: "bouncingBar" });

    // Temp
    // const myOp = {     "sender": "0xe4F4db46073fCd16dd933eB16eC42095Be1b780D",     "nonce": "62828681322231232907286512033976056159756845270237988405814858436465978769408",     "initCode": "0x",     "callData": "0xe9ae5c530000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000386bcf154a6b80fde9bd1556d39c9bcbb19b539bd8000000000000000000000000000000000000000000000000000000000000000006661abd0000000000000000",     "accountGasLimits": "0x0000000000000000000000000000000000000000000000000000000000000000",     "preVerificationGas": "0",     "gasFees": "0x0000000000000000000000000098968000000000000000000000000000989680",     "paymasterAndData": "0x20e8677acb27bc0dc3bca61f981324560cb770660000000000000000000000000000000000000000000000000000000000000000fc035b327d67e3d12f207c6a3fe5d5ed67ade5be000067bf47c7000067bf456f000f4240f1eada0dec5820753a80a48aa0697f31bfc80cfb549a1ef1420f3d9e52252bec4f9ca153d59736b1c43c6c5b762922df0abdd8f0841a69d6f595710d0d617e701b",     "signature": "0x02010000e014010040e0141d0100052003e034000080e0163d00e0e0151f0004e0169f0100012003e012001f079ad835a566e5d68bb2c9b03f426a865c62d57fa110605e679de813fa80bbea017b48e0033c132483da3a338895199e5e538530213157e931bf06e0031fe00a001fe0c1a92d0aaf72d3ecc1baf1100e915935f0b24e87640207503b6ccbb5db98510076e00a33e002000001e1161f0101a0e0022ce00a00010220e00a14e02300e0167fe1175fe2173fe0053f1331bf5f07f2d2e4c23ad90030be32c990f0938f662023e03300e2171f0060e0335ce01a00e2167f05002006661abd2007e01c00136bcf154a6b80fde9bd1556d39c9bcbb19b539bd8e01638e017dfe0189fe0065f0f3111cd8e92337c100f22b7a9dbf8dee3e0173fe1177fe017000055e00b201fa5a8becf7020ffd44e0d4987514495be02bd578c0cadbbb00e33971e146d7a021f0788e81ae0aba85d78f379a28c6e30ea8613ad4456415dd9938c450d6eff2f74001be00b54e00d001f41e8b94748580ca0b4993c9a1b86b5be851bfc076ff5ce3a1ff65bf16392acfc1fb800f9b4f1aef1555c7fce5599fffb17e7c635502154a0333ba21f3ae491839a01f51ce00d5708000000000000000000"   };
    // const opHash = getUserOperationHash({
    //   userOperation: myOp as any,
    //   entryPointVersion: entryPoint.version,
    //   chainId: chain.id,
    //   entryPointAddress: entryPoint.address,
    // })
    // console.log("opHash", opHash);
  
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
          index: BigInt(1093)
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

