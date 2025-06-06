import "dotenv/config";
import ora from "ora";
import {
  http,
  type Address,
  type Hex,
  createPublicClient,
  encodeFunctionData,
  createWalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { soneiumMinato } from "viem/chains";
import { Counter as CounterAbi } from "../abi/Counter";
import { createSCSPaymasterClient, createSmartAccountClient, toStartaleSmartAccount } from "@startale-scs/aa-sdk";

import cliTable = require("cli-table3");
import chalk from "chalk";

const bundlerUrl = process.env.MINATO_BUNDLER_URL;
const paymasterUrl = process.env.PAYMASTER_SERVICE_URL;
const privateKey = process.env.OWNER_PRIVATE_KEY;
const counterContract = process.env.COUNTER_CONTRACT_ADDRESS as Address;
const implementationAddress = process.env.STARTALE_ACCOUNT_IMPLEMENTATION_ADDRESS as Address;

if (!bundlerUrl || !paymasterUrl || !privateKey) {
  throw new Error("BUNDLER_RPC or PAYMASTER_SERVICE_URL or PRIVATE_KEY is not set");
}

const chain = soneiumMinato;
const publicClient = createPublicClient({
  transport: http(),
  chain,
});

const scsPaymasterClient = createSCSPaymasterClient({
  transport: http(paymasterUrl) as any
});

const signer = privateKeyToAccount(privateKey as Hex);

// Note: It is advised to always use calculateGasLimits true.
// Grab the paymasterId from the paymaster dashboard.
const scsContext = { calculateGasLimits: true, paymasterId: "pm_kHAk7Lw9KQibScJKyueNxv" }

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

      const eoaAddress = signer.address;
      console.log("eoaAddress", eoaAddress); 

      const walletClient = createWalletClient({
        account: signer,
        chain,
        transport: http()
      })

      const authorization = await walletClient.signAuthorization({
        account: signer,
        chainId: 0,
        // nonce: 0,
        address: implementationAddress,
        contractAddress: implementationAddress,
      })

      console.log("authorization ", authorization)

      // We need to pass this object when initializing account 

      const smartAccountClient = createSmartAccountClient({
          account: await toStartaleSmartAccount({ 
               signer: signer, 
               chain: chain,
               transport: http(),
               accountAddress: eoaAddress, // smart acocunt address = eoa address
               // index: BigInt(213266682119) // no need
          }),
          transport: http(bundlerUrl),
          client: publicClient,
          paymaster: scsPaymasterClient,
          paymasterContext: scsContext,
      })

      // This is how you can get counterfactual address of the smart account even before it is deployed.
      // It is useful to pre-send some eth or erc20 tokens so that deployment txn could use those funds (depending on the paymaster)
      const address = smartAccountClient.account.address;
      console.log("address", address);

      // Todo: Deploy fresh counter address which is also available on Mainnet
      const counterStateBefore = (await publicClient.readContract({
        address: counterContract,
        abi: CounterAbi,
        functionName: "counters",
        args: [smartAccountClient.account.address],
      })) as bigint;

      // Construct call data
      const callData = encodeFunctionData({
        abi: CounterAbi,
        functionName: "count",
      });


    //   const hash = await smartAccountClient.sendUserOperation({ 
    //     calls: [
    //       {
    //         to: counterContract as Address,
    //         value: BigInt(0),
    //         data: callData,
    //       },
    //     ],
    //   }); 
    //   const receipt = await smartAccountClient.waitForUserOperationReceipt({ hash }); 
    //   console.log("receipt", receipt);
    } catch (error) {
      spinner.fail(chalk.red(`Error: ${(error as Error).message}`));  
    }
    process.exit(0);
}

main();