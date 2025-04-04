// WIP
// ref: https://docs.biconomy.io/nexus-client

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
} from "viem/account-abstraction";
import { generatePrivateKey, privateKeyToAccount, sign } from "viem/accounts";
import { baseSepolia, soneiumMinato } from "viem/chains";
import { Counter as CounterAbi } from "../abi/Counter";
import { SponsorshipPaymaster as PaymasterAbi } from "../abi/SponsorshipPaymaster";
import { erc7579Actions } from "permissionless/actions/erc7579";
import { type InstallModuleParameters } from "permissionless/actions/erc7579";

// import { createNexusClient } from "@biconomy/abstractjs";
import { createSmartAccountClient, toNexusAccount } from "@biconomy/abstractjs";

import type Table from "cli-table3";
const CliTable = require("cli-table3") as typeof Table;
import chalk from "chalk";
import { getSmartSessionsValidator, getSocialRecoveryValidator } from "@rhinestone/module-sdk";


const bundlerUrl = process.env.BUNDLER_URL;
const paymasterUrl = process.env.PAYMASTER_SERVICE_URL;
const privateKey = process.env.OWNER_PRIVATE_KEY;
const counterContract = process.env.COUNTER_CONTRACT_ADDRESS as Address;
const k1Validator = process.env.NEXUS_K1_VALIDATOR_ADDRESS as Address;
const k1ValidatorFactory = process.env.NEXUS_K1_VALIDATOR_FACTORY_ADDRESS as Address;
const paymasterContract = process.env.PAYMASTER_CONTRACT_ADDRESS as Address;
const mockAttester = process.env.MOCK_ATTESTER_ADDRESS as Address;

const guardian1Pk = process.env.SIGNER_1_PRIVATE_KEY;
const guardian2Pk = process.env.SIGNER_2_PRIVATE_KEY;

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

    //   const nexusClient = await createNexusClient({
    //     signer: signer as any,
    //     chain: baseSepolia,
    //     transport: http(),
    //     bundlerTransport: http(bundlerUrl),
    //   });

      const eoaAddress = signer.address;
      console.log("eoaAddress", eoaAddress); 

      const nexusClient = createSmartAccountClient({
        account: await toNexusAccount({ 
          signer: signer, 
          chain: chain,
          transport: http(),
          attesters: [mockAttester],
          factoryAddress: "0x424B356131345c510C7c472F44cE44590064357D",
          validatorAddress: "0x3b9dDd021f2a46388dFb2478961B369bEAe45722",
          index: BigInt(10099556843)
        }),
        transport: http(bundlerUrl),
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
        // Note: Otherise makes a call to 'biconomy_getGasFeeValues' endpoint
          userOperation: {
            estimateFeesPerGas: async ({bundlerClient}: {bundlerClient: any}) => {
              return {
                maxFeePerGas: BigInt(10000000),
                maxPriorityFeePerGas: BigInt(10000000)
            }
            }
          }
      })

      const address = nexusClient.account.address;
      console.log("address", address);

      // Construct call data
      const callData = encodeFunctionData({
        abi: CounterAbi,
        functionName: "count",
      });

      const hash = await nexusClient.sendUserOperation({ 
        calls: [
          {
            to: counterContract as Address,
            value: BigInt(0),
            data: callData,
          },
        ],
      }); 
      const receipt = await nexusClient.waitForUserOperationReceipt({ hash }); 
      console.log("receipt tx hash", receipt.receipt.transactionHash);


      const guardian1 = privateKeyToAccount(
        guardian1Pk as Hex,
      ) // the key coresponding to the first guardian
       
      const guardian2 = privateKeyToAccount(
        guardian2Pk as Hex, 
      ) // the key coresponding to the second guardian
       
      const socialRecovery = getSocialRecoveryValidator({
         threshold: 2,
         guardians: [guardian1.address, guardian2.address],
      })

      console.log("socialRecovery", socialRecovery);

      const isAccountRecoveryModuleInstalled = await nexusClient.isModuleInstalled({
        module: socialRecovery
      })
      console.log("isAccountRecoveryModuleInstalled", isAccountRecoveryModuleInstalled);

      if(!isAccountRecoveryModuleInstalled) {

        const opHash = await nexusClient.installModule({
            module: socialRecovery
          })
    
          console.log("Operation hash: ", opHash);
    
          const result = await bundlerClient.waitForUserOperationReceipt({
            hash: opHash,
          })
          console.log("Operation result: ", result.receipt.transactionHash);
    
        spinner.succeed(chalk.greenBright.bold.underline("Account Recovery Module installed successfully"));

      } else {
        spinner.succeed(chalk.greenBright.bold.underline("Account Recovery Module already installed"));
      }

      // Smart Sessions Now..
      const smartSessions = getSmartSessionsValidator({})
      console.log("Smart Sessions: ", smartSessions);

      const isSmartSessionsModuleInstalled = await nexusClient.isModuleInstalled({
        module: smartSessions
      })
      console.log("Is Smart Sessions Module Installed: ", isSmartSessionsModuleInstalled);

      if(!isSmartSessionsModuleInstalled) {

        const opHash = await nexusClient.installModule({
            module: smartSessions
          })
    
          console.log("Operation hash: ", opHash);
    
          const result = await bundlerClient.waitForUserOperationReceipt({
            hash: opHash,
          })
          console.log("Operation result: ", result.receipt.transactionHash);
    
        spinner.succeed(chalk.greenBright.bold.underline("Smart Sessions Module installed successfully"));

      } else    {
        spinner.succeed(chalk.greenBright.bold.underline("Smart Sessions Module already installed"));
      }
      
    } catch (error) {
      spinner.fail(chalk.red(`Error: ${(error as Error).message}`));  
    }
    process.exit(0);
}

main();





