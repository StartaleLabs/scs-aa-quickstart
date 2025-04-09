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
  pad,
  concatHex,
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
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { soneiumMinato } from "viem/chains";
import { Counter as CounterAbi } from "./abi/Counter";
import { SponsorshipPaymaster as PaymasterAbi } from "./abi/SponsorshipPaymaster";
import { erc7579Actions } from "permissionless/actions/erc7579";
import { type InstallModuleParameters } from "permissionless/actions/erc7579";

import cliTable = require("cli-table3");
import chalk from "chalk";
import { encodeSmartSessionSignature, encodeValidationData, encodeValidatorNonce, getAccount, getEnableSessionDetails, getOwnableValidator, getOwnableValidatorMockSignature, getOwnableValidatorOwners, getPermissionId, getSmartSessionsValidator, getSudoPolicy, getTrustAttestersAction, MOCK_ATTESTER_ADDRESS, OWNABLE_VALIDATOR_ADDRESS, RHINESTONE_ATTESTER_ADDRESS, Session, SMART_SESSIONS_ADDRESS, SmartSessionMode } from "@rhinestone/module-sdk";
import { OwnableValidatorAbi } from "./abi/OwnableValidator";
import { enableingSessionsAbi, enableSessionAbi, installSmartSessionsAbi } from "./abi/SmartSessionAbi";
import { getAccountNonce } from "@zerodev/sdk/actions";

const bundlerUrl = process.env.BUNDLER_URL;
const paymasterUrl = process.env.PAYMASTER_SERVICE_URL;
const privateKey = process.env.OWNER_PRIVATE_KEY;
const counterContract = process.env.COUNTER_CONTRACT_ADDRESS as Address;
const ECDSAValidator = process.env.ECDSA_VALIDATOR_ADDRESS;
const kernelFactory = process.env.KERNEL_FACTORY_ADDRESS as Address;
const UniActionPolicy = process.env.UNI_ACTION_POLICY_MODULE_ADDRESS as Address;
// const SmartSessionValidator = process.env.SMART_SESSIONS_MODULE_ADDRESS as Address;
// const OwnableValidator = process.env.OWNABLE_VALIDATOR_ADDRESS as Address;
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

