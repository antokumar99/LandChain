import "dotenv/config";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import mongoose from "mongoose";
import {
  cidToBytes32,
  createOwnerSecret,
  deriveChainLandId,
  deriveFieldElement,
  generateMerkleRoot,
  generateOwnerCommitment,
  normalizeLandCode,
} from "./crypto";
import { config } from "./config";
import {
  getBlockExplorer,
  getChainStatus,
  readLandFromChain,
  storeLandOnChain,
  transferLandOnChain,
  verifyOwnershipOnChain,
} from "./chain";
import { LandModel, UserModel, type LandRecord, type UserRecord, type UserRole } from "./landModel";
import { createFieldSecret, generateTransferProof } from "./proof";

type AsyncRoute = (request: Request, response: Response, next: NextFunction) => Promise<void>;
type MongoStatus = "connecting" | "connected" | "disconnected";
type SessionUser = {
  id: string;
  name: string;
  email: string;
  identifier: string;
  role: UserRole;
};

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

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function normalizeEmail(value: unknown) {
  return requiredString(value, "email").toLowerCase();
}

function normalizeRole(value: unknown): UserRole {
  return value === "authority" ? "authority" : "user";
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");

  return `${salt}:${hash}`;
}

function verifyPassword(password: string, passwordHash: string) {
  const [salt, storedHash] = passwordHash.split(":");

  if (!salt || !storedHash) {
    return false;
  }

  const candidate = scryptSync(password, salt, 64);
  const stored = Buffer.from(storedHash, "hex");

  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}

