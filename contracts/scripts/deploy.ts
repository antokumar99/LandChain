import { network } from "hardhat";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { ethers } = await network.create();

const [deployer] = await ethers.getSigners();

if (deployer === undefined) {
  throw new Error(
    "No deployer account available. Set SEPOLIA_PRIVATE_KEY to a 32-byte private key, not an address.",
  );
}

console.log("Deploying LandChain contracts with account:", deployer.address);

const verifier = await ethers.deployContract("Groth16Verifier");
await verifier.waitForDeployment();

const verifierAddress = await verifier.getAddress();
console.log("Groth16Verifier deployed to:", verifierAddress);

const landRegistry = await ethers.deployContract("LandRegistry", [verifierAddress]);
await landRegistry.waitForDeployment();

const landRegistryAddress = await landRegistry.getAddress();
const chain = await ethers.provider.getNetwork();
const deploymentFile = fileURLToPath(new URL("../deployments/local.json", import.meta.url));
const deployment = {
  chainId: chain.chainId.toString(),
  verifierAddress,
  landRegistryAddress,
  contracts: {
    Groth16Verifier: {
      address: verifierAddress,
    },
    LandRegistry: {
      address: landRegistryAddress,
    },
  },
  deployedAt: new Date().toISOString(),
};

mkdirSync(dirname(deploymentFile), { recursive: true });
writeFileSync(deploymentFile, `${JSON.stringify(deployment, null, 2)}\n`);

console.log("LandRegistry deployed to:", landRegistryAddress);
console.log("Deployment file written:", deploymentFile);
console.log("Set these values in your app env files:");
console.log("LAND_REGISTRY_ADDRESS=", landRegistryAddress);
console.log("VERIFIER_ADDRESS=", verifierAddress);
