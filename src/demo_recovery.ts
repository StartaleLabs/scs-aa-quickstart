import "dotenv/config";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { createKernelAccount, createKernelAccountClient } from "@zerodev/sdk";
import { KERNEL_V3_2 } from "@zerodev/sdk/constants";

import ora from "ora";
import { erc7579Actions } from "permissionless/actions/erc7579";
import {
  http,
  type Address,
  type Hex,
  createPublicClient,
  encodeFunctionData,
  formatEther,
  rpcSchema,
  toFunctionSelector,
  toHex,
} from "viem";
import {
  type EntryPointVersion,
  type PaymasterClient,
  type PrepareUserOperationParameters,
  type PrepareUserOperationRequest,
  type UserOperation,
  createBundlerClient,
  createPaymasterClient,
  entryPoint07Address,
} from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { soneiumMinato } from "viem/chains";
import { Counter as CounterAbi } from "./abi/Counter";
import { RecoveryAction as RecoveryActionAbi } from "./abi/RecoveryAction";

import { SponsorshipPaymaster as PaymasterAbi } from "./abi/SponsorshipPaymaster";

import cliTable = require("cli-table3");
import { getSocialRecoveryValidator } from "@rhinestone/module-sdk";
import { createWeightedECDSAValidator } from "@zerodev/weighted-ecdsa-validator";
import chalk from "chalk";
import { createSmartAccountClient } from "permissionless";
import { toKernelSmartAccount } from "permissionless/accounts";

const bundler = process.env.BUNDLER_URL;
const paymaster = process.env.PAYMASTER_SERVICE_URL;
const counterContract = process.env.COUNTER_CONTRACT_ADDRESS as Address;
const ECDSAValidator = process.env.ECDSA_VALIDATOR_ADDRESS as Address;
const kernelFactory = process.env.KERNEL_FACTORY_ADDRESS as Address;
const kernelImplementation = process.env.KERNEL_IMPLEMENTATION_ADDRESS as Address;
const stakerFactory = process.env.STAKER_FACTORY_ADDRESS as Address;
const paymasterContract = process.env.PAYMASTER_CONTRACT_ADDRESS as Address;
const recoveryExecutorAddress = process.env.RECOVERY_ACTION_ADDRESS as Address;
const weightedECDSAValidator = process.env.WEIGHTED_VALIDATOR_ADDRESS as Address;
const privateKey = process.env.OWNER_PRIVATE_KEY;
const signer1PrivateKey = process.env.SIGNER_1_PRIVATE_KEY;
const signer2PrivateKey = process.env.SIGNER_2_PRIVATE_KEY;

if (!bundler || !paymaster || !privateKey) {
  throw new Error("BUNDLER_RPC or PAYMASTER_SERVICE_URL or PRIVATE_KEY is not set");
}

const chain = soneiumMinato;
const publicClient = createPublicClient({
  transport: http(),
  chain,
});

const paymasterClient = createPaymasterClient({
  transport: http(paymaster),
});
const bundlerClient = createBundlerClient({
  client: publicClient,
  transport: http(bundler),
  paymaster: paymasterClient,
  paymasterContext: { mode: "SPONSORED", calculateGasLimits: true, policyId: "some-policy-id" },
});


const oldSigner = privateKeyToAccount(signer1PrivateKey as Hex);
const guardian = privateKeyToAccount(signer2PrivateKey as Hex);
const newSigner = privateKeyToAccount(privateKey as Hex);
const recoveryExecutorFunction = "function doRecovery(address _validator, bytes calldata _data)";

const entryPoint = {
  address: entryPoint07Address as Address,
  version: "0.7" as EntryPointVersion,
};

const kernelVersion = KERNEL_V3_2;

const main = async () => {
  try {
    const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
      signer: oldSigner,
      entryPoint,
      kernelVersion,
      validatorAddress: ECDSAValidator as Address,
    });

    const guardianValidator = await signerToEcdsaValidator(publicClient, {
      signer: guardian,
      entryPoint,
      kernelVersion,
      validatorAddress: ECDSAValidator as Address,
    });

    // Create Kernel account
    // const account = await createKernelAccount(publicClient, {
    //   entryPoint,
    //   plugins: {
    //     sudo: ecdsaValidator,
    //     regular: guardianValidator,
    //     action: {
    //       address: recoveryExecutorAddress,
    //       selector: toFunctionSelector("doRecovery(address, bytes)"),
    //     },
    //   },
    //   kernelVersion,
    //   factoryAddress: kernelFactory,
    //   accountImplementationAddress: kernelImplementation,
    //   useMetaFactory: true,
    //   metaFactoryAddress: stakerFactory,
    //   index: BigInt(22),
    // });

    const kernelAccount = await toKernelSmartAccount({
      client: publicClient,
      entryPoint: {
        address: entryPoint07Address,
        version: "0.7",
      },
      owners: [oldSigner],
      factoryAddress: kernelFactory,
      accountLogicAddress: kernelImplementation,
      metaFactoryAddress: stakerFactory,
      validatorAddress: ECDSAValidator,
      index: BigInt(22),
      useMetaFactory: true,
    });

    const isAccountDeployed = await kernelAccount.isDeployed();

    console.log("Account deployed: ", isAccountDeployed);
    console.log("Account: ", kernelAccount);

    const smartAccountClient = createSmartAccountClient({
      account: kernelAccount,
      chain: soneiumMinato,
      bundlerTransport: http(bundler),
      paymaster: paymasterClient,
    }).extend(erc7579Actions());

    const callData = encodeFunctionData({
      abi: RecoveryActionAbi,
      functionName: "doRecovery",
      args: [ECDSAValidator, newSigner.address],
    });

    const socialRecovery = getSocialRecoveryValidator({
      threshold: 1,
      guardians: [guardian.address],
    });

    const opHash1 = await smartAccountClient.installModule(socialRecovery);

    console.log("Op hash: ", opHash1);

    const receipt1 = await bundlerClient.waitForUserOperationReceipt({
      hash: opHash1,
    });

    console.log("Receipt: ", receipt1);

    // // Construct call data
    // const callData = encodeFunctionData({
    //   abi: CounterAbi,
    //   functionName: "count",
    // });

    // Construct user operation from bundler
    // const userOperation = await bundlerClient.prepareUserOperation({
    //   account: account,
    //   calls: [
    //     {
    //       to: counterContract as Address,
    //       value: BigInt(0),
    //       data: callData,
    //     },
    //   ],
    // });
  } catch (error) {
    console.log("Error: ", error);
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