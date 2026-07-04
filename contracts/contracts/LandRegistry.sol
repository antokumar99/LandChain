// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { MerkleRootStore } from "./MerkleRootStore.sol";

contract LandRegistry is MerkleRootStore {
    enum LandStatus {
        None,
        Registered,
        Transferred,
        Suspended
    }

    struct LandRecord {
        uint256 landId;
        uint256 ownerCommitment;
        uint256 merkleRoot;
        bytes32 cidHash;
        LandStatus status;
        uint64 updatedAt;
        bool exists;
    }

    address public superAdmin;
    IVerifier public verifier;

    mapping(address => bool) public authorities;
    mapping(uint256 => LandRecord) private lands;
    mapping(bytes32 => bool) public verifiedProofs;
    mapping(bytes32 => bool) public verifiedTransfers;

    event AuthorityUpdated(address indexed authority, bool allowed);
    event VerifierUpdated(address indexed verifier);
    event LandRegistered(
        uint256 indexed landId,
        uint256 indexed ownerCommitment,
        uint256 indexed merkleRoot,
        bytes32 cidHash,
        uint256 timestamp
    );
    event OwnershipProofVerified(
        uint256 indexed landId,
        uint256 indexed ownerCommitment,
        uint256 indexed transferCommitment,
        bool valid,
        uint256 timestamp
    );
    event LandTransferred(
        uint256 indexed landId,
        uint256 indexed oldOwnerCommitment,
        uint256 indexed newOwnerCommitment,
        uint256 merkleRoot,
        bytes32 cidHash,
        uint256 timestamp
    );
    event LandSuspended(uint256 indexed landId, uint256 timestamp);

    modifier onlySuperAdmin() {
        require(msg.sender == superAdmin, "Only super admin");
        _;
    }

    modifier onlyAuthority() {
        require(authorities[msg.sender] || msg.sender == superAdmin, "Only authority");
        _;
    }

    constructor(address verifierAddress) {
        require(verifierAddress != address(0), "Verifier required");
        superAdmin = msg.sender;
        verifier = IVerifier(verifierAddress);
        authorities[msg.sender] = true;
        emit AuthorityUpdated(msg.sender, true);
        emit VerifierUpdated(verifierAddress);
    }

    function setAuthority(address authority, bool allowed) external onlySuperAdmin {
        require(authority != address(0), "Zero authority");
        authorities[authority] = allowed;
        emit AuthorityUpdated(authority, allowed);
    }

    function setVerifier(address verifierAddress) external onlySuperAdmin {
        require(verifierAddress != address(0), "Verifier required");
        verifier = IVerifier(verifierAddress);
        emit VerifierUpdated(verifierAddress);
    }

    function registerLand(
        uint256 landId,
        uint256 ownerCommitment,
        uint256 merkleRoot,
        bytes32 cidHash
    ) external onlyAuthority {
        require(landId != 0, "Invalid land");
        require(ownerCommitment != 0, "Invalid commitment");
        require(merkleRoot != 0, "Invalid root");
        require(!lands[landId].exists, "Land already exists");

        lands[landId] = LandRecord({
            landId: landId,
            ownerCommitment: ownerCommitment,
            merkleRoot: merkleRoot,
            cidHash: cidHash,
            status: LandStatus.Registered,
            updatedAt: uint64(block.timestamp),
            exists: true
        });

        _storeMerkleRoot(merkleRoot);

        emit LandRegistered(landId, ownerCommitment, merkleRoot, cidHash, block.timestamp);
    }

    function approveTransfer(
        uint256 landId,
        uint256 newOwnerCommitment,
        uint256 newMerkleRoot,
        bytes32 newCidHash
    ) external onlyAuthority {
        LandRecord storage land = lands[landId];
        require(land.exists, "Land not found");
        require(land.status == LandStatus.Registered || land.status == LandStatus.Transferred, "Land not transferable");
        require(newOwnerCommitment != 0, "Invalid new commitment");
        require(newMerkleRoot != 0, "Invalid new root");

        uint256 oldOwnerCommitment = land.ownerCommitment;
        bytes32 transferKey = getTransferProofKey(landId, oldOwnerCommitment, newOwnerCommitment);
        require(verifiedTransfers[transferKey], "Valid proof required");
        delete verifiedTransfers[transferKey];

        land.ownerCommitment = newOwnerCommitment;
        land.merkleRoot = newMerkleRoot;
        land.cidHash = newCidHash;
        land.status = LandStatus.Transferred;
        land.updatedAt = uint64(block.timestamp);

        _storeMerkleRoot(newMerkleRoot);

        emit LandTransferred(
            landId,
            oldOwnerCommitment,
            newOwnerCommitment,
            newMerkleRoot,
            newCidHash,
            block.timestamp
        );
    }

    function verifyOwnership(
        uint[2] calldata proofA,
        uint[2][2] calldata proofB,
        uint[2] calldata proofC,
        uint256 landId,
        uint256 ownerCommitment,
        uint256 transferCommitment
    ) external returns (bool) {
        LandRecord storage land = lands[landId];
        require(land.exists, "Land not found");
        require(land.ownerCommitment == ownerCommitment, "Commitment mismatch");

        uint[3] memory publicSignals = [landId, ownerCommitment, transferCommitment];
        bool valid = verifier.verifyProof(proofA, proofB, proofC, publicSignals);
        bytes32 proofHash = keccak256(abi.encode(landId, ownerCommitment, transferCommitment, proofA, proofB, proofC));
        verifiedProofs[proofHash] = valid;

        if (valid) {
            verifiedTransfers[getTransferProofKey(landId, ownerCommitment, transferCommitment)] = true;
        }

        emit OwnershipProofVerified(landId, ownerCommitment, transferCommitment, valid, block.timestamp);
        return valid;
    }

    function getTransferProofKey(
        uint256 landId,
        uint256 ownerCommitment,
        uint256 transferCommitment
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(landId, ownerCommitment, transferCommitment));
    }

    function suspendLand(uint256 landId) external onlyAuthority {
        LandRecord storage land = lands[landId];
        require(land.exists, "Land not found");
        land.status = LandStatus.Suspended;
        land.updatedAt = uint64(block.timestamp);
        emit LandSuspended(landId, block.timestamp);
    }

    function getLand(uint256 landId)
        external
        view
        returns (
            uint256 ownerCommitment,
            uint256 merkleRoot,
            bytes32 cidHash,
            LandStatus status,
            uint64 updatedAt,
            bool exists
        )
    {
        LandRecord storage land = lands[landId];
        return (
            land.ownerCommitment,
            land.merkleRoot,
            land.cidHash,
            land.status,
            land.updatedAt,
            land.exists
        );
    }
}

interface IVerifier {
    function verifyProof(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[3] calldata input
    ) external view returns (bool);
}
