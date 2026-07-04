import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import { config } from "./config";

const execFileAsync = promisify(execFile);

type ProofOutput = {
  verified: boolean;
  proof: unknown;
  publicSignals: string[];
  solidityCalldata: string;
  witness: string;
};

export type SolidityProofArgs = {
  proofA: [string, string];
  proofB: [[string, string], [string, string]];
  proofC: [string, string];
  publicSignals: [string, string, string];
};

function parseSolidityCalldata(calldata: string): SolidityProofArgs {
  const parsed = JSON.parse(`[${calldata}]`) as [
    [string, string],
    [[string, string], [string, string]],
    [string, string],
    [string, string, string],
  ];

  return {
    proofA: parsed[0],
    proofB: parsed[1],
    proofC: parsed[2],
    publicSignals: parsed[3],
  };
}

export function createFieldSecret() {
  return BigInt(`0x${randomBytes(31).toString("hex")}`).toString();
}

export async function generateTransferProof(input: {
  landId: string;
  ownerSecret: string;
  ownerCommitment: string;
  newOwnerSecret?: string;
  transferNonce?: string;
}) {
  const circuitsRoot = path.join(config.workspaceRoot, "circuits");
  const proofRoot = path.join(circuitsRoot, "build", "proof");
  const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const outDir = path.join(proofRoot, runId);
  const inputPath = path.join(outDir, "input.json");
  const newOwnerSecret = input.newOwnerSecret ?? createFieldSecret();
  const transferNonce = input.transferNonce ?? createFieldSecret();
  const script = path.join(circuitsRoot, "scripts", "generate-proof.js");

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    inputPath,
    JSON.stringify(
      {
        landId: input.landId,
        ownerSecret: input.ownerSecret,
        ownerCommitment: input.ownerCommitment,
        newOwner: newOwnerSecret,
        transferNonce,
      },
      null,
      2,
    ),
  );

  const startedAt = performance.now();
  let stdout: string;

  try {
    const result = await execFileAsync(process.execPath, [script, inputPath, outDir], {
      cwd: circuitsRoot,
      maxBuffer: 20 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proof generation failed";
    throw new Error(
      `Proof generation failed. Check the current owner secret and circuit artifacts. ${message}`,
    );
  }

  const proofMs = Math.round(performance.now() - startedAt);
  const output = JSON.parse(stdout) as ProofOutput;
  const solidity = parseSolidityCalldata(output.solidityCalldata);

  if (!output.verified) {
    throw new Error("SnarkJS proof verification failed");
  }

  const [proofLandId, proofOwnerCommitment, transferCommitment] = output.publicSignals;

  if (
    proofLandId === undefined ||
    proofOwnerCommitment === undefined ||
    transferCommitment === undefined
  ) {
    throw new Error("Proof output is missing required public signals");
  }

  if (proofLandId !== input.landId) {
    throw new Error("Proof land ID does not match requested land");
  }

  if (proofOwnerCommitment !== input.ownerCommitment) {
    throw new Error("Owner secret does not match the current land owner commitment");
  }

  return {
    newOwnerSecret,
    transferNonce,
    proofMs,
    snarkjsVerified: output.verified,
    witnessPath: output.witness,
    proofPath: path.join(outDir, "proof.json"),
    publicPath: path.join(outDir, "public.json"),
    verificationPath: path.join(outDir, "verification.json"),
    transferCommitment,
    solidity,
  };
}
