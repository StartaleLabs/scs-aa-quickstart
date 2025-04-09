// Uses Only Zerodev SDK
// This would use kernel client with our defined paymaster and paymasterContext
// UserOperation needs to be defined with estimateFeesPerGas
// but unfortunately 
/*
estimateFeesPerGas: async ({bundlerClient}) => {
      return getUserOperationGasPrice(bundlerClient)
    }*/
// When you can above from zerodev sdk makes a call to  zd_getUserOperationGasPrice that does not exist on our bundler
// hence I am returning our defined hard-coded gas price.   


// Update: It installs account recovery and smart session modules both if not already installed.


// Done: Send using abstracted smart account client and making sure SCS paymaster works

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
import { type InstallModuleParameters } from "permissionless/actions/erc7579";

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
const SmartSessionValidator = process.env.SMART_SESSIONS_MODULE_ADDRESS as Address;
const UniActionPolicy = process.env.UNI_ACTION_POLICY_MODULE_ADDRESS as Address;
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

const scsContext = { calculateGasLimits: true, policyId: "sudo" }

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
      index: BigInt(158813),
    });

    const factoryArgs = await account.getFactoryArgs();
    // console.log(factoryArgs);

    const accountBalanceBefore = (await publicClient.getBalance({
      address: account.address,
    })) as bigint;

    const counterStateBefore = (await publicClient.readContract({
      address: counterContract,
      abi: CounterAbi,
      functionName: "counters",
      args: [account.address],
    })) as bigint;

    const paymasterDepositBefore = (await publicClient.readContract({
      address: paymasterContract,
      abi: PaymasterAbi,
      functionName: "getDeposit",
      args: [],
    })) as bigint;

    spinner.succeed(chalk.greenBright.bold.underline("Smart account initialized."));

    tableBefore.push(
      { "Bundler url": bundlerUrl.split("?")[0] },
      { "Paymaster service url": paymasterUrl.split("/").slice(0, 6).join("/") },
      { "Paymaster contract address": paymasterContract },
      { "Entry Point address": entryPoint07Address },
      { "Smart account address": account.address },
      { "ECDSA validator address": ECDSAValidator },
      { "Counter state": counterStateBefore.toString() },
      { "Account balance": formatEther(accountBalanceBefore) },
      { "Paymaster deposit": formatEther(paymasterDepositBefore) },
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

    // Construct call data
    const callData = encodeFunctionData({
      abi: CounterAbi,
      functionName: "count",
    });

    const userOpHash = await kernelClient.sendUserOperation({
      callData: await kernelClient.account.encodeCalls([{
        to: counterContract,
        value: BigInt(0),
        data: callData
      }]),
    })

    spinner.succeed(chalk.greenBright.bold.underline("User operation submitted"));
    console.log("\n");
    spinner.start("Waiting for user operation to be included in a block");
    const receipt = await kernelClient.waitForUserOperationReceipt({
      hash: userOpHash,
    });
    // console.log("User operation included", receipt);
    console.log("transaction hash: ", receipt.receipt.transactionHash);

    // const smartSessionValidator = 

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

    // override module address with ours
    socialRecovery.module = AccountRecoveryValidator;
    socialRecovery.address = AccountRecoveryValidator;

    console.log("Social Recovery Validator: ", socialRecovery);

    // Note: this is the withHook branch of _installModule API of kernel from module-sdk
    const initDataArg = encodePacked(
      ['address', 'bytes'],
      [
        zeroAddress,
        encodeAbiParameters(
          [{ type: 'bytes' }, { type: 'bytes' }],
          [socialRecovery.initData || '0x', '0x'],
        ),
      ],
    )

    // This will install by making calls object and calling sendUserOperation

    const calls = [
        {
          to: account.address,
          value: BigInt(0),
          data: encodeFunctionData({
            abi: [
              {
                name: "installModule",
                type: "function",
                stateMutability: "nonpayable",
                inputs: [
                  {
                    type: "uint256",
                    name: "moduleTypeId"
                  },
                  {
                    type: "address",
                    name: "module"
                  },
                  {
                    type: "bytes",
                    name: "initData"
                  }
                ],
                outputs: []
              }
            ],
            functionName: "installModule",
            args: [BigInt(1), AccountRecoveryValidator, initDataArg]
          })
        }
      ]
    console.log("Calls: ", calls);

    const isAccountRecoveryModuleInstalled = await kernelClient.isModuleInstalled(socialRecovery);
    console.log("Is Module Installed: ", isAccountRecoveryModuleInstalled);

    if(!isAccountRecoveryModuleInstalled) {

    const installModuleUserOpHash = await kernelClient.sendUserOperation({
        callData: await kernelClient.account.encodeCalls(calls),
        // calls: calls this also works..
    })
  
    // spinner.succeed(chalk.greenBright.bold.underline("User operation submitted to install the recovery module"));
    // console.log("\n");
    // spinner.start("Waiting for user operation to be included in a block");

    const receiptNew = await kernelClient.waitForUserOperationReceipt({
        hash: installModuleUserOpHash,
      });
      // console.log("User operation included", receipt);
    console.log("transaction hash: ", receiptNew.receipt.transactionHash);

    const ourBundlerClient = kernelClient.extend(bundlerActions);

    const result = await ourBundlerClient.waitForUserOperationReceipt({ hash: installModuleUserOpHash });

    spinner.succeed(chalk.greenBright.bold.underline("Module installed successfully"));

    const isModuleInstalledNow = await kernelClient.isModuleInstalled(socialRecovery);
    console.log("Is Module Installed: ", isModuleInstalledNow);

    } else {
      console.log("Module is already installed");
      spinner.succeed(chalk.greenBright.bold.underline("Module is already installed"));
    }

    const smartSessions = getSmartSessionsValidator({})
    console.log("Smart Sessions: ", smartSessions);

    // Override our own addresses
    smartSessions.address = SmartSessionValidator
    smartSessions.module = SmartSessionValidator

    const isSmartSessionsModuleInstalled = await kernelClient.isModuleInstalled(smartSessions)
    console.log("Is Smart Sessions Module Installed: ", isSmartSessionsModuleInstalled);

    if(!isSmartSessionsModuleInstalled) {

    const context = encodePacked(
      ['address', 'bytes'],
      [
        zeroAddress,
        encodeAbiParameters(
          [{ type: 'bytes' }, { type: 'bytes' }],
          [smartSessions.initData || '0x', '0x'],
        ),
      ],
    )

    const opHash = await kernelClient.installModule({
      type: smartSessions.type,
      address: SmartSessionValidator, // custom address override
      context: context,
    })

    console.log("Operation hash: ", opHash);

    const ourBundlerClient = kernelClient.extend(bundlerActions)
  
    const result = await ourBundlerClient.waitForUserOperationReceipt({
         hash: opHash,
    })
    console.log("Operation result: ", result.receipt.transactionHash);

    spinner.succeed(chalk.greenBright.bold.underline("Smart Sessions Module installed successfully"));
    
    const isSmartSessionsModuleInstalledNow = await kernelClient.isModuleInstalled(smartSessions)
    console.log("Is Smart Sessions Module Installed Now: ", isSmartSessionsModuleInstalledNow);
  } else {
    console.log("Module is already installed");
    spinner.succeed(chalk.greenBright.bold.underline("Module is already installed"));
  }
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
