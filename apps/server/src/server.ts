import "dotenv/config";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import mongoose from "mongoose";
import {
  cidToBytes32,
  createOwnerSecret,
  generateMerkleRoot,
  generateOwnerCommitment,
  normalizeLandId,
} from "./crypto";
import { config } from "./config";
import {
  getChainStatus,
  readLandFromChain,
  storeLandOnChain,
  transferLandOnChain,
  verifyOwnershipOnChain,
} from "./chain";
import { LandModel, type LandRecord } from "./landModel";
import { createFieldSecret, generateTransferProof } from "./proof";

type AsyncRoute = (request: Request, response: Response, next: NextFunction) => Promise<void>;
type MongoStatus = "connecting" | "connected" | "disconnected";

function asyncRoute(handler: AsyncRoute) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response, next).catch(next);
  };
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`);
  }

  return value.trim();
}

function serializeLand(land: unknown) {
  const raw =
    land !== null &&
    typeof land === "object" &&
    "toObject" in land &&
    typeof land.toObject === "function"
      ? land.toObject()
      : land;

  if (raw === null || typeof raw !== "object") {
    return raw;
  }

  const record = raw as Record<string, unknown>;

  return {
    id: record._id?.toString(),
    ...record,
    _id: undefined,
  };
}

function ensureMongoConnected(response: Response) {
  if (mongoose.connection.readyState === 1) {
    return true;
  }

  response.status(503).json({ error: "MongoDB not connected" });
  return false;
}

function mongoConnectionStatus(): MongoStatus {
  if (mongoose.connection.readyState === 1) {
    return "connected";
  }

  if (mongoose.connection.readyState === 2) {
    return "connecting";
  }

  return "disconnected";
}

function redactMongoUri(uri: string) {
  try {
    const parsed = new URL(uri);

    if (parsed.username) {
      parsed.username = "USER";
    }

    if (parsed.password) {
      parsed.password = "PASSWORD";
    }

    return parsed.toString();
  } catch {
    return "configured MongoDB URI";
  }
}

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get(
  "/health",
  asyncRoute(async (_request, response) => {
    const chain = await getChainStatus();

    response.json({
      api: "running",
      mongodb: mongoConnectionStatus(),
      chain,
    });
  }),
);

app.get(
  "/api/lands",
  asyncRoute(async (_request, response) => {
    if (!ensureMongoConnected(response)) {
      return;
    }

    const lands = await LandModel.find().sort({ createdAt: -1 }).lean();

    response.json({ lands: lands.map(serializeLand) });
  }),
);

app.get(
  "/api/lands/:landId",
  asyncRoute(async (request, response) => {
    if (!ensureMongoConnected(response)) {
      return;
    }

    const landId = normalizeLandId(requiredString(request.params.landId, "landId"));
    const land = await LandModel.findOne({ landId }).lean();

    if (!land) {
      response.status(404).json({ error: "Land not found" });
      return;
    }

    const chain = await readLandFromChain(landId);

    response.json({ land: serializeLand(land), chain });
  }),
);

app.get(
  "/api/merkle/latest",
  asyncRoute(async (_request, response) => {
    const chain = await getChainStatus();

    response.json({
      merkleRoot: chain.latestMerkleRoot,
      contractAddress: chain.contractAddress,
      blockNumber: chain.blockNumber,
    });
  }),
);

app.post(
  "/api/lands/register",
  asyncRoute(async (request, response) => {
    if (!ensureMongoConnected(response)) {
      return;
    }

    const body = request.body as Record<string, unknown>;
    const landId = normalizeLandId(requiredString(body.landId, "landId"));
    const ownerName = requiredString(body.ownerName, "ownerName");
    const ownerIdentifier = requiredString(body.ownerIdentifier, "ownerIdentifier");
    const ownerSecret =
      typeof body.ownerSecret === "string" && body.ownerSecret.trim() !== ""
        ? body.ownerSecret.trim()
        : createOwnerSecret();
    const metadata =
      body.metadata !== null && typeof body.metadata === "object"
        ? (body.metadata as Record<string, unknown>)
        : undefined;

    const existing = await LandModel.findOne({ landId }).lean();

    if (existing) {
      response.status(409).json({ error: "Land already registered" });
      return;
    }

    const ownerCommitment = await generateOwnerCommitment({
      landId,
      ownerName,
      ownerIdentifier,
      ownerSecret,
    });
    const previousCommitments = await LandModel.find().select("ownerCommitment -_id").lean();
    const merkle = generateMerkleRoot([
      ...previousCommitments.map((land) => land.ownerCommitment),
      ownerCommitment,
    ]);
    const cidHash = cidToBytes32(JSON.stringify({ landId, ownerName, ownerIdentifier, metadata }));
    const chain = await storeLandOnChain({
      landId,
      ownerCommitment,
      merkleRoot: merkle.root,
      cidHash,
    });
    const landPayload = {
      landId,
      ownerName,
      ownerIdentifier,
      ownerCommitment,
      merkleRoot: merkle.root,
      merkleRootHex: merkle.rootHex,
      cidHash,
      transactionHash: chain.transactionHash,
      contractAddress: chain.contractAddress,
    };

    if (metadata !== undefined) {
      Object.assign(landPayload, { metadata });
    }

    if (chain.blockNumber !== undefined) {
      Object.assign(landPayload, { blockNumber: chain.blockNumber });
    }

    const land = await LandModel.create(landPayload);

    response.status(201).json({
      land: serializeLand(land),
      generated: {
        ownerSecret,
        ownerCommitment,
        merkleRoot: merkle.root,
        merkleRootHex: merkle.rootHex,
        cidHash,
      },
      chain,
    });
  }),
);

app.post(
  "/api/lands/:landId/transfer",
  asyncRoute(async (request, response) => {
    if (!ensureMongoConnected(response)) {
      return;
    }

    const landId = normalizeLandId(requiredString(request.params.landId, "landId"));
    const body = request.body as Record<string, unknown>;
    const ownerSecret = requiredString(body.ownerSecret, "ownerSecret");
    const newOwnerName = requiredString(body.newOwnerName, "newOwnerName");
    const newOwnerIdentifier = requiredString(body.newOwnerIdentifier, "newOwnerIdentifier");
    const newOwnerSecret =
      typeof body.newOwnerSecret === "string" && body.newOwnerSecret.trim() !== ""
        ? body.newOwnerSecret.trim()
        : createFieldSecret();
    const transferNonce =
      typeof body.transferNonce === "string" && body.transferNonce.trim() !== ""
        ? body.transferNonce.trim()
        : createFieldSecret();
    const extraMetadata =
      body.metadata !== null && typeof body.metadata === "object"
        ? (body.metadata as Record<string, unknown>)
        : {};

    const land = await LandModel.findOne({ landId });

    if (!land) {
      response.status(404).json({ error: "Land not found" });
      return;
    }

    const chainLand = await readLandFromChain(landId);

    if (!chainLand.exists) {
      response.status(404).json({ error: "Land exists in MongoDB but not on chain" });
      return;
    }

    const ownerCommitment = chainLand.ownerCommitment;
    const proof = await generateTransferProof({
      landId,
      ownerSecret,
      ownerCommitment,
      newOwnerSecret,
      transferNonce,
    });
    const proofChain = await verifyOwnershipOnChain({
      proofA: proof.solidity.proofA,
      proofB: proof.solidity.proofB,
      proofC: proof.solidity.proofC,
      landId,
      ownerCommitment,
      transferCommitment: proof.transferCommitment,
    });

    if (!proofChain.valid) {
      response.status(422).json({ error: "Smart contract rejected the proof" });
      return;
    }

    const previousCommitments = await LandModel.find().select("landId ownerCommitment -_id").lean();
    const nextCommitments = previousCommitments.map((record) =>
      record.landId === landId ? proof.transferCommitment : record.ownerCommitment,
    );
    const merkle = generateMerkleRoot(nextCommitments);
    const nextMetadata = {
      ...extraMetadata,
      previousOwnerName: land.ownerName,
      previousOwnerIdentifier: land.ownerIdentifier,
      transferNonce,
    };
    const cidHash = cidToBytes32(
      JSON.stringify({
        landId,
        ownerName: newOwnerName,
        ownerIdentifier: newOwnerIdentifier,
        metadata: nextMetadata,
      }),
    );
    const transferChain = await transferLandOnChain({
      landId,
      newOwnerCommitment: proof.transferCommitment,
      merkleRoot: merkle.root,
      cidHash,
    });

    land.ownerName = newOwnerName;
    land.ownerIdentifier = newOwnerIdentifier;
    land.ownerCommitment = proof.transferCommitment;
    land.merkleRoot = merkle.root;
    land.merkleRootHex = merkle.rootHex;
    land.cidHash = cidHash;
    land.metadata = nextMetadata;
    land.transactionHash = transferChain.transactionHash;
    land.contractAddress = transferChain.contractAddress;

    if (transferChain.blockNumber !== undefined) {
      land.blockNumber = transferChain.blockNumber;
    }

    const transferHistory: NonNullable<LandRecord["transfers"]>[number] = {
      fromOwnerCommitment: ownerCommitment,
      toOwnerCommitment: proof.transferCommitment,
      newOwnerName,
      newOwnerIdentifier,
      proofTransactionHash: proofChain.transactionHash,
      transferTransactionHash: transferChain.transactionHash,
      proofMs: proof.proofMs,
      snarkjsVerified: proof.snarkjsVerified,
      contractVerified: proofChain.valid,
      createdAt: new Date(),
    };

    if (proofChain.gasUsed !== undefined) {
      transferHistory.proofGasUsed = proofChain.gasUsed;
    }

    if (transferChain.gasUsed !== undefined) {
      transferHistory.transferGasUsed = transferChain.gasUsed;
    }

    land.transfers ??= [];
    land.transfers.push(transferHistory);

    await land.save();

    response.status(201).json({
      land: serializeLand(land),
      generated: {
        newOwnerSecret,
        transferNonce,
        newOwnerCommitment: proof.transferCommitment,
        merkleRoot: merkle.root,
        merkleRootHex: merkle.rootHex,
        cidHash,
      },
      proof: {
        snarkjsVerified: proof.snarkjsVerified,
        proofMs: proof.proofMs,
        witnessPath: proof.witnessPath,
        proofPath: proof.proofPath,
        publicPath: proof.publicPath,
        verificationPath: proof.verificationPath,
      },
      chain: {
        proof: proofChain,
        transfer: transferChain,
      },
      metrics: {
        proofMs: proof.proofMs,
        proofGasUsed: proofChain.gasUsed,
        transferGasUsed: transferChain.gasUsed,
        totalGasUsed:
          proofChain.gasUsed !== undefined && transferChain.gasUsed !== undefined
            ? (BigInt(proofChain.gasUsed) + BigInt(transferChain.gasUsed)).toString()
            : undefined,
      },
    });
  }),
);

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const statusCode =
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : undefined;
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : undefined;
  const details =
    typeof error === "object" && error !== null && "details" in error ? error.details : undefined;
  const status =
    statusCode ??
    (message.includes("already exists") || message.includes("already registered")
      ? 409
      : message.includes("missing") || message.includes("ECONNREFUSED")
        ? 503
        : 500);

  response.status(status).json({ error: message, code, details });
});

async function connectMongo() {
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
    console.log(`MongoDB connected: ${redactMongoUri(config.mongoUri)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "MongoDB connection failed";
    console.error(`MongoDB unavailable: ${message}`);
    setTimeout(connectMongo, 5000);
  }
}

async function start() {
  app.listen(config.port, () => {
    console.log(`Express backend running: http://localhost:${config.port}`);
  });

  void connectMongo();
}

start().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
