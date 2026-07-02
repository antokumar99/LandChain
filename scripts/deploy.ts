import { network } from "hardhat";

const { ethers } = await network.create();

const [deployer] = await ethers.getSigners();

if (deployer === undefined) {
  throw new Error(
    "No deployer account available. Set SEPOLIA_PRIVATE_KEY to a 32-byte private key, not an address.",
  );
}

console.log("Deploying LandRegistry with account:", deployer.address);

const landRegistry = await ethers.deployContract("LandRegistry");
await landRegistry.waitForDeployment();

console.log("LandRegistry deployed to:", await landRegistry.getAddress());
