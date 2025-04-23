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
  stringify,
  PublicClient,
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
} from "viem/account-abstraction";
import { generatePrivateKey, privateKeyToAccount, sign } from "viem/accounts";
import { baseSepolia, soneiumMinato } from "viem/chains";
import { Counter as CounterAbi } from "../abi/Counter";
import { SponsorshipPaymaster as PaymasterAbi } from "../abi/SponsorshipPaymaster";
// import { erc7579Actions } from "permissionless/actions/erc7579";
// import { type InstallModuleParameters } from "permissionless/actions/erc7579";

import { createSmartAccountClient, smartSessionActions, toStartaleSmartAccount } from "startale-aa-sdk";
import { getSmartSessionsValidator, getSudoPolicy, getTrustAttestersAction } from "@rhinestone/module-sdk";
import { isSessionEnabled } from "@rhinestone/module-sdk";
import { toSmartSessionsModule } from "startale-aa-sdk";

import type Table from "cli-table3";
import CliTable from "cli-table3";
import chalk from "chalk";


const bundlerUrl = process.env.BUNDLER_URL;
const paymasterUrl = process.env.PAYMASTER_SERVICE_URL;
const privateKey = process.env.OWNER_PRIVATE_KEY;
const counterContract = process.env.COUNTER_CONTRACT_ADDRESS as Address;
const MOCK_ATTESTER_ADDRESS = process.env.MOCK_ATTESTER_ADDRESS as Address;

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
  
    const tableConfig = {
      colWidths: [30, 60], // Requires fixed column widths
      wordWrap: true,
      wrapOnWordBoundary: false,
    };
  
    try {
      // spinner.start("Initializing smart account...");
      const tableBefore = new CliTable(tableConfig);

      const eoaAddress = signer.address;
      console.log("eoaAddress", eoaAddress); 

      const smartAccountClient = createSmartAccountClient({
        account: await toStartaleSmartAccount({ 
             signer: signer, 
             chain,
             transport: http(),
             index: BigInt(10099556443667779)
        }),
        bundlerUrl,
        // transport: http(bundlerUrl) as any,
        mock: true,
        // client: publicClient as any,
        paymaster: {
            async getPaymasterData(pmDataParams: GetPaymasterDataParameters) {
              pmDataParams.paymasterPostOpGasLimit = BigInt(100000);
              pmDataParams.paymasterVerificationGasLimit = BigInt(200000);
              pmDataParams.verificationGasLimit = BigInt(500000);
              // console.log("Called getPaymasterData: ", pmDataParams);
              const paymasterResponse = await paymasterClient.getPaymasterData(pmDataParams);
              console.log("Paymaster Response: ", paymasterResponse);
              return paymasterResponse;
            },
            async getPaymasterStubData(pmStubDataParams: GetPaymasterDataParameters) {
              // console.log("Called getPaymasterStubData: ", pmStubDataParams);
              const paymasterStubResponse = await paymasterClient.getPaymasterStubData(pmStubDataParams);
              console.log("Paymaster Stub Response: ", paymasterStubResponse);
              return paymasterStubResponse;
            },
          },
        paymasterContext: scsContext,
        // Note: Otherise makes a call to a different endpoint as of now. WIP on the sdk
        userOperation: {
            estimateFeesPerGas: async ({bundlerClient}: {bundlerClient: any}) => {
              return {
                maxFeePerGas: BigInt(10000000),
                maxPriorityFeePerGas: BigInt(10000000)
            }
            }
          }
      })

      const address = await smartAccountClient.account.getAddress();
      console.log("address", address);

      // Note: Can keep fixed session owner
      const sessionOwner = privateKeyToAccount(generatePrivateKey())

      // Create a smart sessions module for the user's account
      const sessionsModule = toSmartSessionsModule({
        signer: signer,
      })

      console.log("sessionsModule", sessionsModule);

      const isInstalledBefore = await smartAccountClient.isModuleInstalled({
        module: sessionsModule
      })

      if(!isInstalledBefore) {
        const installModuleHash = await smartAccountClient.installModule({
            module: sessionsModule
        })

        const result = await bundlerClient.waitForUserOperationReceipt({
            hash: installModuleHash,
          })
          console.log("Operation result: ", result.receipt.transactionHash);
    
          spinner.succeed(chalk.greenBright.bold.underline("Smart Sessions Module installed successfully"));
      } else {
        spinner.succeed(chalk.greenBright.bold.underline("Smart Sessions Module already installed"));
      }

      const startaleSessionClient = smartAccountClient.extend(
        smartSessionActions()
      )

      // const trustAttestersAction = getTrustAttestersAction({
      //   threshold: 1,
      //   attesters: [
      //     MOCK_ATTESTER_ADDRESS, // Mock Attester - do not use in production
      //   ],
      // });

      // const trustAttestorsOpHash = await startaleSessionClient.sendUserOperation({
      //   calls: [
      //     {
      //       to: trustAttestersAction.target,
      //       data: trustAttestersAction.data,
      //       value: BigInt(0),
      //     }
      //   ],
      // })
      // console.log("trustAttestorsOpHash", trustAttestorsOpHash);

      // const receipt = await startaleSessionClient.waitForUserOperationReceipt({ hash: trustAttestorsOpHash });
      // console.log("receipt", receipt);

      // Note: It uses sudo policy here but we can make use of uni action policy as well

      const sessionDetails = await startaleSessionClient.grantPermission({
        redeemer: sessionOwner.address,
        actions: [
        {
          actionTarget: counterContract,
          actionTargetSelector: "0x06661abd" as Hex,
          actionPolicies: [getSudoPolicy()]
        }
      ] 
      })
      console.log("sessionDetails", sessionDetails);

      // wait for 20 seconds
      // await new Promise(resolve => setTimeout(resolve, 20000));




      // const cachedSessionDetails = stringify(sessionDetails);
      // console.log("cachedSessionDetails", cachedSessionDetails);

      spinner.succeed(chalk.greenBright.bold.underline("Session created successfully with granted permissions"));

      const counterStateBefore = (await publicClient.readContract({
        address: counterContract,
        abi: CounterAbi,
        functionName: "counters",
        args: [smartAccountClient.account.address],
      })) as bigint;
      console.log("counterStateBefore", counterStateBefore);
  
  
      // Now we will make use of Granted permissions
      // const parsedSessionDetails = JSON.parse(cachedSessionDetails);
      // console.log("parsedSessionDetails", parsedSessionDetails);

      // const isEnabled = await isSessionEnabled({
      //   client: smartAccountClient.account.client as PublicClient,
      //   account: {
      //     type: "nexus", // Todo: Need to contribute on module sdk to support our smart account
      //     address: smartAccountClient.account.address,
      //     deployedOnChains: [chain.id]
      //   },
      //   permissionId: sessionDetails.permissionId
      // })
      // console.log("is session Enabled", isEnabled);    


      const emulatedAccount = await toStartaleSmartAccount({
        accountAddress: smartAccountClient.account.address,
        signer: sessionOwner,
        chain,
        transport: http(),
      })

      const emulatedClient = createSmartAccountClient({
        account: emulatedAccount,
        transport: http(bundlerUrl),
        mock: true,
        client: publicClient as any,
        paymaster: {
          async getPaymasterData(pmDataParams: GetPaymasterDataParameters) {
            pmDataParams.paymasterPostOpGasLimit = BigInt(100000);
            pmDataParams.paymasterVerificationGasLimit = BigInt(200000);
            pmDataParams.verificationGasLimit = BigInt(500000);
            // console.log("Called getPaymasterData: ", pmDataParams);
            const paymasterResponse = await paymasterClient.getPaymasterData(pmDataParams);
            console.log("Paymaster Response: ", paymasterResponse);
            return paymasterResponse;
          },
          async getPaymasterStubData(pmStubDataParams: GetPaymasterDataParameters) {
            // console.log("Called getPaymasterStubData: ", pmStubDataParams);
            const paymasterStubResponse = await paymasterClient.getPaymasterStubData(pmStubDataParams);
            console.log("Paymaster Stub Response: ", paymasterStubResponse);
            return paymasterStubResponse;
          },
        },
        paymasterContext: scsContext,
      // Note: Otherise makes a call to a different endpoint as of now. WIP on the sdk
        userOperation: {
          estimateFeesPerGas: async ({bundlerClient}: {bundlerClient: any}) => {
            return {
              maxFeePerGas: BigInt(10000000),
              maxPriorityFeePerGas: BigInt(10000000)
          }
          }
        }
      })

      const smartSessionsClient = emulatedClient.extend(smartSessionActions())

      // Construct call data
      const callData = encodeFunctionData({
        abi: CounterAbi,
        functionName: "count",
      });

      const userOpHashOne = await smartSessionsClient.usePermission({
        sessionDetails,
        calls: [{ to: counterContract, data: callData }],
        mode: "ENABLE_AND_USE"
      })
      const receiptOne = await smartSessionsClient.waitForUserOperationReceipt({
        hash: userOpHashOne
      })
      console.log("receiptOne", receiptOne);

      const counterStateAfter = (await publicClient.readContract({
        address: counterContract,
        abi: CounterAbi,
        functionName: "counters",
        args: [smartAccountClient.account.address],
      })) as bigint;
      console.log("counterStateAfter", counterStateAfter);


    } catch (error) {
      spinner.fail(chalk.red(`Error: ${(error as Error).message}`));  
    }
    process.exit(0);
}

