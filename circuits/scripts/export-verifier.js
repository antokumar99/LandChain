const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

const root = join(__dirname, "..");
const snarkjs = join(root, "node_modules", "snarkjs", "build", "cli.cjs");
const finalZkey = join(root, "keys", "LandOwnershipProof_final.zkey");
const verifierSol = join(root, "..", "contracts", "contracts", "Groth16Verifier.sol");

execFileSync(process.execPath, [snarkjs, "zkey", "export", "solidityverifier", finalZkey, verifierSol], {
  cwd: root,
  stdio: "inherit",
});
