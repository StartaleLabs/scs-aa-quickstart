// WIP
// ref: https://docs.biconomy.io/tutorials/smart-sessions

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
import { erc7579Actions } from "permissionless/actions/erc7579";
import { type InstallModuleParameters } from "permissionless/actions/erc7579";

// import { createNexusClient } from "@biconomy/abstractjs";
import { CreateSessionDataParams, createSmartAccountClient, SessionData, smartSessionCreateActions, SmartSessionMode, toNexusAccount, toSmartSessionsValidator } from "@biconomy/abstractjs";

import cliTable = require("cli-table3");
import chalk from "chalk";


const bundlerUrl = process.env.BUNDLER_URL;
const paymasterUrl = process.env.PAYMASTER_SERVICE_URL;
const privateKey = process.env.OWNER_PRIVATE_KEY;
const counterContract = process.env.COUNTER_CONTRACT_ADDRESS as Address;
const k1Validator = process.env.NEXUS_K1_VALIDATOR_ADDRESS as Address;
const k1ValidatorFactory = process.env.NEXUS_K1_VALIDATOR_FACTORY_ADDRESS as Address;
const paymasterContract = process.env.PAYMASTER_CONTRACT_ADDRESS as Address;
const mockAttester = process.env.MOCK_ATTESTER_ADDRESS as Address;

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

// Note: in case of biconomy sdk we MUST use calculateGasLimits true otherwise we get verificationGasLimit too low
const scsContext = { calculateGasLimits: true, policyId: "policy_1" }

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

      const nexusClient = createSmartAccountClient({
        account: await toNexusAccount({ 
          signer: signer, 
          chain: chain,
          transport: http(),
          attesters: [mockAttester],
          factoryAddress: k1ValidatorFactory,
          validatorAddress: k1Validator,
          index: BigInt(1000012)
        }),
        transport: http(bundlerUrl),
        client: publicClient,
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
        // Note: Otherise makes a call to 'biconomy_getGasFeeValues' endpoint
          userOperation: {
            estimateFeesPerGas: async ({bundlerClient}) => {
              return {
                maxFeePerGas: BigInt(10000000),
                maxPriorityFeePerGas: BigInt(10000000)
            }
            }
          }
      })

    
      const address = nexusClient.account.address;
      console.log("address", address);

      // Note: Can keep fixed session owner
      const sessionOwner = privateKeyToAccount(generatePrivateKey())

      // Create a smart sessions module for the user's account
      const sessionsModule = toSmartSessionsValidator({
        account: nexusClient.account,
        signer: sessionOwner,
      })

      console.log("sessionsModule", sessionsModule);

      const isInstalledBefore = await nexusClient.isModuleInstalled({
        module: sessionsModule.moduleInitData
      })

      if(!isInstalledBefore) {
        const installModuleHash = await nexusClient.installModule({
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

      const nexusSessionClient = nexusClient.extend(
        smartSessionCreateActions(sessionsModule)
      )

      // // Define the session parameters
      // // This includes the session key, validator, and action policies
      // const createSessionsResponse = await nexusSessionClient.grantPermission({
      //   sessionRequestedInfo: [
      //     {
      //      sessionPublicKey: sessionOwner.address, // Public key of the session
      //      // sessionValidUntil: number
      //     // sessionValidAfter: number
      //     // chainIds: bigint[]
      //      actionPoliciesInfo: [
      //        {
      //          abi: CounterAbi,
      //          contractAddress: counterContract,
      //          sudo: true
      //          // validUntil?: number
      //          // validAfter?: number
      //          // valueLimit?: bigint
      //         }
      //       ]
      //     }
      //   ]
      // })

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
      granter: nexusClient.account.address,
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
    
    } catch (error) {
      spinner.fail(chalk.red(`Error: ${(error as Error).message}`));  
    }
    process.exit(0);
}

main();