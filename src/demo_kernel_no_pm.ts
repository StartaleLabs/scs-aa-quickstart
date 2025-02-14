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
  createWalletClient,
  encodeFunctionData,
  formatEther,
  parseEther,
  toHex,
} from "viem";
import {
  type EntryPointVersion,
  createBundlerClient,
  entryPoint07Address,
} from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { soneiumMinato } from "viem/chains";
import { Counter as CounterAbi } from "./abi/Counter";
import { SponsorshipPaymaster as PaymasterAbi } from "./abi/SponsorshipPaymaster";

import cliTable = require("cli-table3");
import chalk from "chalk";

const bundler = process.env.BUNDLER_URL as string;
const privateKey = process.env.OWNER_PRIVATE_KEY;
const counterContract = process.env.COUNTER_CONTRACT_ADDRESS as Address;
const ECDSAValidator = process.env.ECDSA_VALIDATOR_ADDRESS;
const kernelFactory = process.env.KERNEL_FACTORY_ADDRESS as Address;
const kernelImplementation = process.env.KERNEL_IMPLEMENTATION_ADDRESS as Address;
const stakerFactory = process.env.STAKER_FACTORY_ADDRESS as Address;
const paymasterContract = process.env.PAYMASTER_CONTRACT_ADDRESS as Address;

const chain = soneiumMinato;

const publicClient = createPublicClient({
  transport: http(),
  chain,
});

const walletClient = createWalletClient({
  chain,
  transport: http(),
});
const bundlerClient = createBundlerClient({
  client: publicClient,
  transport: http(bundler),
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
      index: BigInt(15),
    });

    const accountBalanceBefore = (await publicClient.getBalance({
      address: account.address,
    })) as bigint;

    if (accountBalanceBefore < BigInt(2000000000000000)) {
      console.log("Account balance too low, sending funds");
      console.log("/n");
      const hash = await walletClient.sendTransaction({
        account: signer,
        to: account.address,
        value: parseEther("0.0020"),
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }

    const counterStateBefore = (await publicClient.readContract({
      address: counterContract,
      abi: CounterAbi,
      functionName: "counters",
      args: [account.address],
    })) as bigint;

    spinner.succeed(chalk.greenBright.bold.underline("Smart account initialized."));

    tableBefore.push(
      { "Bundler url": bundler.split("?")[0] },
      { "Paymaster contract address": paymasterContract },
      { "Entry Point address": entryPoint07Address },
      { "Smart account address": account.address },
      { "ECDSA validator address": ECDSAValidator },
      { "Counter state": counterStateBefore.toString() },
      { "Account balance": formatEther(accountBalanceBefore) },
    );
    console.log(tableBefore.toString());
    console.log("\n");

    spinner.start("Constructing user operation");
    // Construct call data
    const callData = encodeFunctionData({
      abi: CounterAbi,
      functionName: "count",
    });

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

    spinner.succeed(chalk.greenBright.bold.underline("User operation constructed"));

    spinner.start("Submitting user operation to bundler");

    const userOpHash = await bundlerClient.sendUserOperation({
      account,
      calls: [
        {
          to: counterContract as Address,
          value: BigInt(0),
          data: callData,
        },
      ],
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
