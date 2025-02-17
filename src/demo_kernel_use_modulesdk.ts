import "dotenv/config";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { createKernelAccount, createKernelAccountClient, getUserOperationGasPrice } from "@zerodev/sdk";
import { KERNEL_V3_2 } from "@zerodev/sdk/constants";
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
} from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { soneiumMinato } from "viem/chains";
import { Counter as CounterAbi } from "./abi/Counter";
import { SponsorshipPaymaster as PaymasterAbi } from "./abi/SponsorshipPaymaster";
import { erc7579Actions } from "permissionless/actions/erc7579";

import cliTable = require("cli-table3");
import chalk from "chalk";
import { getSmartSessionsValidator, getSocialRecoveryValidator } from "@rhinestone/module-sdk";

const bundlerUrl = process.env.BUNDLER_URL;
const paymasterUrl = process.env.PAYMASTER_SERVICE_URL;
const privateKey = process.env.OWNER_PRIVATE_KEY;
const counterContract = process.env.COUNTER_CONTRACT_ADDRESS as Address;
const ECDSAValidator = process.env.ECDSA_VALIDATOR_ADDRESS;
const kernelFactory = process.env.KERNEL_FACTORY_ADDRESS as Address;
const AccountRecoveryValidator = process.env.ACCOUNT_RECOVERY_MODULE_ADDRESS as Address;
const kernelImplementation = process.env.KERNEL_IMPLEMENTATION_ADDRESS as Address;
const stakerFactory = process.env.STAKER_FACTORY_ADDRESS as Address;
const paymasterContract = process.env.PAYMASTER_CONTRACT_ADDRESS as Address;

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
  
  const kernelVersion = KERNEL_V3_2;
  
  const scsContext = { mode: "SPONSORED", calculateGasLimits: true, policyId: "some-policy-id" } 

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
  
      const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
        signer,
        entryPoint,
        kernelVersion,
        validatorAddress: ECDSAValidator as Address,
      });
  
      // Create Kernel account
      const account = await createKernelAccount(publicClient, {
        plugins: {
          sudo: ecdsaValidator,
        },
        entryPoint,
        kernelVersion,
        factoryAddress: kernelFactory,
        accountImplementationAddress: kernelImplementation,
        useMetaFactory: true,
        metaFactoryAddress: stakerFactory,
        index: BigInt(127),
      });
  
      const factoryArgs = await account.getFactoryArgs();
      console.log(factoryArgs);
  
      spinner.succeed(chalk.greenBright.bold.underline("Smart account initialized."));
  
      tableBefore.push(
        { "Bundler url": bundlerUrl.split("?")[0] },
        { "Paymaster service url": paymasterUrl.split("/").slice(0, 6).join("/") },
        { "Paymaster contract address": paymasterContract },
        { "Entry Point address": entryPoint07Address },
        { "Smart account address": account.address },
        { "ECDSA validator address": ECDSAValidator }
      );
      console.log(tableBefore.toString());
      console.log("\n");
  
      const kernelClient = createKernelAccountClient({
        account,
        chain: soneiumMinato,
        bundlerTransport: http(bundlerUrl),
        client: publicClient,
        paymaster: {
          async getPaymasterData(pmDataParams: GetPaymasterDataParameters) {
            console.log("Called getPaymasterData: ", pmDataParams);
            const paymasterResponse = await paymasterClient.getPaymasterData(pmDataParams);
            console.log("Paymaster Response: ", paymasterResponse);
            return paymasterResponse;
          },
          async getPaymasterStubData(pmStubDataParams: GetPaymasterDataParameters) {
            console.log("Called getPaymasterStubData: ", pmStubDataParams);
            const paymasterStubResponse = await paymasterClient.getPaymasterStubData(pmStubDataParams);
            console.log("Paymaster Stub Response: ", paymasterStubResponse);
            // return paymasterStubResponse;
            return {
              ...paymasterStubResponse,
              paymasterAndData: undefined,
              paymaster: paymasterContract,
              paymasterData: paymasterStubResponse.paymasterData || "0x",
              paymasterVerificationGasLimit: paymasterStubResponse.paymasterVerificationGasLimit || BigInt(200000),
              paymasterPostOpGasLimit: paymasterStubResponse.paymasterPostOpGasLimit || BigInt(100000),
            };
          },
        },
        paymasterContext: scsContext,
  
        userOperation: {
          estimateFeesPerGas: async ({bundlerClient}) => {
            return {
              maxFeePerGas: BigInt(10000000),
              maxPriorityFeePerGas: BigInt(10000000)
          }
          }
        }
      }).extend(erc7579Actions());
  
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

      console.log("Social Recovery: ", socialRecovery);
      
      const context = encodePacked(
        ['address', 'bytes'],
        [
          zeroAddress,
          encodeAbiParameters(
            [{ type: 'bytes' }, { type: 'bytes' }],
            [socialRecovery.initData || '0x', '0x'],
          ),
        ],
    )

    // replace address
    socialRecovery.address = AccountRecoveryValidator;
    socialRecovery.module = AccountRecoveryValidator;

    const isModuleInstalled = await kernelClient.isModuleInstalled(socialRecovery);

    if (isModuleInstalled) {
        console.log("Module is already installed");
        process.exit(0);
    }
    
    const opHash = await kernelClient.installModule({
        type: socialRecovery.type,
        address: AccountRecoveryValidator, // custom address override
        context: context,
    })

    console.log("Operation hash: ", opHash);

    const ourBundlerClient = kernelClient.extend(bundlerActions)
    
    await ourBundlerClient.waitForUserOperationReceipt({
        hash: opHash,
    })    
    } catch (error) {
      spinner.fail(chalk.red(`Error: ${(error as Error).message}`));
    }
    process.exit(0);
  };
  
  function bigIntToHex(_: string, value: any) {
    if (typeof value === "bigint") {
      return toHex(value);
    }
    return value;
  }
  main();
