import "dotenv/config";
import ora from "ora";
import {
  http,
  type Address,
  type Hex,
  createPublicClient,
  encodeFunctionData
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

if (!bundlerUrl || !paymasterUrl || !privateKey) {
  throw new Error("BUNDLER_RPC or PAYMASTER_SERVICE_URL or PRIVATE_KEY is not set");
}

const chain = soneiumMinato;
const publicClient = createPublicClient({
  transport: http(),
  chain,
});

const scsPaymasterClient = createSCSPaymasterClient({
  transport: http(paymasterUrl),
});

const signer = privateKeyToAccount(privateKey as Hex);

// Note: It is advised to always use calculateGasLimits true.

// Grab the paymasterId from the paymaster dashboard.
const scsContext = { calculateGasLimits: true, paymasterId: "pm_test_managed" }

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

      const smartAccountClient = createSmartAccountClient({
          account: await toStartaleSmartAccount({ 
          signer: signer, 
          chain,
          transport: http(),
          index: BigInt(106910)
        }),
        transport: http(bundlerUrl),
        client: publicClient,
        paymaster: scsPaymasterClient,
        paymasterContext: scsContext,
      })

      const address = smartAccountClient.account.address;
      console.log("address", address);

      const counterStateBefore = (await publicClient.readContract({
        address: counterContract,
        abi: CounterAbi,
        functionName: "counters",
        args: [smartAccountClient.account.address],
      })) as bigint;

      console.log("counterStateBefore", counterStateBefore);

      // Construct call data
      const callData = encodeFunctionData({
        abi: CounterAbi,
        functionName: "count",
      });

      // Note: please note to use this only for a deployed smart account.

      const myNonce1 = await smartAccountClient.account.getNonce({
        key: 100n // can be any random number. this is your nonceSpace or batchId
      })

      console.log("myNonce1", myNonce1);

      const myNonce2 = await smartAccountClient.account.getNonce({
        key: 200n // can be any random number. this is your nonceSpace or batchId
        // One can also keep increasing batchId sequentially for example 1,2,3,...
      })

      console.log("myNonce2", myNonce2);

      // You can send them in any randomised order since both will follow different nonce "space" realm.

      const hash1 = await smartAccountClient.sendUserOperation({ 
        calls: [
          {
            to: counterContract as Address,
            value: BigInt(0),
            data: callData,
            },
          ],
          nonce: myNonce1
        })
        
        
      const hash2 = await smartAccountClient.sendUserOperation({ 
          calls: [
            {
              to: counterContract as Address,
              value: BigInt(0),
              data: callData,
            },
          ],
          nonce: myNonce2
        })

      const receipt1 = await smartAccountClient.waitForUserOperationReceipt({ hash: hash1 }); 
      console.log("receipt1", receipt1);

      const receipt2 = await smartAccountClient.waitForUserOperationReceipt({ hash: hash2 }); 
      console.log("receipt2", receipt2);

      const counterStateAfter = (await publicClient.readContract({
        address: counterContract,
        abi: CounterAbi,
        functionName: "counters",
        args: [smartAccountClient.account.address],
      })) as bigint;

      console.log("counterStateAfter", counterStateAfter);
    } catch (error) {
      spinner.fail(chalk.red(`Error: ${(error as Error).message}`));  
    }
    process.exit(0);
}

main();


/******************************Potential Errors**********************************************
 ** 
 **
 **/


 /******************************QA test scenarios**********************************************
 ** 
 **
 **/