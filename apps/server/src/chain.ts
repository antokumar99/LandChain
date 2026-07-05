import { Contract, Interface, JsonRpcProvider, Wallet, isAddress } from "ethers";
import { config } from "./config";

export const landRegistryAbi = [
  "function registerLand(uint256 landId,uint256 ownerCommitment,uint256 merkleRoot,bytes32 cidHash)",
  "function approveTransfer(uint256 landId,uint256 newOwnerCommitment,uint256 newMerkleRoot,bytes32 newCidHash)",
  "function verifyOwnership(uint[2] proofA,uint[2][2] proofB,uint[2] proofC,uint256 landId,uint256 ownerCommitment,uint256 transferCommitment) returns (bool)",
  "function getLand(uint256 landId) view returns (uint256 ownerCommitment,uint256 merkleRoot,bytes32 cidHash,uint8 status,uint64 updatedAt,bool exists)",
  "function latestMerkleRoot() view returns (uint256)",
  "function knownMerkleRoots(uint256 merkleRoot) view returns (bool)",
  "function superAdmin() view returns (address)",
  "function authorities(address authority) view returns (bool)",
  "event AuthorityUpdated(address indexed authority,bool allowed)",
  "event VerifierUpdated(address indexed verifier)",
  "event LandRegistered(uint256 indexed landId,uint256 indexed ownerCommitment,uint256 indexed merkleRoot,bytes32 cidHash,uint256 timestamp)",
  "event OwnershipProofVerified(uint256 indexed landId,uint256 indexed ownerCommitment,uint256 indexed transferCommitment,bool valid,uint256 timestamp)",
  "event LandTransferred(uint256 indexed landId,uint256 indexed oldOwnerCommitment,uint256 indexed newOwnerCommitment,uint256 merkleRoot,bytes32 cidHash,uint256 timestamp)",
  "event LandSuspended(uint256 indexed landId,uint256 timestamp)",
  "event MerkleRootStored(uint256 indexed merkleRoot,address indexed submittedBy,uint256 timestamp)",
];

const landRegistryInterface = new Interface(landRegistryAbi);

type ContractTransaction = {
  hash: string;
  wait: () => Promise<{ hash?: string; blockNumber?: number; gasUsed?: bigint } | null>;
};

export class ChainAuthorizationError extends Error {
  statusCode = 403;
  code = "CHAIN_AUTHORITY_REQUIRED";

  constructor(
    message: string,
    public details: {
      serverWallet: string;
      superAdmin: string;
      contractAddress: string;
    },
  ) {
    super(message);
    this.name = "ChainAuthorizationError";
  }
}

type LandRegistryContract = Contract & {
  latestMerkleRoot: () => Promise<bigint>;
  superAdmin: () => Promise<string>;
  authorities: (authority: string) => Promise<boolean>;
  registerLand: (
    landId: bigint,
    ownerCommitment: bigint,
    merkleRoot: bigint,
    cidHash: string,
  ) => Promise<ContractTransaction>;
  approveTransfer: (
    landId: bigint,
    newOwnerCommitment: bigint,
    newMerkleRoot: bigint,
    newCidHash: string,
  ) => Promise<ContractTransaction>;
  getLand: (landId: bigint) => Promise<[bigint, bigint, string, bigint, bigint, boolean]>;
};

function requireRegistryAddress() {
  if (!config.registryAddress) {
    throw new Error(
      `LandRegistry address missing. Deploy locally first or set LAND_REGISTRY_ADDRESS. Checked ${config.deploymentFile}`,
    );
  }

  if (!isAddress(config.registryAddress)) {
    throw new Error(`Invalid LandRegistry address: ${config.registryAddress}`);
  }

  return config.registryAddress;
}

export function getProvider() {
  return new JsonRpcProvider(config.chainRpcUrl);
}

export function getRegistry(readonly = false) {
  const address = requireRegistryAddress();
  const provider = getProvider();
  const runner = readonly ? provider : new Wallet(config.privateKey, provider);

  return new Contract(address, landRegistryAbi, runner) as unknown as LandRegistryContract;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function clampExplorerCount(value: unknown) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);

  if (!Number.isFinite(parsed)) {
    return 8;
  }

  return Math.min(Math.max(parsed, 1), 12);
}

function stringifyChainValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => stringifyChainValue(entry));
  }

  return value;
}

function serializeDecodedArgs(inputs: ReadonlyArray<{ name: string }>, args: ReadonlyArray<unknown>) {
  return inputs.reduce<Record<string, unknown>>((serialized, input, index) => {
    serialized[input.name || `arg${index}`] = stringifyChainValue(args[index]);
    return serialized;
  }, {});
}

