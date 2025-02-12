import "dotenv/config";
import {
  encodeValidatorNonce,
  getAccount,
  getOwnableValidator,
  getSetOwnableValidatorThresholdAction,
  getSocialRecoveryMockSignature,
  getSocialRecoveryValidator,
} from "@rhinestone/module-sdk";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { createKernelAccount, createKernelAccountClient } from "@zerodev/sdk";
import { KERNEL_V3_2 } from "@zerodev/sdk/constants";
import { createWeightedECDSAValidator } from "@zerodev/weighted-ecdsa-validator";
import ora from "ora";
import { toKernelSmartAccount } from "permissionless/accounts";
import {
  http,
  type Address,
  type Hex,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  rpcSchema,
  toFunctionSelector,
  toHex,
} from "viem";
import {
  type EntryPointVersion,
  type PrepareUserOperationRequest,
  createBundlerClient,
  createPaymasterClient,
  entryPoint07Address,
} from "viem/account-abstraction";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { soneiumMinato } from "viem/chains";
import { Counter as CounterAbi } from "./abi/Counter";
import { RecoveryAction as RecoveryActionAbi } from "./abi/RecoveryAction";
import { SponsorshipPaymaster as PaymasterAbi } from "./abi/SponsorshipPaymaster";
import cliTable = require("cli-table3");
import chalk from "chalk";

const bundler = process.env.BUNDLER_URL;
const paymaster = process.env.PAYMASTER_SERVICE_URL;
const privateKey = process.env.OWNER_PRIVATE_KEY as Hex;
const counterContract = process.env.COUNTER_CONTRACT_ADDRESS as Address;
const ECDSAValidator = process.env.ECDSA_VALIDATOR_ADDRESS as Address;
const weightedValidator = process.env.WEIGHTED_VALIDATOR_ADDRESS as Address;
const kernelFactory = process.env.KERNEL_FACTORY_ADDRESS as Address;
const kernelImplementation = process.env.KERNEL_IMPLEMENTATION_ADDRESS as Address;
const stakerFactory = process.env.STAKER_FACTORY_ADDRESS as Address;
const paymasterContract = process.env.PAYMASTER_CONTRACT_ADDRESS as Address;
const signer1PrivateKey = process.env.SIGNER_1_PRIVATE_KEY as Hex;
const signer2PrivateKey = process.env.SIGNER_2_PRIVATE_KEY as Hex;
const recoveryActionAddress = process.env.RECOVERY_ACTION_ADDRESS as Address;

if (!bundler || !paymaster || !privateKey) {
  throw new Error("BUNDLER_RPC or PAYMASTER_SERVICE_URL or PRIVATE_KEY is not set");
}

type PaymasterRpcSchema = [
  {
    Method: "pm_getPaymasterAndData";
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
  transport: http(bundler),
});

const paymasterClient = createPaymasterClient({
  transport: http(paymaster),
  rpcSchema: rpcSchema<PaymasterRpcSchema>(),
});

const signer = privateKeyToAccount(privateKey as Hex);

const entryPoint = {
  address: entryPoint07Address as Address,
  version: "0.7" as EntryPointVersion,
};

const kernelVersion = KERNEL_V3_2;

const main = async () => {
  const oldSigner = privateKeyToAccount(signer1PrivateKey);
  const newSigner = privateKeyToAccount(privateKey);
  const guardian = privateKeyToAccount(signer2PrivateKey);

  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer: oldSigner,
    entryPoint,
    kernelVersion: KERNEL_V3_2,
    validatorAddress: ECDSAValidator,
  });

  const ecdsaValidator2 = await signerToEcdsaValidator(publicClient, {
    signer: newSigner,
    entryPoint,
    kernelVersion: KERNEL_V3_2,
    validatorAddress: ECDSAValidator,
  });

  const guardianValidator = await createWeightedECDSAValidator(publicClient, {
    entryPoint,
    kernelVersion: KERNEL_V3_2,
    config: {
      threshold: 100,
      signers: [{ address: guardian.address, weight: 100 }],
    },
    signers: [guardian],
    validatorAddress: weightedValidator,
  });

  const recoveryExecutorFunction = "function doRecovery(address _validator, bytes calldata _data)";
  const recoveryExecutorSelector = toFunctionSelector(recoveryExecutorFunction);

  const account = await createKernelAccount(publicClient, {
    plugins: {
      sudo: ecdsaValidator,
      regular: ecdsaValidator2,
      action: {
        address: recoveryActionAddress,
        selector: recoveryExecutorSelector,
      },
    },
    kernelVersion,
    entryPoint,
    factoryAddress: kernelFactory,
    accountImplementationAddress: kernelImplementation,
    useMetaFactory: true,
    metaFactoryAddress: stakerFactory,
    index: BigInt(12),
  });

  console.log("Account address:", account.address);

  // Construct the recovery call data
  const callData = encodeFunctionData({
    abi: RecoveryActionAbi,
    functionName: "doRecovery",
    args: [ECDSAValidator, newSigner.address],
  });

  const userOperation = await bundlerClient.prepareUserOperation({
    account: account,
    calls: [
      {
        to: counterContract as Address,
        value: BigInt(0),
        data: callData,
      },
    ],
  });
};

main();
