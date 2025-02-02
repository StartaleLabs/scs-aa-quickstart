import { config } from "dotenv";
import { toSimpleSmartAccount } from "permissionless/accounts";
import { http, type Address, type Hex, createPublicClient, formatEther, parseEther } from "viem";
import { createBundlerClient } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { soneiumMinato } from "viem/chains";

import { Counter as CounterAbi } from "./abi/Counter";
import { SponsorshipPaymaster as PaymasterAbi } from "./abi/SponsorshipPaymaster";

config();

const BUNDLER_URL = process.env.BUNDLER_URL as string;
const PAYMASTER_SERVICE_URL = process.env.PAYMASTER_SERVICE_URL as string;

const ENTRY_POINT_ADDRESS = process.env.ENTRY_POINT_ADDRESS as Address;
const SIMPLE_ACCOUNT_FACTORY_ADDRESS = process.env.SIMPLE_ACCOUNT_FACTORY_ADDRESS as Address;
const COUNTER_CONTRACT_ADDRESS = process.env.COUNTER_CONTRACT_ADDRESS as Address;
const PAYMASTER_CONTRACT_ADDRESS = process.env.PAYMASTER_CONTRACT_ADDRESS as Address;
const OWNER_PRIVATE_KEY = process.env.OWNER_PRIVATE_KEY as Hex;