const scsContext = { calculateGasLimits: false, policyId: "sudo" }

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
      index: BigInt(7777777777777777777777888999),
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

    // make this work with module-sdk addresses of smart session validator and ownable validator
    
    // Override our own addresses
    // smartSessions.address = SmartSessionValidator
    // smartSessions.module = SmartSessionValidator

    const isSmartSessionsModuleInstalled = await kernelClient.isModuleInstalled(smartSessions)
    console.log("Is Smart Sessions Module Installed: ", isSmartSessionsModuleInstalled);

    if(!isSmartSessionsModuleInstalled) {

    // Verify if registering a selector is needed with USE mode as well.  
    // Edit: Yes. It is needed. As we are using USE mode, we need to register the selector as well
    const context = encodePacked(
      ['address', 'bytes'],
      [
        zeroAddress,
        encodeAbiParameters(
          [{ type: 'bytes' }, { type: 'bytes' }, { type: 'bytes' }],
          [smartSessions.initData || '0x', '0x', "0xe9ae5c53"],
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

  // Trust attestors is not required when we use our custom addressses
  // SMART_SESSIONS_MODULE_ADDRESS=0x716BC27e1b904331C58891cC3AB13889127189a7
  // OWNABLE_VALIDATOR_ADDRESS=0x7C5F70297f194800D8cE49F87a6b29f8d88f38Ad

  // But is required when we use Rhinestone addresses in production

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
  // For rhinestone addresses it is already done.


  // Installing Ownable validator is not required.


  // Note: Can keep fixed session owner
  const sessionOwner = privateKeyToAccount(generatePrivateKey())

  const session: Session = {
    sessionValidator: OWNABLE_VALIDATOR_ADDRESS,
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
        actionTargetSelector: '0x06661abd' as Hex, // function selector to be used in the execution, in this case count() // cast sig "count()" to hex
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
        to: smartSessions.address,
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

  // Now let's use it.. with session key signature.


  console.log("account address: ", account.address);

  const nonceKey = encodeValidatorNonceKey({
    validator: SMART_SESSIONS_ADDRESS,
  })

  console.log("nonceKey: ", toHex(nonceKey));

  const nonce = await getAccountNonce(publicClient, {
    address: account.address,
    entryPointAddress: entryPoint07Address,
    key: nonceKey
  });

  console.log("Nonce Hex: ", toHex(nonce));

  const mockSig = getOwnableValidatorMockSignature({
    threshold: 1,
  });

  console.log("mockSig: ", mockSig);

  console.log("permissionId: ", permissionId);

  const dummySigEncoded = encodePacked(
    ['bytes1', 'bytes32', 'bytes'],
    [SmartSessionMode.USE, permissionId, mockSig],
  );

  const userOperation = await kernelClient.prepareUserOperation({
    account: account,
    calls: [
      {
        to: session.actions[0].actionTarget,
        value: BigInt(0),
        data: session.actions[0].actionTargetSelector,
      },
    ],
    // verificationGasLimit: BigInt(200000),
    // postOpGasLimit: BigInt(100000),
    // maxFeePerGas: BigInt(10000000),
    // callGasLimit: BigInt(10000000),
    // preVerificationGas: BigInt(100000000),
    // paymasterVerificationGasLimit: BigInt(200000),
    nonce,
    signature: dummySigEncoded,
  });

  console.log("User Operation: ", userOperation);

  const userOpHashToSign = getUserOperationHash({
    chainId: chain.id,
    entryPointAddress: entryPoint07Address,
    entryPointVersion: "0.7",
    userOperation,
  });

  console.log("User Operation hash to sign: ", userOpHashToSign);

  const sessionKeySignature = await sessionOwner.signMessage({
    message: { raw: userOpHashToSign },
  });

  console.log("Session Key Signature: ", sessionKeySignature);

  const userOpSignature = encodePacked(
    ['bytes1', 'bytes32', 'bytes'],
    [SmartSessionMode.USE, permissionId, sessionKeySignature],
  );

  console.log("User Operation Signature: ", userOpSignature);

  userOperation.signature = userOpSignature;

  const finalOpHash = await kernelClient.sendUserOperation(userOperation as any);

  const receiptFinal = await bundlerClient.waitForUserOperationReceipt({
    hash: finalOpHash,
  });

  console.log("User Operation hash to execute session: ", receiptFinal.receipt.transactionHash);
  spinner.succeed(chalk.greenBright.bold.underline("Session executed successfully"));


  const counterStateAfter = (await publicClient.readContract({
    address: counterContract,
    abi: CounterAbi,
    functionName: "counters",
    args: [account.address],
  })) as bigint;

  console.log("Counter state after session execution: ", counterStateAfter);

  tableBefore.push(
    { "Counter state after": counterStateAfter.toString() },
  );
  console.log(tableBefore.toString());
  console.log("\n");
  } catch (error) {
    spinner.fail(chalk.red(`Error: ${(error as Error).message}`));
  }
  process.exit(0);
};

export const encodeValidatorNonceKey = ({
  validator,
  nonceKey = 0, // Default 0 as in Solidity test
}: {
  validator: Hex; // 20-byte Ethereum address
  nonceKey?: number; // 16-bit nonce key
}) => {
  return BigInt(
    pad(
      encodePacked(
        ["bytes1", "bytes1", "address", "uint16"],
        ["0x00", "0x01", validator, nonceKey],
      ),
      {
        dir: "right",
        size: 24,
      },
    ),
  );

  // ValidationType constant VALIDATION_TYPE_VALIDATOR = ValidationType.wrap(0x01);
  // ValidationMode constant VALIDATION_MODE_DEFAULT = ValidationMode.wrap(0x00);

  // const validatorMode = "0x00";
  // const validationType = "0x01";

  // const encoding = pad(
  //   concatHex([
  //       pad(validatorMode, {size: 1}), // 1 byte
  //       pad(validationType, {size: 1}), // 1 byte
  //       pad(validator, {
  //           size: 20,
  //           dir: "right"
  //       }), // 20 bytes
  //       pad(
  //           toHex(BigInt(0)),
  //           {
  //               size: 2
  //           }
  //       ) // 2 byte
  //   ]),
  //   { size: 24 }
  // );
  // const encodedNonceKey = BigInt(encoding);
  // return encodedNonceKey;
}

function bigIntToHex(_: string, value: any) {
  if (typeof value === "bigint") {
    return toHex(value);
  }
  return value;
}
main();
