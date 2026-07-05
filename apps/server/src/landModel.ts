import { model, models, Schema, type Model } from "mongoose";

export type UserRole = "authority" | "user";

export type UserRecord = {
  name: string;
  email: string;
  identifier: string;
  role: UserRole;
  passwordHash: string;
};

export type RegistrationStatus = "pending" | "approved" | "rejected";
export type ProofRequestStatus = "requested" | "proved";

export type LandRecord = {
  landId: string;
  chainLandId: string;
  ownerName: string;
  ownerIdentifier: string;
  ownerUserId?: string;
  ownerEmail?: string;
  ownerSecret?: string;
  plotNumber: string;
  location: string;
  deedDocument: string;
  deedHash: string;
  ownerCommitment: string;
  registrationStatus?: RegistrationStatus;
  submittedAt?: Date;
  approvedAt?: Date;
  approvedBy?: string;
  approvedByName?: string;
  rejectedAt?: Date;
  rejectedBy?: string;
  rejectionReason?: string;
  merkleRoot?: string;
  merkleRootHex?: string;
  cidHash: string;
  metadata?: Record<string, unknown>;
  transactionHash?: string;
  blockNumber?: number;
  contractAddress?: string;
  listedForSale?: boolean;
  salePrice?: string;
  saleCurrency?: string;
  listedAt?: Date;
  sellerUserId?: string;
  authenticityProofs?: Array<{
    buyerUserId?: string;
    buyerName?: string;
    challenge: string;
    ownerCommitment: string;
    proofCommitment: string;
    proofMs: number;
    snarkjsVerified: boolean;
    createdAt: Date;
  }>;
  authenticityRequests?: Array<{
    requestId: string;
    buyerUserId: string;
    buyerName: string;
    buyerIdentifier: string;
    buyerMessage: string;
    buyerChallenge: string;
    challengeField: string;
    status: ProofRequestStatus;
    ownerCommitment?: string;
    proofCommitment?: string;
    proofMs?: number;
    snarkjsVerified?: boolean;
    proof?: unknown;
    publicSignals?: string[];
    createdAt: Date;
    provedAt?: Date;
  }>;
  transfers?: Array<{
    fromOwnerCommitment: string;
    toOwnerCommitment: string;
    previousOwnerName?: string;
    previousOwnerIdentifier?: string;
    newOwnerName: string;
    newOwnerIdentifier: string;
    sellerUserId?: string;
    buyerUserId?: string;
    salePrice?: string;
    saleCurrency?: string;
    proofTransactionHash: string;
    transferTransactionHash: string;
    proofGasUsed?: string;
    transferGasUsed?: string;
    proofMs: number;
    snarkjsVerified: boolean;
    contractVerified: boolean;
    createdAt: Date;
  }>;
};

const userSchema = new Schema<UserRecord>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    identifier: { type: String, required: true, trim: true },
    role: { type: String, required: true, enum: ["authority", "user"], default: "user" },
    passwordHash: { type: String, required: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

const landSchema = new Schema<LandRecord>(
  {
    landId: { type: String, required: true, unique: true, index: true },
    chainLandId: { type: String, required: true, unique: true, index: true },
    ownerName: { type: String, required: true, trim: true },
    ownerIdentifier: { type: String, required: true, trim: true },
    ownerUserId: { type: String },
    ownerEmail: { type: String, lowercase: true, trim: true },
    ownerSecret: { type: String },
    plotNumber: { type: String, required: true, trim: true },
    location: { type: String, required: true, trim: true },
    deedDocument: { type: String, required: true, trim: true },
    deedHash: { type: String, required: true },
    ownerCommitment: { type: String, required: true },
    registrationStatus: {
      type: String,
      required: true,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    submittedAt: { type: Date },
    approvedAt: { type: Date },
    approvedBy: { type: String },
    approvedByName: { type: String },
    rejectedAt: { type: Date },
    rejectedBy: { type: String },
    rejectionReason: { type: String },
    merkleRoot: { type: String },
    merkleRootHex: { type: String },
    cidHash: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
    transactionHash: { type: String },
    blockNumber: { type: Number },
    contractAddress: { type: String },
    listedForSale: { type: Boolean, default: false },
    salePrice: { type: String },
    saleCurrency: { type: String },
    listedAt: { type: Date },
    sellerUserId: { type: String },
    authenticityProofs: [
      {
        buyerUserId: { type: String },
        buyerName: { type: String, trim: true },
        challenge: { type: String, required: true },
        ownerCommitment: { type: String, required: true },
        proofCommitment: { type: String, required: true },
        proofMs: { type: Number, required: true },
        snarkjsVerified: { type: Boolean, required: true },
        createdAt: { type: Date, required: true },
      },
    ],
    authenticityRequests: [
      {
        requestId: { type: String, required: true },
        buyerUserId: { type: String, required: true },
        buyerName: { type: String, required: true, trim: true },
        buyerIdentifier: { type: String, required: true, trim: true },
        buyerMessage: { type: String, required: true, trim: true },
        buyerChallenge: { type: String, required: true },
        challengeField: { type: String, required: true },
        status: { type: String, required: true, enum: ["requested", "proved"], default: "requested" },
        ownerCommitment: { type: String },
        proofCommitment: { type: String },
        proofMs: { type: Number },
        snarkjsVerified: { type: Boolean },
        proof: { type: Schema.Types.Mixed },
        publicSignals: [{ type: String }],
        createdAt: { type: Date, required: true },
        provedAt: { type: Date },
      },
    ],
    transfers: [
      {
        fromOwnerCommitment: { type: String, required: true },
        toOwnerCommitment: { type: String, required: true },
        previousOwnerName: { type: String, trim: true },
        previousOwnerIdentifier: { type: String, trim: true },
        newOwnerName: { type: String, required: true, trim: true },
        newOwnerIdentifier: { type: String, required: true, trim: true },
        sellerUserId: { type: String },
        buyerUserId: { type: String },
        salePrice: { type: String },
        saleCurrency: { type: String },
        proofTransactionHash: { type: String, required: true },
        transferTransactionHash: { type: String, required: true },
        proofGasUsed: { type: String },
        transferGasUsed: { type: String },
        proofMs: { type: Number, required: true },
        snarkjsVerified: { type: Boolean, required: true },
        contractVerified: { type: Boolean, required: true },
        createdAt: { type: Date, required: true },
      },
    ],
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const LandModel =
  (models.Land as Model<LandRecord> | undefined) ?? model<LandRecord>("Land", landSchema);

export const UserModel =
  (models.User as Model<UserRecord> | undefined) ?? model<UserRecord>("User", userSchema);