async function main() {
  const ownerAccount = privateKeyToAccount(OWNER_PRIVATE_KEY);
  const publicClient = createPublicClient({
    chain: soneiumMinato,
    transport: http(),
  });

  const bundlerClient = createBundlerClient({
    client: publicClient,
    transport: http(BUNDLER_URL),
  });

  const simpleAccount = await toSimpleSmartAccount({
    client: publicClient,
    owner: ownerAccount,
    factoryAddress: SIMPLE_ACCOUNT_FACTORY_ADDRESS,
    entryPoint: {
      address: ENTRY_POINT_ADDRESS,
      version: "0.7",
    },
  });

  const accountBalanceBefore = (await publicClient.getBalance({
    address: simpleAccount.address,
  })) as bigint;

  const counterStateBefore = (await publicClient.readContract({
    address: COUNTER_CONTRACT_ADDRESS,
    abi: CounterAbi,
    functionName: "counters",
    args: [simpleAccount.address],
  })) as bigint;

  const paymasterDepositBefore = (await publicClient.readContract({
    address: PAYMASTER_CONTRACT_ADDRESS,
    abi: PaymasterAbi,
    functionName: "getDeposit",
    args: [],
  })) as bigint;

  console.log("Counter state before", counterStateBefore.toString());
  console.log("Account balance before", formatEther(accountBalanceBefore));
  console.log("Paymaster deposit before", formatEther(paymasterDepositBefore));

  // Calldata
  const callData =
    "0xb61d27f60000000000000000000000006bcf154a6b80fde9bd1556d39c9bcbb19b539bd800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000406661abd00000000000000000000000000000000000000000000000000000000" as `0x${string}`;
  const nonce = await simpleAccount.getNonce();

  // Constructing user operation
  const userOp = {
    sender: simpleAccount.address,
    nonce: nonce.toString(),
    factory: null,
    factoryData: null,
    callData: callData,
    callGasLimit: null,
    verificationGasLimit: null,
    preVerificationGas: null,
    maxFeePerGas: "0xb2d05e00",
    maxPriorityFeePerGas: "0x3b9aca00",
    paymaster: null,
    paymasterData: null,
    signature:
      "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c",
  };

  // Estimating gas
  const estimatedGas = await fetch(BUNDLER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_estimateUserOperationGas",
      params: [userOp, ENTRY_POINT_ADDRESS],
    }),
  }).then((res) => res.json());

  // Formatting user operation for paymaster service
  const userOpWithGas = {
    sender: simpleAccount.address,
    nonce: nonce.toString(),
    callData: callData,
    maxFeePerGas: "0xb2d05e00",
    maxPriorityFeePerGas: "0x3b9aca00",
    paymaster: null,
    paymasterData: null,
    signature:
      "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c",
    callGasLimit: estimatedGas.result.callGasLimit,
    verificationGasLimit: estimatedGas.result.verificationGasLimit,
    preVerificationGas: estimatedGas.result.preVerificationGas,
  };

  // Getting paymaster data from paymaster service
  const { result: paymasterServiceResponse } = await fetch(PAYMASTER_SERVICE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "pm_getPaymasterAndData",
      params: [userOpWithGas, { mode: "SPONSORED", calculateGasLimits: true }],
      id: "unique-request-id",
    }),
  }).then((res) => res.json());

  const {
    callGasLimit,
    verificationGasLimit,
    preVerificationGas,
    paymasterVerificationGasLimit,
    paymasterPostOpGasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymasterData,
    paymaster,
  } = paymasterServiceResponse;

  // Signing user operation
  const userOpWithPaymaster = {
    sender: simpleAccount.address,
    nonce,
    callData,
    callGasLimit: BigInt(callGasLimit),
    verificationGasLimit: BigInt(verificationGasLimit),
    preVerificationGas: BigInt(preVerificationGas),
    paymasterVerificationGasLimit: BigInt(paymasterVerificationGasLimit),
    paymasterPostOpGasLimit: BigInt(paymasterPostOpGasLimit),
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymasterData: (paymasterData as `0x${string}`) || "0x",
    paymaster: (paymaster as `0x${string}`) || "0x",
    signature: "0x" as `0x${string}`,
  };

  const userOpSignature = await simpleAccount.signUserOperation(userOpWithPaymaster);

  const signedUserOp = {
    ...userOpWithPaymaster,
    signature: userOpSignature,
    nonce: `0x${BigInt(userOpWithPaymaster.nonce).toString(16)}`,
    callGasLimit: `0x${BigInt(userOpWithPaymaster.callGasLimit).toString(16)}`,
    verificationGasLimit: `0x${BigInt(userOpWithPaymaster.verificationGasLimit).toString(16)}`,
    preVerificationGas: `0x${BigInt(userOpWithPaymaster.preVerificationGas).toString(16)}`,
    paymasterVerificationGasLimit: `0x${BigInt(userOpWithPaymaster.paymasterVerificationGasLimit).toString(16)}`,
    paymasterPostOpGasLimit: `0x${BigInt(userOpWithPaymaster.paymasterPostOpGasLimit).toString(16)}`,
  };

  // Submitting user operation to bundler
  const userOpHash = await fetch(BUNDLER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_sendUserOperation",
      params: [signedUserOp, ENTRY_POINT_ADDRESS],
    }),
  }).then((res) => res.json());

  // Waiting for user operation to be included in a block
  const includedResult = await bundlerClient.waitForUserOperationReceipt({
    hash: userOpHash.result,
  });

  // Post operation checks
  const accountBalanceAfter = (await publicClient.getBalance({
    address: simpleAccount.address,
  })) as bigint;

  const counterStateAfter = (await publicClient.readContract({
    address: COUNTER_CONTRACT_ADDRESS,
    abi: CounterAbi,
    functionName: "counters",
    args: [simpleAccount.address],
  })) as bigint;

  const paymasterDepositAfter = (await publicClient.readContract({
    address: PAYMASTER_CONTRACT_ADDRESS,
    abi: PaymasterAbi,
    functionName: "getDeposit",
    args: [],
  })) as bigint;

  console.log("includedResult", includedResult);
  console.log("Gas cost: ", includedResult.actualGasCost);
  console.log("User operation hash", includedResult.receipt.transactionHash);
  console.log(
    "Block explorer link: ",
    `https://explorer-testnet.soneium.org/tx/${includedResult.receipt.transactionHash}`,
  );
  console.log("Counter state after", counterStateAfter.toString());
  console.log("Account balance after", formatEther(accountBalanceAfter));
  console.log("Paymaster deposit after", formatEther(paymasterDepositAfter));
  return;
}

main().catch(console.error);