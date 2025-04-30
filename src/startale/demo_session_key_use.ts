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

import { CreateSessionDataParams, createSmartAccountClient, SessionData, smartSessionCreateActions, smartSessionUseActions, toStartaleSmartAccount } from "startale-aa-sdk";
import { getSmartSessionsValidator, getSudoPolicy, getTrustAttestersAction, SmartSessionMode } from "@rhinestone/module-sdk";
import { isSessionEnabled } from "@rhinestone/module-sdk";
import { toSmartSessionsValidator } from "startale-aa-sdk";

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
             index: BigInt(9106893)
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

      // First things first
      // If we use our own deployment or ENABLE mode then no need to trust attesters

      const trustAttestersAction = getTrustAttestersAction({
        threshold: 1,
        attesters: [
          MOCK_ATTESTER_ADDRESS, // Mock Attester - do not use in production
        ],
      });

      const trustAttestorsOpHash = await smartAccountClient.sendUserOperation({
        calls: [
          {
            to: trustAttestersAction.target,
            data: trustAttestersAction.data,
            value: BigInt(0),
          }
        ],
      })
      console.log("trustAttestorsOpHash", trustAttestorsOpHash);

      const receipt = await smartAccountClient.waitForUserOperationReceipt({ hash: trustAttestorsOpHash });
      console.log("receipt for trusting attester", receipt);

      // Note: Can keep fixed session owner
      const sessionOwner = privateKeyToAccount(generatePrivateKey())
      console.log("session owner address ", sessionOwner.address);

      // Create a smart sessions module for the user's account
      const sessionsModule = toSmartSessionsValidator({
        account: smartAccountClient.account,
        signer: sessionOwner,
      })

      // console.log("sessionsModule", sessionsModule);

      // Review
      const isInstalledBefore = await smartAccountClient.isModuleInstalled({
        module: sessionsModule
      })
      console.log("isInstalledBefore", isInstalledBefore);

      if(!isInstalledBefore) {
        const installModuleHash = await smartAccountClient.installModule({
          module: sessionsModule.moduleInitData
        });

        const result = await bundlerClient.waitForUserOperationReceipt({
            hash: installModuleHash,
          })
        console.log("Operation result: ", result.receipt.transactionHash);
    
        spinner.succeed(chalk.greenBright.bold.underline("Smart Sessions Module installed successfully"));
      } else {
        spinner.succeed(chalk.greenBright.bold.underline("Smart Sessions Module already installed"));
      }

      const nexusSessionClient = smartAccountClient.extend(
        smartSessionCreateActions(sessionsModule)
      )

      // Note: It uses sudo policy here but we can make use of uni action policy as well

      // session key signer address is declared here
      const sessionRequestedInfo: CreateSessionDataParams[] = [
        {
         sessionPublicKey: sessionOwner.address, // session key signer
         actionPoliciesInfo: [
           {
             contractAddress: counterContract, // counter address
             functionSelector: '0x06661abd' as Hex, // function selector for increment count
             sudo: true
           }
          ]
        }
      ]

      const createSessionsResponse = await nexusSessionClient.grantPermission({
        sessionRequestedInfo
      })
      console.log("createSessionsResponse", createSessionsResponse);

      const sessionData: SessionData = {
        granter: smartAccountClient.account.address,
        description: `Session to increment a counter for ${counterContract}`,
        sessionPublicKey: sessionOwner.address,
        moduleData: {
          permissionIds: createSessionsResponse.permissionIds,
          action: createSessionsResponse.action,
          mode: SmartSessionMode.USE,
          sessions: createSessionsResponse.sessions
        }
      }

      const cachedSessionData = stringify(sessionData);
      console.log("cachedSessionData", cachedSessionData);

      const result = await bundlerClient.waitForUserOperationReceipt({
        hash: createSessionsResponse.userOpHash,
      })
      console.log("Operation result: ", result.receipt.transactionHash);
      spinner.succeed(chalk.greenBright.bold.underline("Session created successfully with granted permissions"));

      const counterStateBefore = (await publicClient.readContract({
        address: counterContract,
        abi: CounterAbi,
        functionName: "counters",
        args: [smartAccountClient.account.address],
      })) as bigint;
      console.log("counterStateBefore", counterStateBefore);

      // Now we will make use of Granted permissions

    const parsedSessionData = JSON.parse(cachedSessionData) as SessionData;
    console.log("parsedSessionData", parsedSessionData);

    const isEnabled = await isSessionEnabled({
      client: smartAccountClient.account.client as PublicClient,
      account: {
        type: "nexus",
        address: smartAccountClient.account.address,
        deployedOnChains: [chain.id]
      },
      permissionId: parsedSessionData.moduleData.permissionIds[0]
    })
    console.log("is session Enabled", isEnabled);


    const smartSessionNexusClient = createSmartAccountClient({
      account: await toStartaleSmartAccount({ 
           signer: sessionOwner, 
           accountAddress: sessionData.granter,
           chain,
           transport: http()
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

    const usePermissionsModule = toSmartSessionsValidator({
      account: smartSessionNexusClient.account,
      signer: sessionOwner,
      moduleData: parsedSessionData.moduleData
    })

    const useSmartSessionNexusClient = smartSessionNexusClient.extend(
      smartSessionUseActions(usePermissionsModule)
    )

    // Construct call data
    const callData = encodeFunctionData({
      abi: CounterAbi,
      functionName: "count",
    });

    const userOpHash = await useSmartSessionNexusClient.usePermission({
      calls: [
        {
          to: counterContract,
          data: callData
        }
      ]
    })
    console.log("userOpHash", userOpHash);

    const resultOfUsedSession = await bundlerClient.waitForUserOperationReceipt({
      hash: userOpHash,
    });

    console.log("Operation result: ", resultOfUsedSession.receipt.transactionHash);
    spinner.succeed(chalk.greenBright.bold.underline("Session used successfully"));

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