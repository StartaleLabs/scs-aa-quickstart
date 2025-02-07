import "dotenv/config";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { createKernelAccount } from "@zerodev/sdk";
import { KERNEL_V3_2 } from "@zerodev/sdk/constants";

import ora from "ora";
import {
  http,
  type Address,
  type Hex,
  createPublicClient,
  encodeFunctionData,
  formatEther,
  getContract,
  parseEther,
  rpcSchema,
  toHex,
  zeroAddress,
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
import { SponsorshipPaymaster as PaymasterAbi } from "./abi/SponsorshipPaymaster";

import cliTable = require("cli-table3");
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
    });

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
    const nonce = await account.getNonce({ key: BigInt(7) });

    // Construct user operation from bundler
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

    // Get paymaster paymasterAndData from paymaster service
    const paymasterResponse = await paymasterClient.request({
      method: "pm_getPaymasterAndData",
      params: [
        {
          sender: userOperation.sender,
          nonce: userOperation.nonce,
          initCode: "0x",
          callData: userOperation.callData,
          signature: userOperation.signature,
          callGasLimit: userOperation.callGasLimit,
          verificationGasLimit: userOperation.verificationGasLimit,
          preVerificationGas: userOperation.preVerificationGas,
        },
        { mode: "SPONSORED", calculateGasLimits: true },
      ],
    });

    const preSignatureUserOp = {
      sender: userOperation.sender,
      nonce: userOperation.nonce,
      callData: userOperation.callData,
      callGasLimit: paymasterResponse.callGasLimit,
      verificationGasLimit: paymasterResponse.verificationGasLimit,
      preVerificationGas: paymasterResponse.preVerificationGas,
      paymasterVerificationGasLimit: paymasterResponse.paymasterVerificationGasLimit,
      paymasterPostOpGasLimit: paymasterResponse.paymasterPostOpGasLimit,
      maxFeePerGas: paymasterResponse.maxFeePerGas,
      maxPriorityFeePerGas: paymasterResponse.maxPriorityFeePerGas,
      paymasterData: paymasterResponse.paymasterData as `0x${string}`,
      paymaster: paymasterContract as `0x${string}`,
      signature: "0x" as `0x${string}`,
    };

    spinner.succeed(chalk.greenBright.bold.underline("User operation constructed"));

    const userOpTable = new cliTable(tableConfig);

    userOpTable.push(
      { Sender: userOperation.sender },
      { Nonce: userOperation.nonce },
      { "Call data": userOperation.callData },
      { "Max fee per gas": formatEther(BigInt(userOperation.maxFeePerGas)) },
      { "Max priority fee per gas": formatEther(BigInt(userOperation.maxPriorityFeePerGas)) },
      { "Dummy signature": userOperation.signature },
      { "Call gas limit": BigInt(preSignatureUserOp.callGasLimit) },
      { "Verification gas limit": BigInt(preSignatureUserOp.verificationGasLimit) },
      { "Pre verification gas": BigInt(preSignatureUserOp.preVerificationGas) },
    );

    console.log(userOpTable.toString());
    console.log("\n");

    spinner.start("Signing user operation");
    const userOpSignature = await account.signUserOperation(preSignatureUserOp);

    const signedUserOp = {
      ...preSignatureUserOp,
      signature: userOpSignature,
    };

    spinner.succeed(chalk.greenBright.bold.underline("User operation signed"));

    const signatureTable = new cliTable(tableConfig);
    signatureTable.push({ Signature: userOpSignature });
    console.log(signatureTable.toString());
    console.log("\n");

    spinner.start("Submitting user operation to bundler");
    const userOpHash = await bundlerClient.sendUserOperation({
      ...signedUserOp,
      entryPointAddress: entryPoint07Address,
    });

    spinner.succeed(chalk.greenBright.bold.underline("User operation submitted"));
    console.log("\n");
    spinner.start("Waiting for user operation to be included in a block");
    const includedResult = await bundlerClient.waitForUserOperationReceipt({
      hash: userOpHash,
    });
    spinner.succeed(chalk.greenBright.bold.underline("User operation included"));
    console.log("\n");
    spinner.start("Fetching post operation data");
    const accountBalanceAfter = (await publicClient.getBalance({
      address: account.address,
    })) as bigint;

    const counterStateAfter = (await publicClient.readContract({
      address: counterContract,
      abi: CounterAbi,
      functionName: "counters",
      args: [account.address],
    })) as bigint;

    const paymasterDepositAfter = (await publicClient.readContract({
      address: paymasterContract,
      abi: PaymasterAbi,
      functionName: "getDeposit",
      args: [],
    })) as bigint;

    spinner.succeed(chalk.greenBright.bold.underline("Post operation data fetched"));
    const tableAfter = new cliTable(tableConfig);

    tableAfter.push(
      { "Gas cost: ": formatEther(includedResult.actualGasCost) },
      { "User operation hash": includedResult.receipt.transactionHash },
    );

    const diffTable = new cliTable({
      ...tableConfig,
      colWidths: [30, 25, 25, 25],
      head: ["", "Before", "After", "Diff"],
    });

    diffTable.push(
      {
        "Counter state": [
          counterStateBefore.toString(),
          counterStateAfter.toString(),
          (counterStateAfter - counterStateBefore).toString(),
        ],
      },
      {
        "Account balance": [
          formatEther(accountBalanceBefore),
          formatEther(accountBalanceAfter),
          formatEther(accountBalanceBefore - accountBalanceAfter),
        ],
      },
      {
        "Paymaster deposit": [
          formatEther(paymasterDepositBefore),
          formatEther(paymasterDepositAfter),
          formatEther(paymasterDepositBefore - paymasterDepositAfter),
        ],
      },
    );

    console.log(tableAfter.toString());
    console.log("\n");
    console.log(diffTable.toString());
    console.log("\n");
    console.log(
      "Block explorer link: ",
      chalk.blue.underline(
        `https://explorer-testnet.soneium.org/tx/${includedResult.receipt.transactionHash}`,
      ),
    );
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