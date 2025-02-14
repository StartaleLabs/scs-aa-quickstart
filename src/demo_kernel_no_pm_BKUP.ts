import "dotenv/config";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { createKernelAccount } from "@zerodev/sdk";
import { KERNEL_V3_2 } from "@zerodev/sdk/constants";

import ora from "ora";
import { createSmartAccountClient } from "permissionless";
import { erc7579Actions } from "permissionless/actions/erc7579";

import {
  http,
  type Address,
  type Hex,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  rpcSchema,
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
import { Kernel as KernelAbi } from "./abi/Kernel";
import { SponsorshipPaymaster as PaymasterAbi } from "./abi/SponsorshipPaymaster";

import cliTable = require("cli-table3");
import { type ModuleType, getSocialRecoveryValidator } from "@rhinestone/module-sdk";
import chalk from "chalk";

const bundler = process.env.BUNDLER_URL;
const paymaster = process.env.PAYMASTER_SERVICE_URL;
const privateKey = process.env.OWNER_PRIVATE_KEY;
const counterContract = process.env.COUNTER_CONTRACT_ADDRESS as Address;
const ECDSAValidator = process.env.ECDSA_VALIDATOR_ADDRESS;
const kernelFactory = process.env.KERNEL_FACTORY_ADDRESS as Address;
const kernelImplementation = process.env.KERNEL_IMPLEMENTATION_ADDRESS as Address;
const stakerFactory = process.env.STAKER_FACTORY_ADDRESS as Address;
const paymasterContract = process.env.PAYMASTER_CONTRACT_ADDRESS as Address;

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

const signer = privateKeyToAccount(privateKey as Hex);
const bundlerClient = createBundlerClient({
  account: signer,
  client: publicClient,
  transport: http(bundler),
});

const paymasterClient = createPaymasterClient({
  transport: http(paymaster),
  rpcSchema: rpcSchema<PaymasterRpcSchema>(),
});

const entryPoint = {
  address: entryPoint07Address as Address,
  version: "0.7" as EntryPointVersion,
};

const kernelVersion = KERNEL_V3_2;

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
      address: "0xB4b57eAf829617a54595210DBc33597Fde61B344",
    });

    const smartAccountClient = createSmartAccountClient({
      account,
      chain: soneiumMinato,

      bundlerTransport: http("https://api.pimlico.io/v2/sepolia/rpc?apikey=API_KEY"),
    }).extend(erc7579Actions());

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
      { "Bundler url": bundler.split("?")[0] },
      { "Paymaster service url": paymaster.split("/").slice(0, 6).join("/") },
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

    spinner.start("Constructing user operation");
    // Construct call data
    const callData = encodeFunctionData({
      abi: CounterAbi,
      functionName: "count",
    });

    const signer2PrivateKey = process.env.SIGNER_2_PRIVATE_KEY;

    const guardian = privateKeyToAccount(signer2PrivateKey as Hex);

    const guardianValidator = await signerToEcdsaValidator(publicClient, {
      signer: guardian,
      entryPoint,
      kernelVersion,
      validatorAddress: ECDSAValidator as Address,
    });

    const socialRecovery = {
      address: "0x29c3e3268e36f14A4D1fEe97DD94EF2F60496a2D" as Address,
      module: "0x29c3e3268e36f14A4D1fEe97DD94EF2F60496a2D" as Address,
      initData: encodeAbiParameters(
        [
          { name: "owner", type: "address" },
          { name: "threshold", type: "uint256" },
          { name: "guardians", type: "address[]" },
        ],
        [signer.address, BigInt(1), [guardian.address]],
      ),
      deInitData: "0x",
      additionalContext: "0x",
      type: "validator" as ModuleType,
      hook: undefined,
    };

    const installModuleCallData = encodeFunctionData({
      abi: KernelAbi,
      functionName: "installModule",
      args: [BigInt(1), socialRecovery.module, socialRecovery.initData],
    });

    const userOperation = await bundlerClient.prepareUserOperation({
      account, // your Kernel account
      factory: undefined,
      factoryData: undefined,
      paymaster: undefined,
      paymasterData: undefined,
      paymasterPostOpGasLimit: undefined,
      paymasterVerificationGasLimit: undefined,
      calls: [
        {
          to: account.address, // sending the call to the kernel contract itself
          value: BigInt(0),
          data: installModuleCallData,
        },
      ],
    });

    // 3. Sign the user operation with the owner's key
    const userOpSignature = await account.signUserOperation(userOperation);
    const signedUserOp = {
      ...userOperation,
      signature: userOpSignature,
    };

    // (Optional) Log details before sending
    console.log("User Operation:", signedUserOp);
    console.log("Estimated Gas Cost:", formatEther(userOperation.maxFeePerGas));

    // const callData = encodeFunctionData({
    //   abi: KernelAbi,
    //   functionName: "installModule",
    //   args: [BigInt(1), socialRecovery.module, socialRecovery.initData],
    // });
    console.log(socialRecovery);
    console.log(ecdsaValidator.address);
    console.log(signer.address);
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

    // type PaymasterResponse = {
    //   paymaster: Hex;
    //   paymasterData: Hex;
    //   callGasLimit: Hex;
    //   verificationGasLimit: Hex;
    //   preVerificationGas: Hex;
    //   paymasterPostOpGasLimit: Hex;
    //   paymasterVerificationGasLimit: Hex;
    //   maxFeePerGas: Hex;
    //   maxPriorityFeePerGas: Hex;
    // };

    // const paymasterParams = {
    //   sender: userOperation.sender,
    //   nonce: userOperation.nonce,
    //   factory: factoryArgs.factory,
    //   factoryData: factoryArgs.factoryData,
    //   callData: userOperation.callData,
    //   callGasLimit: userOperation.callGasLimit,
    //   verificationGasLimit: userOperation.verificationGasLimit,
    //   preVerificationGas: userOperation.preVerificationGas,
    //   maxFeePerGas: userOperation.maxFeePerGas,
    //   maxPriorityFeePerGas: userOperation.maxPriorityFeePerGas,
    //   chainId: 1946,
    //   context: { mode: "SPONSORED", calculateGasLimits: true, policyId: "some-policy-id" },
    //   entryPointAddress: entryPoint07Address,
    // };

    // const paymasterResponse = (await paymasterClient.getPaymasterData(
    //   paymasterParams,
    // )) as any as PaymasterResponse;

    // const preSignatureUserOp = {
    //   callData: userOperation.callData,
    //   callGasLimit: BigInt(paymasterResponse.callGasLimit),
    //   factory: factoryArgs.factory,
    //   factoryData: factoryArgs.factoryData,
    //   maxFeePerGas: BigInt(paymasterResponse.maxFeePerGas),
    //   maxPriorityFeePerGas: BigInt(paymasterResponse.maxPriorityFeePerGas),
    //   nonce: userOperation.nonce,
    //   paymaster: paymasterContract,
    //   paymasterData: paymasterResponse.paymasterData,
    //   paymasterPostOpGasLimit: BigInt(paymasterResponse.paymasterPostOpGasLimit),
    //   paymasterVerificationGasLimit: BigInt(paymasterResponse.paymasterVerificationGasLimit),
    //   preVerificationGas: BigInt(paymasterResponse.preVerificationGas),
    //   sender: userOperation.sender,
    //   signature: "0x" as `0x${string}`,
    //   verificationGasLimit: BigInt(paymasterResponse.verificationGasLimit),
    // };

    // spinner.succeed(chalk.greenBright.bold.underline("User operation constructed"));

    // const userOpTable = new cliTable(tableConfig);

    // userOpTable.push(
    //   { Sender: userOperation.sender },
    //   { Nonce: userOperation.nonce },
    //   { "Call data": userOperation.callData },
    //   { "Max fee per gas": formatEther(BigInt(userOperation.maxFeePerGas)) },
    //   { "Max priority fee per gas": formatEther(BigInt(userOperation.maxPriorityFeePerGas)) },
    //   { "Dummy signature": userOperation.signature },
    //   { "Call gas limit": BigInt(preSignatureUserOp.callGasLimit) },
    //   { "Verification gas limit": BigInt(preSignatureUserOp.verificationGasLimit) },
    //   { "Pre verification gas": BigInt(preSignatureUserOp.preVerificationGas) },
    // );

    // console.log(userOpTable.toString());
    // console.log("\n");

    // spinner.start("Signing user operation");
    // const userOpSignature = await account.signUserOperation(userOperation
    // );

    // const signedUserOp = {
    //   ...preSignatureUserOp,
    //   signature: userOpSignature,
    // };

    // spinner.succeed(chalk.greenBright.bold.underline("User operation signed"));

    // const signatureTable = new cliTable(tableConfig);
    // signatureTable.push({ Signature: userOpSignature });
    // console.log(signatureTable.toString());
    // console.log("\n");

    // spinner.start("Submitting user operation to bundler");
    // const userOpHash = await bundlerClient.sendUserOperation({
    //   ...signedUserOp,
    //   entryPointAddress: entryPoint07Address,
    // });
    // const opHash1 = await smartAccountClient.installModule(socialRecovery);
    // const userOpHash = await bundlerClient.sendUserOperation({
    //   // [!code ++]
    //   account,
    //   calls: [
    //     {
    //       to: counterContract as Address,
    //       value: BigInt(0),
    //       data: callData,
    //     },
    //   ],
    // });

    // spinner.succeed(chalk.greenBright.bold.underline("User operation submitted"));
    // console.log("\n");
    // spinner.start("Waiting for user operation to be included in a block");
    // const includedResult = await bundlerClient.waitForUserOperationReceipt({
    //   hash: opHash1,
    // });
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
