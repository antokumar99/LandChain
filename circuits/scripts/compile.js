const { execFileSync } = require("node:child_process");
const { existsSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const circuit = join(root, "circuits", "LandOwnershipProof.circom");
const outDir = join(root, "build");
const circom = process.env.CIRCOM_BIN || "circom";

mkdirSync(outDir, { recursive: true });

try {
  execFileSync(circom, [circuit, "--r1cs", "--wasm", "--sym", "-o", outDir], {
    cwd: root,
    stdio: "inherit",
  });
} catch (error) {
  if (error.code === "ENOENT" && !existsSync(join(outDir, "LandOwnershipProof.r1cs"))) {
    throw new Error("Circom compilation failed. Install circom or set CIRCOM_BIN to your circom executable.");
  }
  throw error;
}