function serializeLog(log: {
  address: string;
  data: string;
  topics: readonly string[];
  index: number;
  transactionIndex: number;
  transactionHash: string;
  blockHash: string;
  blockNumber: number;
}) {
  let decoded:
    | {
        name: string;
        signature: string;
        args: Record<string, unknown>;
      }
    | undefined;

  if (
    config.registryAddress &&
    log.address.toLowerCase() === config.registryAddress.toLowerCase()
  ) {
    try {
      const parsed = landRegistryInterface.parseLog({
        topics: [...log.topics],
        data: log.data,
      });

      if (parsed) {
        decoded = {
          name: parsed.name,
          signature: parsed.signature,
          args: serializeDecodedArgs(parsed.fragment.inputs, parsed.args),
        };
      }
    } catch {
      decoded = undefined;
    }
  }

  return {
    address: log.address,
    data: log.data,
    topics: [...log.topics],
    index: log.index,
    transactionIndex: log.transactionIndex,
    transactionHash: log.transactionHash,
    blockHash: log.blockHash,
    blockNumber: log.blockNumber,
    decoded,
  };
}

function bigintToString(value: bigint | null | undefined) {
  return value === null || value === undefined ? undefined : value.toString();
}

function lowerAddress(value: string | null | undefined) {
  return value ? value.toLowerCase() : undefined;
}

async function getExplorerTransaction(provider: JsonRpcProvider, hash: string) {
  const [tx, receipt] = await Promise.all([
    provider.getTransaction(hash),
    provider.getTransactionReceipt(hash),
  ]);
  const logs = receipt?.logs.map((log) => serializeLog(log)) ?? [];
  const registryAddress = lowerAddress(config.registryAddress);
  const touchesRegistry =
    registryAddress !== undefined &&
    (lowerAddress(tx?.to) === registryAddress ||
      logs.some((log) => lowerAddress(log.address) === registryAddress));

  return {
    hash,
    from: tx?.from,
    to: tx?.to ?? null,
    nonce: tx?.nonce,
    index: tx?.index,
    value: bigintToString(tx?.value),
    type: tx?.type,
    chainId: bigintToString(tx?.chainId),
    data: tx?.data,
    gasLimit: bigintToString(tx?.gasLimit),
    gasPrice: bigintToString(tx?.gasPrice),
    maxFeePerGas: bigintToString(tx?.maxFeePerGas),
    maxPriorityFeePerGas: bigintToString(tx?.maxPriorityFeePerGas),
    blockHash: tx?.blockHash ?? null,
    blockNumber: tx?.blockNumber ?? null,
    receipt: receipt
      ? {
          status: receipt.status,
          gasUsed: bigintToString(receipt.gasUsed),
          cumulativeGasUsed: bigintToString(receipt.cumulativeGasUsed),
          contractAddress: receipt.contractAddress,
          logsBloom: receipt.logsBloom,
        }
      : null,
    logs,
    registryEvents: logs.filter((log) => log.decoded !== undefined),
    touchesRegistry,
  };
}

export async function getAuthorityStatus() {
  const contractAddress = requireRegistryAddress();
  const provider = getProvider();
  const signer = new Wallet(config.privateKey, provider);
  const registry = new Contract(
    contractAddress,
    landRegistryAbi,
    provider,
  ) as unknown as LandRegistryContract;
  const [superAdmin, explicitlyAuthorized] = await Promise.all([
    registry.superAdmin(),
    registry.authorities(signer.address),
  ]);
  const isSuperAdmin = signer.address.toLowerCase() === superAdmin.toLowerCase();

  return {
    serverWallet: signer.address,
    superAdmin,
    contractAddress,
    isAuthority: isSuperAdmin || explicitlyAuthorized,
    isSuperAdmin,
    explicitlyAuthorized,
  };
}

export async function getChainStatus() {
  const provider = getProvider();
  const blockNumber = await provider.getBlockNumber();

  if (!config.registryAddress) {
    return {
      rpcUrl: config.chainRpcUrl,
      blockNumber,
      contractAddress: null,
      latestMerkleRoot: null,
    };
  }

  const registry = getRegistry(true);
  const [latestMerkleRoot, authority] = await Promise.all([
    registry.latestMerkleRoot(),
    getAuthorityStatus(),
  ]);

  return {
    rpcUrl: config.chainRpcUrl,
    blockNumber,
    contractAddress: config.registryAddress,
    latestMerkleRoot: latestMerkleRoot.toString(),
    authority,
  };
}

