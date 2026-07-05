import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

type DeploymentFile = {
  landRegistryAddress?: string;
  verifierAddress?: string;
  contracts?: {
    LandRegistry?: {
      address?: string;
    };
  };
};

function findWorkspaceRoot() {
  if (process.env.LANDCHAIN_ROOT) {
    return path.resolve(process.env.LANDCHAIN_ROOT);
  }

  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), "../.."),
    path.resolve(__dirname, "../../.."),
    path.resolve(__dirname, "../../../.."),
  ];

  const match = candidates.find(
    (candidate) =>
      existsSync(path.join(candidate, "contracts")) &&
      existsSync(path.join(candidate, "apps", "server")),
  );

  return match ?? path.resolve(process.cwd(), "../..");
}

function readDeployment(filePath: string): DeploymentFile | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  return JSON.parse(readFileSync(filePath, "utf8")) as DeploymentFile;
}

function loadServerEnv() {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "apps/server/.env"),
    path.resolve(__dirname, "../.env"),
    path.resolve(__dirname, "../../apps/server/.env"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate, override: false });
    }
  }
}

loadServerEnv();

const workspaceRoot = findWorkspaceRoot();
const deploymentFile =
  process.env.DEPLOYMENT_FILE ??
  path.join(workspaceRoot, "contracts", "deployments", "local.json");
const deployment = readDeployment(deploymentFile);

export const config = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/landchain",
  chainRpcUrl: process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545",
  privateKey:
    process.env.PRIVATE_KEY ??
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  registryAddress:
    process.env.LAND_REGISTRY_ADDRESS ??
    deployment?.landRegistryAddress ??
    deployment?.contracts?.LandRegistry?.address,
  deploymentFile,
  workspaceRoot,
};
