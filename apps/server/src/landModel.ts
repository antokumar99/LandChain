import { model, models, Schema, type Model } from "mongoose";

export type LandRecord = {
  landId: string;
  ownerName: string;
  ownerIdentifier: string;
  ownerCommitment: string;
  merkleRoot: string;
  merkleRootHex: string;
  cidHash: string;
  metadata?: Record<string, unknown>;
  transactionHash: string;
  blockNumber?: number;
  contractAddress: string;
  transfers?: Array<{
    fromOwnerCommitment: string;
    toOwnerCommitment: string;
    newOwnerName: string;
    newOwnerIdentifier: string;
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

const landSchema = new Schema<LandRecord>(
  {
    landId: { type: String, required: true, unique: true, index: true },
    ownerName: { type: String, required: true, trim: true },
    ownerIdentifier: { type: String, required: true, trim: true },
    ownerCommitment: { type: String, required: true },
    merkleRoot: { type: String, required: true },
    merkleRootHex: { type: String, required: true },
    cidHash: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
    transactionHash: { type: String, required: true },
    blockNumber: { type: Number },
    contractAddress: { type: String, required: true },
    transfers: [
      {
        fromOwnerCommitment: { type: String, required: true },
        toOwnerCommitment: { type: String, required: true },
        newOwnerName: { type: String, required: true, trim: true },
        newOwnerIdentifier: { type: String, required: true, trim: true },
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
