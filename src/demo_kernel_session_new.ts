import "dotenv/config";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { toECDSASigner, toSignerId } from "@zerodev/permissions/signers";
import { KernelV3AccountAbi, addressToEmptyAccount, createKernelAccount, createKernelAccountClient } from "@zerodev/sdk";
import { KERNEL_V3_2 } from "@zerodev/sdk/constants";
import ora from "ora";
import {
  http,
  type Address,
  type Client,
  type Hex,
  concat,
  concatHex,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  keccak256,
  parseEther,
  slice,
  toHex,
  zeroAddress,
  rpcSchema,
} from "viem";
import {
  type EntryPointVersion,
  type UserOperation,
  type GetPaymasterDataParameters,
  createBundlerClient,
  createPaymasterClient,
  entryPoint07Address,
  getUserOperationHash,
  PrepareUserOperationRequest,
} from "viem/account-abstraction";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { soneiumMinato } from "viem/chains";
import { Counter as CounterAbi } from "./abi/Counter";
import { SponsorshipPaymaster as PaymasterAbi } from "./abi/SponsorshipPaymaster";

import cliTable = require("cli-table3");
import {
  type PermissionData,
  type PermissionPlugin,
  type PermissionPluginParams,
  type Policy,
  deserializePermissionAccount,
  serializePermissionAccount,
  toPermissionValidator,
} from "@zerodev/permissions";
import { type SudoPolicyParams, toPolicyId } from "@zerodev/permissions/policies";
import chalk from "chalk";
import { getChainId, readContract } from "viem/actions";
import { getAction } from "viem/utils";
import { erc7579Actions } from "permissionless/actions/erc7579";

const bundler = process.env.BUNDLER_URL as string;
const paymasterUrl = process.env.PAYMASTER_SERVICE_URL as string;
const privateKey = process.env.OWNER_PRIVATE_KEY;
const counterContract = process.env.COUNTER_CONTRACT_ADDRESS as Address;
const ECDSAValidator = process.env.ECDSA_VALIDATOR_ADDRESS;
const kernelFactory = process.env.KERNEL_FACTORY_ADDRESS as Address;
const kernelImplementation = process.env.KERNEL_IMPLEMENTATION_ADDRESS as Address;
const stakerFactory = process.env.STAKER_FACTORY_ADDRESS as Address;
const paymasterContract = process.env.PAYMASTER_CONTRACT_ADDRESS as Address;
const sessionPrivateKey = process.env.SIGNER_1_PRIVATE_KEY as `0x${string}`;
const chain = soneiumMinato;

const SUDO_POLICY_CONTRACT = "0x07342b9A690E68da55E62126231692260F3D1b6e";

enum PolicyFlags {
  FOR_ALL_VALIDATION = "0x0000",
  NOT_FOR_VALIDATE_USEROP = "0x0001",
  NOT_FOR_VALIDATE_SIG = "0x0002",
}

function toSudoPolicy({
  policyAddress = SUDO_POLICY_CONTRACT,
  policyFlag = PolicyFlags.FOR_ALL_VALIDATION,
}: SudoPolicyParams): Policy {
  return {
    getPolicyData: () => {
      return "0x";
    },
    getPolicyInfoInBytes: () => {
      return concatHex([policyFlag, policyAddress]);
    },
    policyParams: {
      type: "sudo",
      policyAddress,
      policyFlag,
    } as SudoPolicyParams & { type: "sudo" },
  };
}

const sudoPolicy = toSudoPolicy({});

const publicClient = createPublicClient({
  transport: http(),
  chain,
});

const paymasterClient = createPaymasterClient({
  transport: http(paymasterUrl),
  rpcSchema: rpcSchema<PaymasterRpcSchema>(),
});

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

const scsContext = { mode: "SPONSORED", calculateGasLimits: true, policyId: "some-policy-id" }

const signer = privateKeyToAccount(privateKey as Hex);

const entryPoint = {
  address: entryPoint07Address as Address,
  version: "0.7" as EntryPointVersion,
};

const kernelVersion = KERNEL_V3_2;

const main = async () => {
  const spinner = ora({ spinner: "bouncingBar" });

  try {
    const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
      signer,
      entryPoint,
      kernelVersion,
      validatorAddress: ECDSAValidator as Address,
    });

    const sessionKeySigner = await toECDSASigner({
      signer: privateKeyToAccount(sessionPrivateKey),
    });

    const sessionKeyAddress = sessionKeySigner.account.address;

    const emptyAccount = addressToEmptyAccount(sessionKeyAddress);
    const emptySessionKeySigner = await toECDSASigner({ signer: emptyAccount });

    const permissionPlugin = await toPermissionValidator(publicClient, {
      entryPoint,
      kernelVersion,
      signer: emptySessionKeySigner,
      policies: [sudoPolicy],
    });

    console.log("Permissions Plugin: ", permissionPlugin);

    // Create Kernel account
    const sessionKeyAccount = await createKernelAccount(publicClient, {
      entryPoint,
      kernelVersion,
      plugins: {
        sudo: ecdsaValidator,
        regular: permissionPlugin,
      },
      factoryAddress: kernelFactory,
      accountImplementationAddress: kernelImplementation,
      useMetaFactory: true,
      metaFactoryAddress: stakerFactory,
    });

    console.log(sessionKeyAccount);

    const approval = await serializePermissionAccount(sessionKeyAccount as any);
    console.log("aproval ", approval);

    const sessionKeyApprovedAccount = await deserializePermissionAccount(
      publicClient,
      entryPoint,
      kernelVersion,
      approval,
      sessionKeySigner,
    );

    const uint8Array = base64ToBytes(approval);
    const jsonString = new TextDecoder().decode(uint8Array);
    const deserialised = JSON.parse(jsonString);

    console.log("\n");
    console.log("Deserialised approval: ", deserialised);

    const callData = encodeFunctionData({
      abi: CounterAbi,
      functionName: "count",
    });

    const kernelClient = createKernelAccountClient({
      account: sessionKeyApprovedAccount,
      chain: soneiumMinato,
      bundlerTransport: http(bundler),
      client: publicClient,
      paymaster: {
        async getPaymasterData(pmDataParams: GetPaymasterDataParameters 
        ) {
          console.log("Called getPaymasterData: ", pmDataParams);
          const paymasterResponse = await paymasterClient.getPaymasterData(pmDataParams);
          return paymasterResponse;
        },
        async getPaymasterStubData(pmStubDataParams: GetPaymasterDataParameters) {
          console.log("Called getPaymasterStubData: ", pmStubDataParams);
          const paymasterStubResponse = await paymasterClient.getPaymasterStubData(pmStubDataParams);
          return paymasterStubResponse;
          // return {
          //   ...paymasterStubResponse,
          //   paymasterAndData: undefined,
          //   paymaster: paymasterContract,
          //   paymasterData: paymasterStubResponse.paymasterData || "0x",
          //   paymasterVerificationGasLimit: paymasterStubResponse.paymasterVerificationGasLimit || BigInt(200000),
          //   paymasterPostOpGasLimit: paymasterStubResponse.paymasterPostOpGasLimit || BigInt(100000),
          // };
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

function base64ToBytes(base64: string) {
  const binString = atob(base64);
  return Uint8Array.from(binString, (m) => m.codePointAt(0) as number);
}
