declare module 'scs-smart-account-sdk/dist/_cjs/modules/validators/smartSessions/toSmartSessionsModule' {
    export function toSmartSessionsModule(config: {
        signer: any;
    }): Promise<any>;
}

declare module 'scs-smart-account-sdk' {
    import { type Address, type Transport, type Chain, type PublicClient } from 'viem';
    import { type BundlerClient } from 'viem/account-abstraction';

    export type SmartAccountClient = any;
    export type StartaleSmartAccount = any;
    export type SmartSessionMode = any;
    export type SessionData = any;
    export type CreateSessionDataParams = any;
    export type GrantPermissionResponse = any;

    export function smartSessionActions(): {
        createSession: (params: any) => Promise<any>;
        useSession: (params: any) => Promise<any>;
        grantPermission: (params: any) => Promise<GrantPermissionResponse>;
    };

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
        accountAddress?: Address;
        chain: Chain;
        transport: Transport;
        index?: bigint;
    }): Promise<StartaleSmartAccount>;

    export function toSmartSessionsModule(config: {
        signer: any;
    }): Promise<any>;
} 