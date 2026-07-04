// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MerkleRootStore {
    uint256 public latestMerkleRoot;
    mapping(uint256 => bool) public knownMerkleRoots;

    event MerkleRootStored(uint256 indexed merkleRoot, address indexed submittedBy, uint256 timestamp);

    function _storeMerkleRoot(uint256 merkleRoot) internal {
        require(merkleRoot != 0, "Invalid root");
        latestMerkleRoot = merkleRoot;
        knownMerkleRoots[merkleRoot] = true;
        emit MerkleRootStored(merkleRoot, msg.sender, block.timestamp);
    }
}