function createRequestId() {
  return `REQ-${Date.now()}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

function requireAuthority(user: SessionUser, response: Response) {
  if (user.role === "authority") {
    return true;
  }

  response.status(403).json({ error: "Authority role required" });
  return false;
}

function landIsApproved(land: Pick<LandRecord, "registrationStatus" | "transactionHash">) {
  return land.registrationStatus === "approved" || (!land.registrationStatus && Boolean(land.transactionHash));
}

function serializeLand(land: unknown, viewer?: SessionUser | null) {
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
  const canSeeOwnerSecret =
    viewer !== undefined &&
    viewer !== null &&
    (viewer.role === "authority" || record.ownerUserId === viewer.id);
  const serialized: Record<string, unknown> = {
    id: record._id?.toString(),
    ...record,
    _id: undefined,
  };

  if (!canSeeOwnerSecret) {
    delete serialized.ownerSecret;
  }

  return serialized;
}

function serializeUser(user: unknown): SessionUser {
  const raw =
    user !== null &&
    typeof user === "object" &&
    "toObject" in user &&
    typeof user.toObject === "function"
      ? user.toObject()
      : user;

  if (raw === null || typeof raw !== "object") {
    throw new Error("Invalid user record");
  }

  const record = raw as UserRecord & { _id?: unknown };

  return {
    id: record._id?.toString() ?? "",
    name: record.name,
    email: record.email,
    identifier: record.identifier,
    role: record.role,
  };
}

async function getSessionUser(request: Request) {
  const userId = request.header("x-landchain-user-id");

  if (!userId) {
    return null;
  }

  const user = await UserModel.findById(userId);

  return user ? serializeUser(user) : null;
}

async function requireSessionUser(request: Request, response: Response) {
  const user = await getSessionUser(request);

  if (user) {
    return user;
  }

  response.status(401).json({ error: "Login required" });
  return null;
}

function canManageLand(user: SessionUser, land: Pick<LandRecord, "ownerUserId">) {
  return user.role === "authority" || land.ownerUserId === user.id;
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

app.post(
  "/api/auth/register",
  asyncRoute(async (request, response) => {
    if (!ensureMongoConnected(response)) {
      return;
    }

    const body = request.body as Record<string, unknown>;
    const name = requiredString(body.name, "name");
    const email = normalizeEmail(body.email);
    const identifier = requiredString(body.identifier, "identifier");
    const password = requiredString(body.password, "password");
    const role = normalizeRole(body.role);

    if (password.length < 6) {
      response.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }

    const existing = await UserModel.findOne({ email }).lean();

    if (existing) {
      response.status(409).json({ error: "User already exists" });
      return;
    }

    const user = await UserModel.create({
      name,
      email,
      identifier,
      role,
      passwordHash: hashPassword(password),
    });
    const session = serializeUser(user);

    response.status(201).json({
      user: session,
      underHood: {
        role,
        authMode: "local-demo-session",
        passwordStoredAs: "scrypt salt:hash",
      },
    });
  }),
);

app.post(
  "/api/auth/login",
  asyncRoute(async (request, response) => {
    if (!ensureMongoConnected(response)) {
      return;
    }

    const body = request.body as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    const password = requiredString(body.password, "password");
    const user = await UserModel.findOne({ email });

    if (!user || !verifyPassword(password, user.passwordHash)) {
      response.status(401).json({ error: "Invalid email or password" });
      return;
    }

    response.json({
      user: serializeUser(user),
      underHood: {
        role: user.role,
        authMode: "local-demo-session",
        sessionHeader: "x-landchain-user-id",
      },
    });
  }),
);

app.get(
  "/api/auth/me",
  asyncRoute(async (request, response) => {
    if (!ensureMongoConnected(response)) {
      return;
    }

    const user = await requireSessionUser(request, response);

    if (!user) {
      return;
    }

    response.json({ user });
  }),
);

app.get(
  "/api/lands",
  asyncRoute(async (request, response) => {
    if (!ensureMongoConnected(response)) {
      return;
    }

    const actor = await getSessionUser(request);
    const lands = await LandModel.find().sort({ createdAt: -1 }).lean();

    response.json({ lands: lands.map((land) => serializeLand(land, actor)) });
  }),
);

app.get(
  "/api/lands/:landId",
  asyncRoute(async (request, response) => {
    if (!ensureMongoConnected(response)) {
      return;
    }

    const actor = await getSessionUser(request);
    const landId = normalizeLandCode(requiredString(request.params.landId, "landId"));
    const land = await LandModel.findOne({ landId }).lean();

    if (!land) {
      response.status(404).json({ error: "Land not found" });
      return;
    }

    const chainLandId = land.chainLandId ?? deriveChainLandId(land.landId);
    const chain = await readLandFromChain(chainLandId);

    response.json({ land: serializeLand(land, actor), chain });
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

app.get(
  "/api/explorer",
  asyncRoute(async (request, response) => {
    const explorer = await getBlockExplorer({ count: request.query.count });

    response.json(explorer);
  }),
);

app.post(
  "/api/lands/register",
  asyncRoute(async (request, response) => {
    if (!ensureMongoConnected(response)) {
      return;
    }

    const actor = await requireSessionUser(request, response);

    if (!actor) {
      return;
    }

    const body = request.body as Record<string, unknown>;
    const landId = normalizeLandCode(requiredString(body.landId, "landId"));
    const chainLandId = deriveChainLandId(landId);
    const ownerName = requiredString(body.ownerName, "ownerName");
    const ownerIdentifier =
      optionalString(body.ownerNid) ?? optionalString(body.ownerIdentifier) ?? requiredString(undefined, "ownerNid");
    const plotNumber = requiredString(body.plotNumber, "plotNumber");
    const location = requiredString(body.location, "location");
    const deedDocument = requiredString(body.deedDocument, "deedDocument");
    const deedHash = cidToBytes32(`${landId}:${ownerIdentifier}:${plotNumber}:${location}:${deedDocument}`);
    const ownerSecret = optionalString(body.ownerSecret) ?? createOwnerSecret();
    const metadata =
      body.metadata !== null && typeof body.metadata === "object"
        ? (body.metadata as Record<string, unknown>)
        : undefined;

    const existing = await LandModel.findOne({ $or: [{ landId }, { chainLandId }] }).lean();

    if (existing) {
      response.status(409).json({ error: "Land already registered" });
      return;
    }

    const ownerCommitment = await generateOwnerCommitment({
      landId: chainLandId,
      ownerName,
      ownerIdentifier,
      ownerSecret,
    });
    const documentMetadata = {
      ...metadata,
      plotNumber,
      location,
      deedDocument,
      deedHash,
    };
    const cidHash = cidToBytes32(
      JSON.stringify({
        landId,
        chainLandId,
        ownerName,
        ownerNid: ownerIdentifier,
        plotNumber,
        location,
        deedDocument,
        deedHash,
        metadata: documentMetadata,
      }),
    );
    const landPayload = {
      landId,
      chainLandId,
      ownerName,
      ownerIdentifier,
      ownerUserId: actor.id,
      ownerEmail: actor.email,
      ownerSecret,
      plotNumber,
      location,
      deedDocument,
      deedHash,
      ownerCommitment,
      cidHash,
      registrationStatus: "pending" as const,
      submittedAt: new Date(),
      listedForSale: false,
      metadata: documentMetadata,
    };

    const land = await LandModel.create(landPayload);

    response.status(201).json({
      land: serializeLand(land, actor),
      generated: {
        ownerSecret,
        chainLandId,
        ownerCommitment,
        cidHash,
      },
      approval: {
        status: "pending",
        message: "Authority approval is required before this land is registered on-chain.",
      },
      underHood: {
        actor,
        steps: [
          "Human land ID normalized for the registry record",
          "Numeric chainLandId derived for circuit and smart contract use",
          "Deed document metadata hashed into bytes32",
          "Owner secret selected or generated",
          "Poseidon owner commitment generated",
          "MongoDB land application saved as pending",
          "No smart contract write happens until an authority approves",
        ],
      },
    });
  }),
);

app.post(
  "/api/lands/:landId/approve",
  asyncRoute(async (request, response) => {
    if (!ensureMongoConnected(response)) {
      return;
    }

    const actor = await requireSessionUser(request, response);

    if (!actor || !requireAuthority(actor, response)) {
      return;
    }

    const landId = normalizeLandCode(requiredString(request.params.landId, "landId"));
    const land = await LandModel.findOne({ landId });

    if (!land) {
      response.status(404).json({ error: "Land application not found" });
      return;
    }

    if (landIsApproved(land)) {
      response.json({
        land: serializeLand(land, actor),
        approval: {
          status: "approved",
          message: "Land is already approved.",
        },
      });
      return;
    }

    if (land.registrationStatus === "rejected") {
      response.status(409).json({ error: "Rejected land application cannot be approved" });
      return;
    }

    const approvedCommitments = await LandModel.find({ registrationStatus: "approved" })
      .select("ownerCommitment -_id")
      .lean();
    const merkle = generateMerkleRoot([
      ...approvedCommitments.map((record) => record.ownerCommitment),
      land.ownerCommitment,
    ]);
    const chain = await storeLandOnChain({
      landId: land.chainLandId,
      ownerCommitment: land.ownerCommitment,
      merkleRoot: merkle.root,
      cidHash: land.cidHash,
    });

    land.registrationStatus = "approved";
    land.approvedAt = new Date();
    land.approvedBy = actor.id;
    land.approvedByName = actor.name;
    land.merkleRoot = merkle.root;
    land.merkleRootHex = merkle.rootHex;
    land.transactionHash = chain.transactionHash;
    land.contractAddress = chain.contractAddress;

    if (chain.blockNumber !== undefined) {
      land.blockNumber = chain.blockNumber;
    }

    await land.save();

    response.json({
      land: serializeLand(land, actor),
      generated: {
        merkleRoot: merkle.root,
        merkleRootHex: merkle.rootHex,
      },
      chain,
      approval: {
        status: "approved",
        approvedBy: actor.name,
      },
      underHood: {
        actor,
        steps: [
          "Authority session checked",
          "Pending land application loaded from MongoDB",
          "Merkle root recalculated using approved land commitments",
          "LandRegistry.registerLand transaction mined",
          "Application marked approved with transaction details",
        ],
      },
    });
  }),
);

app.post(
  "/api/lands/:landId/sell",
  asyncRoute(async (request, response) => {
    if (!ensureMongoConnected(response)) {
      return;
    }

    const actor = await requireSessionUser(request, response);

    if (!actor) {
      return;
    }

    const landId = normalizeLandCode(requiredString(request.params.landId, "landId"));
    const body = request.body as Record<string, unknown>;
    const price = requiredString(body.price, "price");
    const saleCurrency = optionalString(body.saleCurrency) ?? "BDT";
    const ownerSecret = optionalString(body.ownerSecret);
    const land = await LandModel.findOne({ landId });

    if (!land) {
      response.status(404).json({ error: "Land not found" });
      return;
    }

    if (land.ownerUserId !== actor.id) {
      response.status(403).json({ error: "Only the current owner can list this land" });
      return;
    }

    if (!landIsApproved(land)) {
      response.status(409).json({ error: "Authority approval is required before selling this land" });
      return;
    }

    const secretForSale = ownerSecret ?? land.ownerSecret;

    if (!secretForSale) {
      response.status(400).json({
        error: "Owner secret is required to list this land for sale",
      });
      return;
    }

    const chainLandId = land.chainLandId ?? deriveChainLandId(land.landId);
    land.chainLandId = chainLandId;
    const chainLand = await readLandFromChain(chainLandId);

    if (!chainLand.exists) {
      response.status(404).json({ error: "Land exists in MongoDB but not on chain" });
      return;
    }

    const commitmentFromSecret = await generateOwnerCommitment({
      landId: chainLandId,
      ownerName: land.ownerName,
      ownerIdentifier: land.ownerIdentifier,
      ownerSecret: secretForSale,
    });

    if (commitmentFromSecret !== chainLand.ownerCommitment) {
      response.status(422).json({ error: "Owner secret does not match the on-chain owner commitment" });
      return;
    }

    land.ownerSecret = secretForSale;
    land.listedForSale = true;
    land.salePrice = price;
    land.saleCurrency = saleCurrency;
    land.listedAt = new Date();
    land.sellerUserId = actor.id;

    await land.save();

    response.json({
      land: serializeLand(land, actor),
      underHood: {
        actor,
        chainLandId,
        commitmentFromSecret,
        chainOwnerCommitment: chainLand.ownerCommitment,
        commitmentMatched: true,
        steps: [
          "Session user checked against land owner",
          "Owner secret recomputed into the expected Poseidon commitment",
          "Commitment compared with current on-chain owner commitment",
          "Sale listing saved in MongoDB for buyer flow",
        ],
      },
    });
  }),
);

app.post(
  "/api/lands/:landId/auth-requests",
  asyncRoute(async (request, response) => {
    if (!ensureMongoConnected(response)) {
      return;
    }

    const actor = await requireSessionUser(request, response);

    if (!actor) {
      return;
    }

    const landId = normalizeLandCode(requiredString(request.params.landId, "landId"));
    const body = request.body as Record<string, unknown>;
    const buyerMessage = optionalString(body.message) ?? "Please prove you are the authentic owner.";
    const land = await LandModel.findOne({ landId });

    if (!land) {
      response.status(404).json({ error: "Land not found" });
      return;
    }

    if (!land.listedForSale) {
      response.status(409).json({ error: "Seller authenticity proof is available after listing" });
      return;
    }

    if (land.ownerUserId === actor.id) {
      response.status(400).json({ error: "Owner cannot request authenticity proof from themselves" });
      return;
    }

    if (!landIsApproved(land)) {
      response.status(409).json({ error: "Only approved land can receive buyer proof requests" });
      return;
    }

    const requestId = createRequestId();
    const buyerChallenge = `${requestId}:${landId}:${actor.id}:${buyerMessage}`;
    const proofRequest = {
      requestId,
      buyerUserId: actor.id,
      buyerName: actor.name,
      buyerIdentifier: actor.identifier,
      buyerMessage,
      buyerChallenge,
      challengeField: deriveFieldElement(buyerChallenge),
      status: "requested" as const,
      createdAt: new Date(),
    };

    land.authenticityRequests ??= [];
    land.authenticityRequests.push(proofRequest);

    await land.save();

    response.status(201).json({
      land: serializeLand(land, actor),
      request: proofRequest,
      underHood: {
        buyer: actor,
        sellerName: land.ownerName,
        steps: [
          "Buyer message stored as an authenticity request",
          "Unique buyer challenge generated from request id, land id, buyer id, and message",
          "Challenge mapped into the circuit field",
          "Seller must answer this request from their owner account",
        ],
      },
    });
  }),
);

app.post(
  "/api/lands/:landId/auth-requests/:requestId/prove",
  asyncRoute(async (request, response) => {
    if (!ensureMongoConnected(response)) {
      return;
    }

    const actor = await requireSessionUser(request, response);

    if (!actor) {
      return;
    }

    const landId = normalizeLandCode(requiredString(request.params.landId, "landId"));
    const requestId = requiredString(request.params.requestId, "requestId");
    const body = request.body as Record<string, unknown>;
    const ownerSecret = requiredString(body.ownerSecret, "ownerSecret");
    const land = await LandModel.findOne({ landId });

    if (!land) {
      response.status(404).json({ error: "Land not found" });
      return;
    }

    if (land.ownerUserId !== actor.id) {
      response.status(403).json({ error: "Only the current land owner can prove authenticity" });
      return;
    }

    if (!landIsApproved(land)) {
      response.status(409).json({ error: "Authority approval is required before proving ownership" });
      return;
    }

    const proofRequest = land.authenticityRequests?.find((entry) => entry.requestId === requestId);

    if (!proofRequest) {
      response.status(404).json({ error: "Authenticity request not found" });
      return;
    }

    const chainLandId = land.chainLandId ?? deriveChainLandId(land.landId);
    land.chainLandId = chainLandId;
    const chainLand = await readLandFromChain(chainLandId);

    if (!chainLand.exists) {
      response.status(404).json({ error: "Land exists in MongoDB but not on chain" });
      return;
    }

    const commitmentFromSecret = await generateOwnerCommitment({
      landId: chainLandId,
      ownerName: land.ownerName,
      ownerIdentifier: land.ownerIdentifier,
      ownerSecret,
    });

    if (commitmentFromSecret !== chainLand.ownerCommitment) {
      response.status(422).json({ error: "Owner secret does not match the current on-chain owner" });
      return;
    }

    const proof = await generateTransferProof({
      landId: chainLandId,
      ownerSecret,
      ownerCommitment: chainLand.ownerCommitment,
      proofContext: proofRequest.challengeField,
      transferNonce: createFieldSecret(),
    });

    proofRequest.status = "proved";
    proofRequest.ownerCommitment = chainLand.ownerCommitment;
    proofRequest.proofCommitment = proof.transferCommitment;
    proofRequest.proofMs = proof.proofMs;
    proofRequest.snarkjsVerified = proof.snarkjsVerified;
    proofRequest.proof = proof.solidity;
    proofRequest.publicSignals = [
      chainLandId,
      chainLand.ownerCommitment,
      proof.transferCommitment,
    ];
    proofRequest.provedAt = new Date();

    await land.save();

    response.json({
      land: serializeLand(land, actor),
      request: proofRequest,
      proof: {
        snarkjsVerified: proof.snarkjsVerified,
        proofMs: proof.proofMs,
        landId,
        chainLandId,
        ownerCommitment: chainLand.ownerCommitment,
        proofCommitment: proof.transferCommitment,
        buyerChallenge: proofRequest.buyerChallenge,
        challengeField: proofRequest.challengeField,
        publicSignals: proofRequest.publicSignals,
        solidity: proof.solidity,
      },
      underHood: {
        seller: actor,
        buyerName: proofRequest.buyerName,
        secretSharedWithBuyer: false,
        onlyOwnerCouldProve: true,
        steps: [
          "Seller session checked against current land owner",
          "Seller supplied owner secret privately for witness generation",
          "Owner secret matched the current on-chain owner commitment",
          "Proof generated for the buyer's exact request challenge",
          "Buyer receives proof data and public signals, not the owner secret",
        ],
      },
    });
  }),
);

app.post(
  "/api/lands/:landId/buy",
  asyncRoute(async (request, response) => {
    if (!ensureMongoConnected(response)) {
      return;
    }

    const actor = await requireSessionUser(request, response);

    if (!actor) {
      return;
    }

    const landId = normalizeLandCode(requiredString(request.params.landId, "landId"));
    const body = request.body as Record<string, unknown>;
    const land = await LandModel.findOne({ landId });

    if (!land) {
      response.status(404).json({ error: "Land not found" });
      return;
    }

    if (!land.listedForSale) {
      response.status(409).json({ error: "Land is not listed for sale" });
      return;
    }

    if (land.ownerUserId === actor.id) {
      response.status(400).json({ error: "Current owner cannot buy their own land" });
      return;
    }

    const authenticityRequestId = optionalString(body.authenticityRequestId);
    const provedRequest = authenticityRequestId
      ? land.authenticityRequests?.find(
          (entry) =>
            entry.requestId === authenticityRequestId &&
            entry.buyerUserId === actor.id &&
            entry.status === "proved" &&
            entry.snarkjsVerified === true,
        )
      : land.authenticityRequests?.find(
          (entry) =>
            entry.buyerUserId === actor.id &&
            entry.status === "proved" &&
            entry.snarkjsVerified === true,
        );

    if (!provedRequest) {
      response.status(409).json({
        error: "Buyer must receive a valid seller authenticity proof before buying this land",
      });
      return;
    }

    const sellerSecret = land.ownerSecret;

    if (!sellerSecret) {
      response.status(409).json({ error: "Seller has not authorized transfer for this listing" });
      return;
    }

    const chainLandId = land.chainLandId ?? deriveChainLandId(land.landId);
    land.chainLandId = chainLandId;
    const chainLand = await readLandFromChain(chainLandId);

    if (!chainLand.exists) {
      response.status(404).json({ error: "Land exists in MongoDB but not on chain" });
      return;
    }

    const previousOwnerName = land.ownerName;
    const previousOwnerIdentifier = land.ownerIdentifier;
    const salePrice = land.salePrice;
    const saleCurrency = land.saleCurrency;
    const sellerUserId = land.sellerUserId;
    const newOwnerName = optionalString(body.newOwnerName) ?? actor.name;
    const newOwnerIdentifier = optionalString(body.newOwnerIdentifier) ?? actor.identifier;
    const newOwnerSecret = optionalString(body.newOwnerSecret) ?? createFieldSecret();
    const transferNonce = optionalString(body.transferNonce) ?? createFieldSecret();
    const ownerCommitment = chainLand.ownerCommitment;
    const proof = await generateTransferProof({
      landId: chainLandId,
      ownerSecret: sellerSecret,
      ownerCommitment,
      newOwnerSecret,
      transferNonce,
    });
    const proofChain = await verifyOwnershipOnChain({
      proofA: proof.solidity.proofA,
      proofB: proof.solidity.proofB,
      proofC: proof.solidity.proofC,
      landId: chainLandId,
      ownerCommitment,
      transferCommitment: proof.transferCommitment,
    });

    if (!proofChain.valid) {
      response.status(422).json({ error: "Smart contract rejected the proof" });
      return;
    }

    const previousCommitments = await LandModel.find({ registrationStatus: "approved" })
      .select("chainLandId ownerCommitment -_id")
      .lean();
    const nextCommitments = previousCommitments.map((record) =>
      record.chainLandId === chainLandId ? proof.transferCommitment : record.ownerCommitment,
    );
    const merkle = generateMerkleRoot(nextCommitments);
    const nextMetadata = {
      previousOwnerName,
      previousOwnerIdentifier,
      buyerName: newOwnerName,
      buyerIdentifier: newOwnerIdentifier,
      salePrice,
      saleCurrency,
      authenticityRequestId: provedRequest.requestId,
      transferNonce,
    };
    const cidHash = cidToBytes32(
      JSON.stringify({
        landId,
        chainLandId,
        ownerName: newOwnerName,
        ownerIdentifier: newOwnerIdentifier,
        plotNumber: land.plotNumber,
        location: land.location,
        deedDocument: land.deedDocument,
        deedHash: land.deedHash,
        metadata: nextMetadata,
      }),
    );
    const transferChain = await transferLandOnChain({
      landId: chainLandId,
      newOwnerCommitment: proof.transferCommitment,
      merkleRoot: merkle.root,
      cidHash,
    });

    land.ownerName = newOwnerName;
    land.ownerIdentifier = newOwnerIdentifier;
    land.ownerUserId = actor.id;
    land.ownerEmail = actor.email;
    land.ownerSecret = newOwnerSecret;
    land.ownerCommitment = proof.transferCommitment;
    land.merkleRoot = merkle.root;
    land.merkleRootHex = merkle.rootHex;
    land.cidHash = cidHash;
    land.metadata = nextMetadata;
    land.transactionHash = transferChain.transactionHash;
    land.contractAddress = transferChain.contractAddress;
    land.listedForSale = false;
    land.set("salePrice", undefined);
    land.set("saleCurrency", undefined);
    land.set("listedAt", undefined);
    land.set("sellerUserId", undefined);

    if (transferChain.blockNumber !== undefined) {
      land.blockNumber = transferChain.blockNumber;
    }

    const transferHistory: NonNullable<LandRecord["transfers"]>[number] = {
      fromOwnerCommitment: ownerCommitment,
      toOwnerCommitment: proof.transferCommitment,
      previousOwnerName,
      previousOwnerIdentifier,
      newOwnerName,
      newOwnerIdentifier,
      buyerUserId: actor.id,
      proofTransactionHash: proofChain.transactionHash,
      transferTransactionHash: transferChain.transactionHash,
      proofMs: proof.proofMs,
      snarkjsVerified: proof.snarkjsVerified,
      contractVerified: proofChain.valid,
      createdAt: new Date(),
    };

    if (salePrice !== undefined) {
      transferHistory.salePrice = salePrice;
    }

    if (saleCurrency !== undefined) {
      transferHistory.saleCurrency = saleCurrency;
    }

    if (sellerUserId !== undefined) {
      transferHistory.sellerUserId = sellerUserId;
    }

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
      land: serializeLand(land, actor),
      generated: {
        newOwnerSecret,
        transferNonce,
        chainLandId,
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
      underHood: {
        sellerSecretUsed: true,
        authenticityRequestId: provedRequest.requestId,
        actor,
        steps: [
          "Buyer session loaded",
          "Valid seller authenticity proof for this buyer checked",
          "Listed land and seller owner secret loaded",
          "Witness generated from seller secret and new buyer secret",
          "Groth16 proof generated and verified by SnarkJS",
          "LandRegistry.verifyOwnership stored proof approval",
          "LandRegistry.approveTransfer moved land to buyer commitment",
          "MongoDB owner, listing, proof, and gas records updated",
        ],
      },
    });
  }),
);

app.post(
  "/api/lands/:landId/transfer",
  asyncRoute(async (request, response) => {
    if (!ensureMongoConnected(response)) {
      return;
    }

    const actor = await requireSessionUser(request, response);

    if (!actor) {
      return;
    }

    const landId = normalizeLandCode(requiredString(request.params.landId, "landId"));
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

    if (!canManageLand(actor, land)) {
      response.status(403).json({ error: "Only the current owner or authority can transfer this land" });
      return;
    }

    if (!landIsApproved(land)) {
      response.status(409).json({ error: "Authority approval is required before transferring this land" });
      return;
    }

    const chainLandId = land.chainLandId ?? deriveChainLandId(land.landId);
    land.chainLandId = chainLandId;
    const chainLand = await readLandFromChain(chainLandId);

    if (!chainLand.exists) {
      response.status(404).json({ error: "Land exists in MongoDB but not on chain" });
      return;
    }

    const ownerCommitment = chainLand.ownerCommitment;
    const proof = await generateTransferProof({
      landId: chainLandId,
      ownerSecret,
      ownerCommitment,
      newOwnerSecret,
      transferNonce,
    });
    const proofChain = await verifyOwnershipOnChain({
      proofA: proof.solidity.proofA,
      proofB: proof.solidity.proofB,
      proofC: proof.solidity.proofC,
      landId: chainLandId,
      ownerCommitment,
      transferCommitment: proof.transferCommitment,
    });

    if (!proofChain.valid) {
      response.status(422).json({ error: "Smart contract rejected the proof" });
      return;
    }

    const previousCommitments = await LandModel.find({ registrationStatus: "approved" })
      .select("chainLandId ownerCommitment -_id")
      .lean();
    const nextCommitments = previousCommitments.map((record) =>
      record.chainLandId === chainLandId ? proof.transferCommitment : record.ownerCommitment,
    );
    const merkle = generateMerkleRoot(nextCommitments);
    const previousOwnerName = land.ownerName;
    const previousOwnerIdentifier = land.ownerIdentifier;
    const nextMetadata = {
      ...extraMetadata,
      previousOwnerName,
      previousOwnerIdentifier,
      transferNonce,
    };
    const cidHash = cidToBytes32(
      JSON.stringify({
        landId,
        chainLandId,
        ownerName: newOwnerName,
        ownerIdentifier: newOwnerIdentifier,
        plotNumber: land.plotNumber,
        location: land.location,
        deedDocument: land.deedDocument,
        deedHash: land.deedHash,
        metadata: nextMetadata,
      }),
    );
    const transferChain = await transferLandOnChain({
      landId: chainLandId,
      newOwnerCommitment: proof.transferCommitment,
      merkleRoot: merkle.root,
      cidHash,
    });

    land.ownerName = newOwnerName;
    land.ownerIdentifier = newOwnerIdentifier;
    land.ownerSecret = newOwnerSecret;
    land.set("ownerUserId", undefined);
    land.set("ownerEmail", undefined);
    land.ownerCommitment = proof.transferCommitment;
    land.merkleRoot = merkle.root;
    land.merkleRootHex = merkle.rootHex;
    land.cidHash = cidHash;
    land.metadata = nextMetadata;
    land.transactionHash = transferChain.transactionHash;
    land.contractAddress = transferChain.contractAddress;
    land.listedForSale = false;
    land.set("salePrice", undefined);
    land.set("saleCurrency", undefined);
    land.set("listedAt", undefined);
    land.set("sellerUserId", undefined);

    if (transferChain.blockNumber !== undefined) {
      land.blockNumber = transferChain.blockNumber;
    }

    const transferHistory: NonNullable<LandRecord["transfers"]>[number] = {
      fromOwnerCommitment: ownerCommitment,
      toOwnerCommitment: proof.transferCommitment,
      previousOwnerName,
      previousOwnerIdentifier,
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
      land: serializeLand(land, actor),
      generated: {
        newOwnerSecret,
        transferNonce,
        chainLandId,
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
      underHood: {
        actor,
        steps: [
          "Current owner or authority session checked",
          "Witness generated from the current owner secret",
          "Groth16 proof generated and verified by SnarkJS",
          "LandRegistry.verifyOwnership accepted and stored proof approval",
          "LandRegistry.approveTransfer updated owner commitment",
          "MongoDB land record saved with new owner secret and transfer metrics",
        ],
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
