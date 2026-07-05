const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const { buildPoseidon } = require("circomlibjs");
const snarkjs = require("snarkjs");

async function main() {
  const root = join(__dirname, "..");
  const inputPath = process.argv[2] || join(root, "input", "landOwnership.example.json");
  const outDir = process.argv[3] || join(root, "build", "proof");
  const wasm = join(root, "build", "LandOwnershipProof_js", "LandOwnershipProof.wasm");
  const zkey = join(root, "keys", "LandOwnershipProof_final.zkey");
  const vkey = join(root, "keys", "verification_key.json");
  const witness = join(outDir, "witness.wtns");
  const generatedInputPath = join(outDir, "input.generated.json");
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  const poseidon = await buildPoseidon();
  const field = poseidon.F;
  const proofContext = input.proofContext || input.newOwner || input.transferNonce;

  if (!proofContext) {
    throw new Error("proofContext is required");
  }

  input.ownerCommitment ||= field.toString(poseidon([input.landId, input.ownerSecret]));
  input.proofCommitment ||= input.transferCommitment || field.toString(poseidon([input.landId, proofContext]));

  const circuitInput = {
    landId: input.landId,
    ownerSecret: input.ownerSecret,
    proofContext,
    ownerCommitment: input.ownerCommitment,
    proofCommitment: input.proofCommitment,
  };

  mkdirSync(outDir, { recursive: true });

  writeFileSync(generatedInputPath, JSON.stringify(circuitInput, null, 2));

  await snarkjs.wtns.calculate(circuitInput, wasm, witness);

  const { proof, publicSignals } = await snarkjs.groth16.prove(zkey, witness);
  const verified = await snarkjs.groth16.verify(JSON.parse(readFileSync(vkey, "utf8")), publicSignals, proof);
  const solidityCalldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);

  writeFileSync(join(outDir, "proof.json"), JSON.stringify(proof, null, 2));
  writeFileSync(join(outDir, "public.json"), JSON.stringify(publicSignals, null, 2));
  writeFileSync(join(outDir, "calldata.txt"), solidityCalldata);
  writeFileSync(
    join(outDir, "verification.json"),
    JSON.stringify(
      {
        verified,
        witness,
        generatedInput: generatedInputPath,
      },
      null,
      2,
    ),
  );

  if (!verified) {
    throw new Error("SnarkJS verification failed");
  }

  console.log(JSON.stringify({ verified, proof, publicSignals, solidityCalldata, witness }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
