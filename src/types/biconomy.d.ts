declare module '@biconomy/abstractjs' {
    import { type Address, type Transport, type Chain, type PublicClient } from 'viem';
    import { type BundlerClient } from 'viem/account-abstraction';

    // Declare a generic type for the module exports
    export type SmartAccountClient = any;
    export type NexusAccount = any;

    export function createSmartAccountClient(config: {
        account: any;
        transport: Transport;
        client: PublicClient;
        paymaster?: any;
        paymasterContext?: any;
        userOperation?: any;
        mock?: boolean;
    }): SmartAccountClient;

    export function toNexusAccount(config: {
        signer: any;
        chain: Chain;
        transport: Transport;
        attesters: Address[];
        factoryAddress: Address;
        validatorAddress: Address;
        index: bigint;
        accountAddress?: Address;
    }): Promise<NexusAccount>;

    // Add any other exports you need
    export * from '@biconomy/abstractjs';
} 