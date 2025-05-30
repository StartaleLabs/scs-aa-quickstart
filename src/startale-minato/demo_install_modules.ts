import "dotenv/config";
import ora from "ora";
import {
  http,
  type Address,
  type Hex,
  createPublicClient,
  encodeFunctionData
} from "viem";
import {
  type EntryPointVersion,
  createBundlerClient,
  entryPoint07Address
} from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { soneiumMinato } from "viem/chains";
import { Counter as CounterAbi } from "../abi/Counter";

import { createSCSPaymasterClient, createSmartAccountClient, toStartaleSmartAccount } from "@startale-scs/aa-sdk";

import type Table from "cli-table3";
const CliTable = require("cli-table3") as typeof Table;
import chalk from "chalk";
import { getSmartSessionsValidator, getSocialRecoveryValidator } from "@rhinestone/module-sdk";


const bundlerUrl = process.env.MINATO_BUNDLER_URL;
const paymasterUrl = process.env.PAYMASTER_SERVICE_URL;
const privateKey = process.env.OWNER_PRIVATE_KEY;
const counterContract = process.env.COUNTER_CONTRACT_ADDRESS as Address;

const guardian1Pk = process.env.SIGNER_1_PRIVATE_KEY;
const guardian2Pk = process.env.SIGNER_2_PRIVATE_KEY;

if (!bundlerUrl || !paymasterUrl || !privateKey) {
  throw new Error("BUNDLER_RPC or PAYMASTER_SERVICE_URL or PRIVATE_KEY is not set");
}

const chain = soneiumMinato;
const publicClient = createPublicClient({
  transport: http(),
  chain,
});

const bundlerClient = createBundlerClient({
  client: publicClient,
  transport: http(bundlerUrl),
});

const scsPaymasterClient = createSCSPaymasterClient({
  transport: http(paymasterUrl),
});

const signer = privateKeyToAccount(privateKey as Hex);

// Note: It is advised to always use calculateGasLimits true.
// Grab the paymasterId from the paymaster dashboard.
const scsContext = { calculateGasLimits: true, paymasterId: "pm_test_self_funded" }

const main = async () => {
    const spinner = ora({ spinner: "bouncingBar" });
  
    const tableConfig = {
      colWidths: [30, 60], // Requires fixed column widths
      wordWrap: true,
      wrapOnWordBoundary: false,
    };
  
    try {
      // spinner.start("Initializing smart account...");
      const tableBefore = new CliTable(tableConfig);

      const eoaAddress = signer.address;
      console.log("eoaAddress", eoaAddress); 

      const smartAccountClient = createSmartAccountClient({
          account: await toStartaleSmartAccount({ 
          signer: signer, 
          chain,
          transport: http(),
          index: BigInt(111787)
        }),
        transport: http(bundlerUrl) as any,
        client: publicClient as any,
        paymaster: scsPaymasterClient,
        paymasterContext: scsContext,
      })

      const address = smartAccountClient.account.address;
      console.log("address", address);

      // Todo: Deploy fresh counter address which is also available on Mainnet
      // Construct call data
      const callData = encodeFunctionData({
        abi: CounterAbi,
        functionName: "count",
      });

      const hash = await smartAccountClient.sendUserOperation({ 
        calls: [
          {
            to: counterContract as Address,
            value: BigInt(0),
            data: callData,
          },
        ],
      }); 
      const receipt = await smartAccountClient.waitForUserOperationReceipt({ hash }); 
      console.log("receipt tx hash", receipt.receipt.transactionHash);


      const guardian1 = privateKeyToAccount(
        guardian1Pk as Hex,
      ) // the key coresponding to the first guardian
       
      const guardian2 = privateKeyToAccount(
        guardian2Pk as Hex, 
      ) // the key coresponding to the second guardian
       
      const socialRecovery = getSocialRecoveryValidator({
         threshold: 2,
         guardians: [guardian1.address, guardian2.address],
      })

      console.log("socialRecovery", socialRecovery);

      const isAccountRecoveryModuleInstalled = await smartAccountClient.isModuleInstalled({
        module: socialRecovery
      })
      console.log("isAccountRecoveryModuleInstalled", isAccountRecoveryModuleInstalled);

      if(!isAccountRecoveryModuleInstalled) {

        const opHash = await smartAccountClient.installModule({
            module: socialRecovery
          })
    
          console.log("Operation hash: ", opHash);
    
          const result = await bundlerClient.waitForUserOperationReceipt({
            hash: opHash,
          })
          console.log("Operation result: ", result.receipt.transactionHash);
    
        spinner.succeed(chalk.greenBright.bold.underline("Account Recovery Module installed successfully"));

      } else {
        spinner.succeed(chalk.greenBright.bold.underline("Account Recovery Module already installed"));
      }

      // Smart Sessions Now..
      const smartSessions = getSmartSessionsValidator({})
      console.log("Smart Sessions: ", smartSessions);

      const isSmartSessionsModuleInstalled = await smartAccountClient.isModuleInstalled({
        module: smartSessions
      })
      console.log("Is Smart Sessions Module Installed: ", isSmartSessionsModuleInstalled);

      if(!isSmartSessionsModuleInstalled) {

        const opHash = await smartAccountClient.installModule({
            module: smartSessions
          })
    
          console.log("Operation hash: ", opHash);
    
          const result = await bundlerClient.waitForUserOperationReceipt({
            hash: opHash,
          })
          console.log("Operation result: ", result.receipt.transactionHash);
    
        spinner.succeed(chalk.greenBright.bold.underline("Smart Sessions Module installed successfully"));

      } else    {
        spinner.succeed(chalk.greenBright.bold.underline("Smart Sessions Module already installed"));
      }
      
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
 ** Multiple module installations
 ** Module uninstallation
 ** Unable to uninstall last validator
 ** Information around using the installed module. either extend the client or break the flow using separate nonce and prepareUserOperation -> sign -> send steps
 **/



