pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";

template LandOwnershipProof() {
    signal input landId;
    signal input ownerSecret;
    signal input proofContext;
    signal input ownerCommitment;
    signal input proofCommitment;

    component ownerHasher = Poseidon(2);
    ownerHasher.inputs[0] <== landId;
    ownerHasher.inputs[1] <== ownerSecret;
    ownerCommitment === ownerHasher.out;

    component proofHasher = Poseidon(2);
    proofHasher.inputs[0] <== landId;
    proofHasher.inputs[1] <== proofContext;
    proofCommitment === proofHasher.out;
}

component main { public [landId, ownerCommitment, proofCommitment] } = LandOwnershipProof();
