# Rhinestone Quickstart Guide

This directory contains the Rhinestone SDK quickstart guide implementation.

## Prerequisites

1. **Rhinestone API Key**: Get your API key from [https://rhinestone.xyz](https://rhinestone.xyz)
2. **Funding Account**: You need a private key with some ETH on Base Sepolia testnet

## Setup

1. Create a `.env` file in the project root with the following variables:

```bash
# Rhinestone API Key - Get from https://rhinestone.xyz
RHINESTONE_API_KEY=your_api_key_here

# Funding private key for sending ETH to the smart account
# This should be a private key with some ETH on Base Sepolia
FUNDING_PRIVATE_KEY=your_funding_private_key_here
```

2. Make sure you have some ETH on Base Sepolia testnet for the funding account.

## Running the Quickstart

Run the following command to execute the Rhinestone quickstart:

```bash
npm run rhinestone
```

## What the Script Does

1. **Creates a Smart Account**: Generates a new private key and creates a smart account with a single owner
2. **Funds the Account**: Sends 0.001 ETH from your funding account to the smart account
3. **Cross-Chain Transfer**: Makes a cross-chain USDC transfer from Base Sepolia to Arbitrum Sepolia

## Expected Output

The script will output:
- Smart account address
- Owner private key (save this for future use)
- Transaction hashes for funding and cross-chain transfer
- Final confirmation of successful deployment and transfer

## Notes

- The Rhinestone Orchestrator handles gas token management and ETH → USDC swaps automatically
- Your smart account will be deployed on both Base Sepolia and Arbitrum Sepolia
- The cross-chain transfer will send 1 USDC to a test address (0xd8da6bf26964af9d7eed9e03e53415d37aa96045)

## Troubleshooting

- Make sure your `.env` file is properly configured
- Ensure your funding account has sufficient ETH on Base Sepolia
- Check that your Rhinestone API key is valid
- If you encounter module resolution errors, the tsconfig.json has been updated to use Node16 module resolution 