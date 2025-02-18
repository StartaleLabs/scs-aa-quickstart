// WIP

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
  toBytes,
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
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { soneiumMinato } from "viem/chains";
import { Counter as CounterAbi } from "./abi/Counter";
import { SponsorshipPaymaster as PaymasterAbi } from "./abi/SponsorshipPaymaster";
import { erc7579Actions } from "permissionless/actions/erc7579";
import { type InstallModuleParameters } from "permissionless/actions/erc7579";

import cliTable = require("cli-table3");
import chalk from "chalk";
import { encodeValidationData, getAccount, getEnableSessionDetails, getOwnableValidator, getOwnableValidatorOwners, getPermissionId, getSmartSessionsValidator, getSudoPolicy, getTrustAttestersAction, MOCK_ATTESTER_ADDRESS, OWNABLE_VALIDATOR_ADDRESS, RHINESTONE_ATTESTER_ADDRESS, Session, SMART_SESSIONS_ADDRESS } from "@rhinestone/module-sdk";
import { OwnableValidatorAbi } from "./abi/OwnableValidator";
import { enableingSessionsAbi, enableSessionAbi, installSmartSessionsAbi } from "./abi/SmartSessionAbi";

const bundlerUrl = process.env.BUNDLER_URL;
const paymasterUrl = process.env.PAYMASTER_SERVICE_URL;
const privateKey = process.env.OWNER_PRIVATE_KEY;
const counterContract = process.env.COUNTER_CONTRACT_ADDRESS as Address;
const ECDSAValidator = process.env.ECDSA_VALIDATOR_ADDRESS;
const kernelFactory = process.env.KERNEL_FACTORY_ADDRESS as Address;
const UniActionPolicy = process.env.UNI_ACTION_POLICY_MODULE_ADDRESS as Address;
const OwnableValidator = process.env.OWNABLE_VALIDATOR_ADDRESS as Address;
const kernelImplementation = process.env.KERNEL_IMPLEMENTATION_ADDRESS as Address;
const stakerFactory = process.env.STAKER_FACTORY_ADDRESS as Address;
const paymasterContract = process.env.PAYMASTER_CONTRACT_ADDRESS as Address;

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
      index: BigInt(19059),
    });

    const factoryArgs = await account.getFactoryArgs();
    console.log(factoryArgs);

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

    const smartSessions = getSmartSessionsValidator({})
    console.log("Smart Sessions: ", smartSessions);

    // Override our own addresses
    // smartSessions.address = SmartSessionValidator
    // smartSessions.module = SmartSessionValidator

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
      address: smartSessions.address,
      context: context,
    })

    console.log("Operation hash: ", opHash);
  
    const result = await bundlerClient.waitForUserOperationReceipt({
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

  const kernelAccountForModuleSdk = getAccount({
    address: account.address,
    type: 'kernel',
  })

  const trustAttestersAction = getTrustAttestersAction({
    threshold: 1,
    attesters: [
      RHINESTONE_ATTESTER_ADDRESS, // Rhinestone Attester
      MOCK_ATTESTER_ADDRESS, // Mock Attester - do not use in production
    ],
  });

  const userOpHash1 = await kernelClient.sendUserOperation({
    account: account,
    calls: [
      {
        to: trustAttestersAction.target,
        value: BigInt(0),
        data: trustAttestersAction.callData,
      },
    ],
  });

  const receipt1 = await bundlerClient.waitForUserOperationReceipt({
    hash: userOpHash1,
  });

  console.log("User Operation hash: ", receipt1.receipt.transactionHash);
  spinner.succeed(chalk.greenBright.bold.underline("Trust Attesters action executed successfully"));

  // Followed below as well
  // https://docs.rhinestone.wtf/module-registry/usage/mock-attestation


  // Install Ownable Validator

  const ownableValidator = getOwnableValidator({
    owners: [signer.address],
    threshold: 1,
    hook: zeroAddress,
  });

  ownableValidator.address = OwnableValidator
  ownableValidator.module = OwnableValidator

  ownableValidator.initData = encodePacked(
    ["address", "bytes"],
    [
      zeroAddress,
      encodeAbiParameters(
        [{ type: "bytes" }, { type: "bytes" }],
        [ownableValidator.initData, "0x"],
      ),
    ],
  );

  console.log("Ownable Validator: ", ownableValidator);

  const opHashInstallOwnableVal = await kernelClient.installModule(ownableValidator);
  console.log("Operation hash: ", opHashInstallOwnableVal);
  const result1 = await bundlerClient.waitForUserOperationReceipt({hash: opHashInstallOwnableVal});
  console.log("Operation result to install ownableValidator: ", result1.receipt.transactionHash);
  spinner.succeed(chalk.greenBright.bold.underline("Ownable Validator installed successfully"));

  const owners = (await publicClient.readContract({
    address: OwnableValidator,
    abi: OwnableValidatorAbi,
    functionName: 'getOwners',
    args: [account.address],
  })) as Address[]
   console.log("All Owners: ", owners);

  // Now that the smart session is installed and account has trusted attesters..

  // Note: Can keep fixed session owner
  const sessionOwner = privateKeyToAccount(generatePrivateKey())

  const session: Session = {
    sessionValidator: OwnableValidator,
    sessionValidatorInitData: encodeValidationData({
      threshold: 1,
      owners: [sessionOwner.address],
    }),
    salt: toHex(toBytes('0', { size: 32 })),
    userOpPolicies: [getSudoPolicy()],
    erc7739Policies: {
      allowedERC7739Content: [],
      erc1271Policies: [],
    },
    actions: [
      {
        actionTarget: counterContract, // an address as the target of the session execution
        actionTargetSelector: '0xf7210633' as Hex, // function selector to be used in the execution, in this case counters() // cast sig "counters()" to hex
        actionPolicies: [getSudoPolicy()],
      },
    ],
    chainId: BigInt(chain.id),
    permitERC4337Paymaster: true,
  }

  console.log("Session: ", session)

  const sessions: Session[] = [session]

  const preparePermissionData = encodeFunctionData({
    abi: enableingSessionsAbi,
    functionName: "enableSessions",
    args: [sessions]
  })

  console.log("Prepare Permission Data: ", preparePermissionData)

  const permissionId = getPermissionId({
    session
  })

  // return {
  //   action: {
  //     target: SMART_SESSIONS_ADDRESS,
  //     value: BigInt(0),
  //     callData: preparePermissionData
  //   },
  //   permissionIds: permissionIds,
  //   sessions
  // }

  const userOpHashEnableSession = await kernelClient.sendUserOperation({
    account: account,
    calls: [
      {
        to: SMART_SESSIONS_ADDRESS,
        value: BigInt(0),
        data: preparePermissionData,
      },
    ],
  });

  const receipt2 = await bundlerClient.waitForUserOperationReceipt({
    hash: userOpHashEnableSession,
  });
  console.log("User Operation hash to enable session: ", receipt2.receipt.transactionHash);
  spinner.succeed(chalk.greenBright.bold.underline("Session enabled successfully"));

//   const sessionDetails = await getEnableSessionDetails({
//     sessions: [session],
//     account: kernelAccountForModuleSdk,
//     clients: [publicClient as any],
//   })

   // WIP ...
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
