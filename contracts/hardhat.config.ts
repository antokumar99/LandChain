import "dotenv/config";
import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable, defineConfig } from "hardhat/config";

const sepoliaPrivateKey = process.env.SEPOLIA_PRIVATE_KEY;
const normalizedSepoliaPrivateKey =
  sepoliaPrivateKey !== undefined && /^[0-9a-fA-F]{64}$/.test(sepoliaPrivateKey)
    ? `0x${sepoliaPrivateKey}`
    : sepoliaPrivateKey;

const sepoliaAccounts =
  normalizedSepoliaPrivateKey !== undefined &&
  /^0x[0-9a-fA-F]{64}$/.test(normalizedSepoliaPrivateKey)
    ? [normalizedSepoliaPrivateKey]
    : "remote";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    localhost: {
      type: "http",
      chainType: "l1",
      url: process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545",
      accounts: "remote",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: sepoliaAccounts,
    },
  },
});
