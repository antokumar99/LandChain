const { execFileSync } = require("node:child_process");
const { mkdirSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const build = join(root, "build");
const keys = join(root, "keys");
const snarkjs = join(root, "node_modules", "snarkjs", "build", "cli.cjs");
const ptau = join(keys, "landchain_0001.ptau");
const finalPtau = join(keys, "landchain_final.ptau");
const phase2Ptau = join(keys, "landchain_phase2.ptau");
const r1cs = join(build, "LandOwnershipProof.r1cs");
const zkey = join(keys, "LandOwnershipProof_0000.zkey");
const finalZkey = join(keys, "LandOwnershipProof_final.zkey");
const vkey = join(keys, "verification_key.json");

mkdirSync(keys, { recursive: true });

execFileSync(process.execPath, [snarkjs, "powersoftau", "new", "bn128", "12", ptau, "-v"], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, [snarkjs, "powersoftau", "contribute", ptau, finalPtau, "--name=LandChain dev contribution", "-v", "-e=landchain"], {
  cwd: root,
  stdio: "inherit",
});
execFileSync(process.execPath, [snarkjs, "powersoftau", "prepare", "phase2", finalPtau, phase2Ptau, "-v"], {
  cwd: root,
  stdio: "inherit",
});
execFileSync(process.execPath, [snarkjs, "groth16", "setup", r1cs, phase2Ptau, zkey], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, [snarkjs, "zkey", "contribute", zkey, finalZkey, "--name=LandChain final key", "-v", "-e=landchain-final"], {
  cwd: root,
  stdio: "inherit",
});
execFileSync(process.execPath, [snarkjs, "zkey", "export", "verificationkey", finalZkey, vkey], { cwd: root, stdio: "inherit" });
