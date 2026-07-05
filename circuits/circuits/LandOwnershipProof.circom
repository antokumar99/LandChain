pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";

template LandOwnershipProof() {
    signal input landId;
    signal input ownerSecret;
    signal input newOwner;
    signal input transferNonce;
    signal input ownerCommitment;
    signal input transferCommitment;

    component ownerHasher = Poseidon(2);
    ownerHasher.inputs[0] <== landId;
    ownerHasher.inputs[1] <== ownerSecret;
    ownerCommitment === ownerHasher.out;

    component transferHasher = Poseidon(2);
    transferHasher.inputs[0] <== landId;
    transferHasher.inputs[1] <== newOwner;
    transferCommitment === transferHasher.out;

    transferNonce === transferNonce;
}

component main { public [landId, ownerCommitment, transferCommitment] } = LandOwnershipProof();