export async function getBlockExplorer(input: { count?: unknown } = {}) {
  const provider = getProvider();
  const latestBlockNumber = await provider.getBlockNumber();
  const count = clampExplorerCount(input.count);
  const startBlock = latestBlockNumber;
  const endBlock = Math.max(0, startBlock - count + 1);
  const blockNumbers = Array.from(
    { length: startBlock - endBlock + 1 },
    (_entry, index) => startBlock - index,
  );
  const blocks = await Promise.all(
    blockNumbers.map(async (blockNumber) => {
      const block = await provider.getBlock(blockNumber);

      if (!block) {
        return null;
      }

      const transactions = await Promise.all(
        block.transactions.map((hash) => getExplorerTransaction(provider, hash)),
      );
      const registryEvents = transactions.flatMap((transaction) => transaction.registryEvents);

      return {
        number: block.number,
        hash: block.hash,
        parentHash: block.parentHash,
        nonce: block.nonce,
        timestamp: block.timestamp,
        timestampIso: new Date(block.timestamp * 1000).toISOString(),
        miner: block.miner,
        difficulty: bigintToString(block.difficulty),
        gasLimit: bigintToString(block.gasLimit),
        gasUsed: bigintToString(block.gasUsed),
        baseFeePerGas: bigintToString(block.baseFeePerGas),
        extraData: block.extraData,
        transactionCount: transactions.length,
        transactions,
        registryEvents,
      };
    }),
  );

  return {
    network: {
      rpcUrl: config.chainRpcUrl,
      latestBlockNumber,
      contractAddress: config.registryAddress || null,
      shownBlockCount: blocks.filter((block) => block !== null).length,
    },
    blocks: blocks.filter((block) => block !== null),
  };
}

async function assertCanRegisterLand() {
  const authority = await getAuthorityStatus();

  if (authority.isAuthority) {
    return;
  }

  throw new ChainAuthorizationError(
    `The backend wallet ${shortAddress(authority.serverWallet)} is not allowed to register land on this LandRegistry contract. Use the deployer wallet or add this wallet as an authority from the super admin account.`,
    {
      serverWallet: authority.serverWallet,
      superAdmin: authority.superAdmin,
      contractAddress: authority.contractAddress,
    },
  );
}

export async function storeLandOnChain(input: {
  landId: string;
  ownerCommitment: string;
  merkleRoot: string;
  cidHash: string;
}) {
  await assertCanRegisterLand();

  const registry = getRegistry();
  const tx = await registry.registerLand(
    BigInt(input.landId),
    BigInt(input.ownerCommitment),
    BigInt(input.merkleRoot),
    input.cidHash,
  );
  const receipt = await tx.wait();

  return {
    transactionHash: receipt?.hash ?? tx.hash,
    blockNumber: receipt?.blockNumber,
    gasUsed: receipt?.gasUsed?.toString(),
    contractAddress: requireRegistryAddress(),
  };
}

export async function verifyOwnershipOnChain(input: {
  proofA: [string, string];
  proofB: [[string, string], [string, string]];
  proofC: [string, string];
  landId: string;
  ownerCommitment: string;
  transferCommitment: string;
}) {
  await assertCanRegisterLand();

  const registry = getRegistry() as unknown as {
    verifyOwnership: ((
      proofA: [string, string],
      proofB: [[string, string], [string, string]],
      proofC: [string, string],
      landId: bigint,
      ownerCommitment: bigint,
      transferCommitment: bigint,
    ) => Promise<ContractTransaction>) & {
      staticCall: (
        proofA: [string, string],
        proofB: [[string, string], [string, string]],
        proofC: [string, string],
        landId: bigint,
        ownerCommitment: bigint,
        transferCommitment: bigint,
      ) => Promise<boolean>;
    };
  };
  const args = [
    input.proofA,
    input.proofB,
    input.proofC,
    BigInt(input.landId),
    BigInt(input.ownerCommitment),
    BigInt(input.transferCommitment),
  ] as const;
  const valid = await registry.verifyOwnership.staticCall(...args);
  const tx = await registry.verifyOwnership(...args);
  const receipt = await tx.wait();

  return {
    valid,
    transactionHash: receipt?.hash ?? tx.hash,
    blockNumber: receipt?.blockNumber,
    gasUsed: receipt?.gasUsed?.toString(),
    contractAddress: requireRegistryAddress(),
  };
}

export async function transferLandOnChain(input: {
  landId: string;
  newOwnerCommitment: string;
  merkleRoot: string;
  cidHash: string;
}) {
  await assertCanRegisterLand();

  const registry = getRegistry();
  const tx = await registry.approveTransfer(
    BigInt(input.landId),
    BigInt(input.newOwnerCommitment),
    BigInt(input.merkleRoot),
    input.cidHash,
  );
  const receipt = await tx.wait();

  return {
    transactionHash: receipt?.hash ?? tx.hash,
    blockNumber: receipt?.blockNumber,
    gasUsed: receipt?.gasUsed?.toString(),
    contractAddress: requireRegistryAddress(),
  };
}

export async function readLandFromChain(landId: string) {
  const registry = getRegistry(true);
  const land = await registry.getLand(BigInt(landId));

  return {
    ownerCommitment: land[0].toString(),
    merkleRoot: land[1].toString(),
    cidHash: land[2],
    status: Number(land[3]),
    updatedAt: Number(land[4]),
    exists: Boolean(land[5]),
  };
}
