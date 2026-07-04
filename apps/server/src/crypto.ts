import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { AbiCoder, concat, getBytes, keccak256, toUtf8Bytes, ZeroHash } from "ethers";
import { config } from "./config";

const abiCoder = AbiCoder.defaultAbiCoder();
const circuitsRequire = createRequire(path.join(config.workspaceRoot, "circuits", "package.json"));
const { buildPoseidon } = circuitsRequire("circomlibjs") as {
  buildPoseidon: () => Promise<{
    F: {
      toString: (value: unknown) => string;
    };
    (inputs: Array<string | bigint>): unknown;
  }>;
};
let poseidonPromise: ReturnType<typeof buildPoseidon> | undefined;

export type CommitmentInput = {
  landId: string | number | bigint;
  ownerName: string;
  ownerIdentifier: string;
  ownerSecret: string;
};

function toPositiveUint(value: string | number | bigint, field: string) {
  const parsed = BigInt(value);

  if (parsed <= 0n) {
    throw new Error(`${field} must be greater than zero`);
  }

  return parsed;
}

function hashUint(value: string | bigint) {
  return keccak256(abiCoder.encode(["uint256"], [BigInt(value)]));
}

function hashPair(left: string, right: string) {
  const [first, second] = BigInt(left) <= BigInt(right) ? [left, right] : [right, left];
  return keccak256(concat([getBytes(first), getBytes(second)]));
}

export function createOwnerSecret() {
  return BigInt(`0x${randomBytes(31).toString("hex")}`).toString();
}

export function normalizeLandId(landId: string | number | bigint) {
  return toPositiveUint(landId, "landId").toString();
}

async function getPoseidon() {
  poseidonPromise ??= buildPoseidon();
  return poseidonPromise;
}

export async function poseidonHash(inputs: Array<string | number | bigint>) {
  const poseidon = await getPoseidon();
  const normalized = inputs.map((input) => BigInt(input).toString());

  return poseidon.F.toString(poseidon(normalized));
}

export async function generateOwnerCommitment(input: CommitmentInput) {
  const landId = toPositiveUint(input.landId, "landId");

  return poseidonHash([landId, input.ownerSecret]);
}

export function generateMerkleRoot(commitments: string[]) {
  if (commitments.length === 0) {
    throw new Error("At least one commitment is required");
  }

  const leaves = commitments.map(hashUint);
  let level = leaves;

  while (level.length > 1) {
    const nextLevel: string[] = [];

    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];

      if (left === undefined) {
        throw new Error("Invalid Merkle level");
      }

      const right = level[index + 1] ?? left;

      nextLevel.push(hashPair(left, right));
    }

    level = nextLevel;
  }

  const rootHex = level[0];

  if (rootHex === undefined) {
    throw new Error("Unable to generate Merkle root");
  }

  return {
    leaves,
    root: BigInt(rootHex).toString(),
    rootHex,
  };
}

export function cidToBytes32(value?: string) {
  if (value === undefined || value.trim() === "") {
    return ZeroHash;
  }

  return keccak256(toUtf8Bytes(value.trim()));
}
