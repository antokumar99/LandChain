import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";

type Deployment = {
  chainId?: string;
  landRegistryAddress?: string;
  verifierAddress?: string;
  contracts?: {
    Groth16Verifier?: {
      address?: string;
    };
    LandRegistry?: {
      address?: string;
    };
  };
  deployedAt?: string;
  verifierDeployedAt?: string;
};

const { ethers } = await network.create();
const [deployer] = await ethers.getSigners();

if (deployer === undefined) {
  throw new Error("No deployer account available.");
}

const deploymentFile = fileURLToPath(new URL("../deployments/local.json", import.meta.url));
const existingDeployment = existsSync(deploymentFile)
  ? (JSON.parse(readFileSync(deploymentFile, "utf8")) as Deployment)
  : {};

console.log("Deploying generated Groth16Verifier with account:", deployer.address);

const verifier = await ethers.deployContract("Groth16Verifier");
await verifier.waitForDeployment();

const verifierAddress = await verifier.getAddress();
const chain = await ethers.provider.getNetwork();
const landRegistryAddress =
  existingDeployment.landRegistryAddress ?? existingDeployment.contracts?.LandRegistry?.address;

if (landRegistryAddress !== undefined) {
  const landRegistry = await ethers.getContractAt("LandRegistry", landRegistryAddress);
  const currentVerifier = await landRegistry.verifier();

  if (currentVerifier.toLowerCase() !== verifierAddress.toLowerCase()) {
    const tx = await landRegistry.setVerifier(verifierAddress);
    await tx.wait();
    console.log("LandRegistry verifier updated:", verifierAddress);
  }
}

const nextDeployment: Deployment = {
  ...existingDeployment,
  chainId: chain.chainId.toString(),
  verifierAddress,
  landRegistryAddress,
  contracts: {
    ...existingDeployment.contracts,
    Groth16Verifier: {
      address: verifierAddress,
    },
    ...(landRegistryAddress
      ? {
          LandRegistry: {
            address: landRegistryAddress,
          },
        }
      : {}),
  },
  verifierDeployedAt: new Date().toISOString(),
};

writeFileSync(deploymentFile, `${JSON.stringify(nextDeployment, null, 2)}\n`);

console.log("Groth16Verifier deployed to:", verifierAddress);
console.log("Deployment file updated:", deploymentFile);