main();


// Note: very weird failure for USE_AND_ENABLE (enable mode)
// https://dashboard.tenderly.co/livingrock7/project/simulator/4ed234fd-9c18-4251-82d4-09e4e9376b38/debugger?trace=0.1.2.5.3.1.2.0.1.3


// latest
// https://dashboard.tenderly.co/livingrock7/project/simulator/b9f5b8f9-6730-45f0-8c70-b651ad1ac94c
// ✖ Error: The `validateUserOp` function on the Smart Account reverted.

/**latest log
 Request Arguments:
  callData:                       0xe9ae5c530000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000386bcf154a6b80fde9bd1556d39c9bcbb19b539bd8000000000000000000000000000000000000000000000000000000000000000006661abd0000000000000000
  callGasLimit:                   0
  maxFeePerGas:                   0.01 gwei
  maxPriorityFeePerGas:           0.01 gwei
  nonce:                          105774673733701273844451106561389326051175726729606719678355672493621069742080
  paymaster:                      0x20e8677acb27bc0dc3bca61f981324560cb77066
  paymasterData:                  0xfc035b327d67e3d12f207c6a3fe5d5ed67ade5be000067bf47c7000067bf456f000f4240f1eada0dec5820753a80a48aa0697f31bfc80cfb549a1ef1420f3d9e52252bec4f9ca153d59736b1c43c6c5b762922df0abdd8f0841a69d6f595710d0d617e701b
  paymasterPostOpGasLimit:        0
  paymasterVerificationGasLimit:  0
  preVerificationGas:             0
  sender:                         0xe4F4db46073fCd16dd933eB16eC42095Be1b780D
  signature:                      0x02010000e014010040e0141d020005802004e03300e0173f00e0e0155c0104c0e0151f0100012003e012001f079ae887ef01a0bc47fa376c298b134cb2bc900df4865bcd1b4d601382d1843b0104aee0033c132483da3a338895199e5e538530213157e931bf06e0031fe00a001fe03a50a62b44c0e29462b0e3e7dec4295806b074753eed0e0621a7410580d28500b2e00a33e002000001e1161f010220e0022ce00a000102a0e00a14e00300e1161fe1189fe0173fe2163fe0053f1376bdbbfc4c5fa1a05e6f86b3edb217bbf762ec952023e01300e0177fe1071f0f3111cd8e92337c100f22b7a9dbf8dee3e0173fe017bfe01700e0173f0060e01740e03600e017df042006661abde01f63136bcf154a6b80fde9bd1556d39c9bcbb19b539bd8e0163be017dfe0189fe0065fe167bf0055e0067f60001f09cfd93a2d4dc4067adfaa505c502bab3110b9671c41a894391ebc3d2d3a70171f5259805cae7252c5f63e13eb04282acfb1dad374503a82cbbbb79a897f920cb8001b6045e01c001f41e8b94748580ca0b4993c9a1b86b5be851bfc076ff5ce3a1ff65bf16392acfc1fb800f9b4f1aef1555c7fce5599fffb17e7c635502154a0333ba21f3ae491839a01f51ce01166040000000000
  verificationGasLimit:           0

Details: validation reverted: [reason]: AA23 reverted
 */