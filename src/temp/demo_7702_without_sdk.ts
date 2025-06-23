import "dotenv/config";
import ora from "ora";
import {
  http,
  type Address,
  type Hex,
  createPublicClient,
  encodeFunctionData,
  createWalletClient,
  parseGwei,
  SignedAuthorizationList,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { soneiumMinato } from "viem/chains";
import { Counter as CounterAbi } from "../abi/Counter";
import { createSCSPaymasterClient, createSmartAccountClient, toStartaleSmartAccount } from "@startale-scs/aa-sdk";

import cliTable = require("cli-table3");
import chalk from "chalk";
import { verifyAuthorization } from "viem/utils";
import { entryPoint07Address, getUserOperationHash } from "viem/account-abstraction";
import { factory } from "typescript";

const bundlerUrl = process.env.MINATO_BUNDLER_URL;
const paymasterUrl = process.env.PAYMASTER_SERVICE_URL;
const privateKey = process.env.OWNER_PRIVATE_KEY;
const counterContract = process.env.COUNTER_CONTRACT_ADDRESS as Address;
const implementationAddress = process.env.STARTALE_ACCOUNT_IMPLEMENTATION_ADDRESS as Address;
const paymasterId = process.env.PAYMASTER_ID;

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
const scsContext = { calculateGasLimits: true, paymasterId: paymasterId }


export const getAuthorizationListFromDirectAuths = (
  authorizations: any[]
): SignedAuthorizationList | undefined => {
  const authList = authorizations
    .map((auth) => {
      if (!auth) return null

      const address =
        "address" in auth && auth.address
          ? auth.address
          : auth.contractAddress

      if (!address) return null

      return {
        address,
        chainId: auth.chainId,
        nonce: auth.nonce,
        r: auth.r,
        s: auth.s,
        v: auth.v,
        yParity: auth.yParity
      }
    })
    .filter(Boolean) as SignedAuthorizationList

  return authList.length ? authList : undefined
}

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
        // account: signer,
        /**
        * Whether the EIP-7702 Transaction will be executed by the EOA (signing this Authorization) or another Account.
        *
        * By default, it will be assumed that the EIP-7702 Transaction will
        * be executed by another Account.
        */
        // executor: 'self',
        // chainId is optiona. can set to specific network or 0
        //chainId: 0, // If single authorization signature needs to be valid across all supported-7702 chains
        // Review: /** Nonce of the EOA to delegate to. */
        // sending authorization (type4 tx) will also increase the nonce by 1 if execute = self. so it must be current nonce + 1. luckily we have helper arg above.
        // nonce: await publicClient.getTransactionCount({
        //   address: eoaAddress,
        // }),
        // address: implementationAddress,
        contractAddress: implementationAddress,
      })

      console.log("authorization ", authorization)

      const verified = await verifyAuthorization({
        authorization: authorization,
        address: eoaAddress 
      })
      console.log("verified ", verified)

      const multipleAuths = []
      multipleAuths.push(authorization)

      const authList = getAuthorizationListFromDirectAuths(multipleAuths)
      console.log(authList)


      // Send the 7702 authorization transaction
      // spinner.text = "Sending 7702 authorization transaction...";

      // EOA itself submitting authorization for self.
      // const txHash = await walletClient.sendTransaction({
      //   type: 'eip7702',
      //   chainId: chain.id,
      //   nonce: await publicClient.getTransactionCount({ address: eoaAddress }),
      //   // uptional overrides

      //   // maxFeePerGas: parseGwei('50'),
      //   // maxPriorityFeePerGas: parseGwei('1.5'),
      //   // gas: 200_000n,

      //   // can be any txn. even to the self for the methods with onlyEntryPointOrSelf modifiers
      //   to: '0x2cf491602ad22944D9047282aBC00D3e52F56B37',
      //   value: 0n,
      //   data: '0x',
      //   // is a must. this is manual authorization. later we can request 4337 call to the bundler by passing authorization
      //   authorizationList: authList
      // });

      // console.log("txHash ", txHash)
      
      // Otherwise We need to pass this authorization object when initializing account 
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
          // paymaster: scsPaymasterClient,
          // paymasterContext: scsContext,
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

      let preparedOp = await smartAccountClient.prepareUserOperation({
        calls: [
          {
            to: counterContract as Address,
            value: BigInt(0),
            data: callData,
          }
        ],
        initCode: "0x",
        // authorization: authorization,
      })

      console.log("preparedOp", preparedOp);

      

      let finalUserOp = {
        sender: preparedOp.sender as `0x${string}`, // Ensure valid hex string
        nonce: preparedOp.nonce!, // Convert nonce to BigInt
        callData: preparedOp.callData as `0x${string}`, // Ensure valid hex string
        callGasLimit: BigInt(preparedOp.callGasLimit!), // Convert to BigInt
        verificationGasLimit: BigInt(preparedOp.verificationGasLimit!),
        preVerificationGas: 86968n, //BigInt(preparedOp.preVerificationGas!),
        paymasterVerificationGasLimit: undefined,// BigInt(preparedOp.paymasterVerificationGasLimit!),
        paymasterPostOpGasLimit: undefined,// BigInt(preparedOp.paymasterPostOpGasLimit!),
        maxFeePerGas: 1000502n,
        maxPriorityFeePerGas: 1005000n,
        // paymasterData: (preparedOp.paymasterData as `0x${string}`) || "0x", // Ensure valid hex
        // paymaster: (preparedOp.paymaster as `0x${string}`) || "0x", // Ensure valid hex
        signature: "0x" as `0x${string}`, // Ensure 0x-prefixed signature
      };

      console.log("finalUserOp", finalUserOp);
      

    // Step 3️⃣: **Sign the UserOperation**
    console.log("✍️ Signing UserOperation...");
    const signedUserOp = await smartAccountClient.account.signUserOperation(finalUserOp);

    console.log("✅ Signed UserOperation:", signedUserOp);

    finalUserOp = {...finalUserOp, signature: signedUserOp as `0x${string}`}

    const nonceHex = `0x${BigInt(finalUserOp.nonce).toString(16)}`;
    console.log("nonceHex", nonceHex);


    
    const finalUserOpHex = {
        ...finalUserOp,
        nonce: nonceHex,
        maxFeePerGas: `0x${BigInt(finalUserOp.maxFeePerGas).toString(16)}`,
        maxPriorityFeePerGas: `0x${BigInt(finalUserOp.maxPriorityFeePerGas).toString(16)}`,
        callGasLimit: `0x${BigInt(finalUserOp.callGasLimit).toString(16)}`,
        verificationGasLimit: `0x${BigInt(finalUserOp.verificationGasLimit).toString(16)}`,
        preVerificationGas: `0x${BigInt(finalUserOp.preVerificationGas).toString(16)}`,
        // paymasterVerificationGasLimit: `0x${BigInt(finalUserOp.paymasterVerificationGasLimit).toString(16)}`,
        // paymasterPostOpGasLimit: `0x${BigInt(finalUserOp.paymasterPostOpGasLimit).toString(16)}`,
        // eip7702Auth: {
        //   chainId: toHex(authorization.chainId!),
        //   nonce: toHex(authorization.nonce!),
        //   address: authorization.address as Hex,
        //   r: authorization.r as Hex,
        //   s: authorization.s as Hex,
        //   yParity: toHex(authorization.yParity!)
        // }
    };

    console.log(`eth_sendUserOperation : ${JSON.stringify(finalUserOpHex)}`);

    // Step 4️⃣: **Send the signed UserOperation**
    console.log("🚀 Sending UserOperation...");

    const userOpHash = await fetch(bundlerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_sendUserOperation",
            params: [finalUserOpHex, entryPoint07Address],
        }),
    }).then(res => res.json());

    if (userOpHash.error) {
        console.error("❌ Error sending UserOperation:", userOpHash.error);
        return;
    }

    console.log("✅ UserOperation sent! Hash:", userOpHash);
    } catch (error) {
      spinner.fail(chalk.red(`Error: ${(error as Error).message}`));  
    }
    process.exit(0);
}

main();
