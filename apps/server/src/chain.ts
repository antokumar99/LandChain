import { Contract, JsonRpcProvider, Wallet, isAddress } from "ethers";
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
];

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
