declare module 'scs-smart-account-sdk' {
    import { type Address, type Transport, type Chain, type PublicClient } from 'viem';
    import { type BundlerClient } from 'viem/account-abstraction';

    export type SmartAccountClient = any;
    export type StartaleSmartAccount = any;

    export function createSmartAccountClient(config: {
        account: any;
        transport: Transport;
        client: PublicClient;
        paymaster?: any;
        paymasterContext?: any;
        userOperation?: any;
        mock?: boolean;
    }): SmartAccountClient;

    export function toStartaleSmartAccount(config: {
        signer: any;
        chain: Chain;
        transport: Transport;
        index: bigint;
    }): Promise<StartaleSmartAccount>;
} 