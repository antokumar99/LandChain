// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * LandRegistry.sol
 *
 * Phase-1 public blockchain smart contract inspired by:
 * "A Blockchain-based Land Title Management System for Bangladesh"
 *
 * Main supported workflows:
 * 1. User/account registration by land office.
 * 2. Plot/Dag registration by land office.
 * 3. Initial Khatiyan/ROR registration by land office.
 * 4. Land sale agreement creation.
 * 5. Seller approval.
 * 6. Buyer pledge/payment.
 * 7. Final ROR/Khatiyan transfer after full payment.
 *
 * Notes:
 * - Do NOT store real NID, address, deed text, or private documents on-chain.
 *   Store hashes only: nidHash, metadataHash, documentHash, IPFS CID hash, etc.
 * - This contract uses native ETH as demo "land currency" escrow.
 * - For a production thesis extension, connect this contract with zk-SNARK verifier
 *   contracts and IPFS/private-chain anchoring.
 */
contract LandRegistry {
    uint16 public constant TOTAL_BPS = 10_000;

    address public superAdmin;

    mapping(address => bool) public admins;
    mapping(address => bool) public landOfficers;

    enum AgreementStatus {
        None,
        Created,
        SellersApproved,
        PledgePaid,
        FullyPaid,
        Transferred,
        Cancelled
    }

    struct User {
        address account;
        bytes32 nidHash;
        bytes32 metadataHash; // hash of full user info JSON/IPFS CID
        address createdBy;
        uint64 createdAt;
        bool exists;
    }

    struct Plot {
        bytes32 plotHash;
        bytes32 division;
        bytes32 district;
        bytes32 upazila;
        bytes32 mouzaNo;
        bytes32 jlNo;
        bytes32 plotNo;
        bytes32 geoHash;       // optional map/GPS/hash
        bytes32 metadataHash;  // hash of plot document JSON/IPFS CID
        address createdBy;
        uint64 createdAt;
        bool exists;
    }

    struct Khatiyan {
        bytes32 khatiyanHash;
        bytes32 khatiyanNo;
        bytes32 plotHash;
        bytes32 parentKhatiyanHash;
        address[] owners;
        uint16[] sharesBps;
        bytes32 documentHash;  // deed/mutation/khatiyan document hash or IPFS CID hash
        address createdBy;
        uint64 createdAt;
        bool active;
        bool lockedForSale;
        bool exists;
    }

    struct SaleAgreement {
        uint256 id;
        bytes32 khatiyanHash;
        bytes32 plotHash;

        address primaryBuyer;
        address[] sellers;
        uint16[] sellerSharesBps;

        address[] newOwners;
        uint16[] newOwnerSharesBps;

        uint256 totalPrice;
        uint256 pledgeAmount;
        uint256 escrowPaid;

        uint64 pledgeDeadline;
        uint64 finalPaymentDeadline;

        bytes32 agreementDocHash;
        bytes32 newKhatiyanNo;

        uint16 sellerApprovalCount;
        AgreementStatus status;

        address createdBy;
        uint64 createdAt;
    }

    mapping(address => User) public users;
    mapping(bytes32 => address) public nidHashToAccount;

    mapping(bytes32 => Plot) public plots;
    mapping(bytes32 => Khatiyan) private khatiyans;

    // Current active ROR for each plot in this prototype.
    mapping(bytes32 => bytes32) public currentKhatiyanByPlot;

    mapping(address => bytes32[]) private userKhatiyans;

    uint256 public agreementCounter;
    mapping(uint256 => SaleAgreement) private agreements;
    mapping(uint256 => mapping(address => bool)) public sellerApproved;

    mapping(address => uint256) public pendingWithdrawals;

    event AdminUpdated(address indexed admin, bool allowed);
    event LandOfficerUpdated(address indexed officer, bool allowed);

    event UserRegistered(address indexed account, bytes32 indexed nidHash, address indexed createdBy);
    event PlotRegistered(bytes32 indexed plotHash, bytes32 indexed plotNo, address indexed createdBy);
    event KhatiyanRegistered(
        bytes32 indexed khatiyanHash,
        bytes32 indexed plotHash,
        bytes32 indexed parentKhatiyanHash,
        address createdBy
    );

    event SaleAgreementCreated(
        uint256 indexed agreementId,
        bytes32 indexed khatiyanHash,
        address indexed primaryBuyer,
        uint256 totalPrice,
        uint256 pledgeAmount
    );

    event SaleApprovedBySeller(uint256 indexed agreementId, address indexed seller);
    event PledgePaid(uint256 indexed agreementId, address indexed buyer, uint256 amount);
    event FinalPaymentPaid(uint256 indexed agreementId, address indexed buyer, uint256 amount);
    event OwnershipTransferred(
        uint256 indexed agreementId,
        bytes32 indexed oldKhatiyanHash,
        bytes32 indexed newKhatiyanHash
    );
    event AgreementCancelled(uint256 indexed agreementId, string reason);
    event Withdrawal(address indexed account, uint256 amount);

    modifier onlySuperAdmin() {
        require(msg.sender == superAdmin, "Only super admin");
        _;
    }

    modifier onlyAdmin() {
        require(admins[msg.sender] || msg.sender == superAdmin, "Only admin");
        _;
    }

    modifier onlyLandOfficer() {
        require(landOfficers[msg.sender] || admins[msg.sender] || msg.sender == superAdmin, "Only land officer");
        _;
    }

    modifier onlyExistingUser(address account) {
        require(users[account].exists, "User does not exist");
        _;
    }

    constructor() {
        superAdmin = msg.sender;
        admins[msg.sender] = true;
        landOfficers[msg.sender] = true;
        emit AdminUpdated(msg.sender, true);
        emit LandOfficerUpdated(msg.sender, true);
    }

    // -----------------------------------------------------------------------
    // Role management
    // -----------------------------------------------------------------------

    function setAdmin(address admin, bool allowed) external onlySuperAdmin {
        require(admin != address(0), "Zero address");
        admins[admin] = allowed;
        emit AdminUpdated(admin, allowed);
    }

    function setLandOfficer(address officer, bool allowed) external onlyAdmin {
        require(officer != address(0), "Zero address");
        landOfficers[officer] = allowed;
        emit LandOfficerUpdated(officer, allowed);
    }

    // -----------------------------------------------------------------------
    // Hash helpers
    // -----------------------------------------------------------------------

    function computePlotHash(
        bytes32 division,
        bytes32 district,
        bytes32 upazila,
        bytes32 mouzaNo,
        bytes32 jlNo,
        bytes32 plotNo
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(division, district, upazila, mouzaNo, jlNo, plotNo));
    }

    function computeKhatiyanHash(
        bytes32 khatiyanNo,
        bytes32 plotHash
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(khatiyanNo, plotHash));
    }

    // Convert short text to bytes32 in frontend/tests:
    // ethers.encodeBytes32String("Dhaka")
    // For longer private data, hash it first:
    // ethers.keccak256(ethers.toUtf8Bytes("secret-data"))

    // -----------------------------------------------------------------------
    // User registration
    // -----------------------------------------------------------------------

    function registerUser(
        address account,
        bytes32 nidHash,
        bytes32 metadataHash
    ) external onlyLandOfficer {
        require(account != address(0), "Zero account");
        require(nidHash != bytes32(0), "Empty NID hash");
        require(!users[account].exists, "User already exists");
        require(nidHashToAccount[nidHash] == address(0), "NID already used");

        users[account] = User({
            account: account,
            nidHash: nidHash,
            metadataHash: metadataHash,
            createdBy: msg.sender,
            createdAt: uint64(block.timestamp),
            exists: true
        });

        nidHashToAccount[nidHash] = account;

        emit UserRegistered(account, nidHash, msg.sender);
    }

    function isUser(address account) external view returns (bool) {
        return users[account].exists;
    }

    // -----------------------------------------------------------------------
    // Plot/Dag registration
    // -----------------------------------------------------------------------

    function registerPlot(
        bytes32 division,
        bytes32 district,
        bytes32 upazila,
        bytes32 mouzaNo,
        bytes32 jlNo,
        bytes32 plotNo,
        bytes32 geoHash,
        bytes32 metadataHash
    ) external onlyLandOfficer returns (bytes32 plotHash) {
        plotHash = computePlotHash(division, district, upazila, mouzaNo, jlNo, plotNo);

        require(plotHash != bytes32(0), "Invalid plot hash");
        require(!plots[plotHash].exists, "Plot already exists");

        plots[plotHash] = Plot({
            plotHash: plotHash,
            division: division,
            district: district,
            upazila: upazila,
            mouzaNo: mouzaNo,
            jlNo: jlNo,
            plotNo: plotNo,
            geoHash: geoHash,
            metadataHash: metadataHash,
            createdBy: msg.sender,
            createdAt: uint64(block.timestamp),
            exists: true
        });

        emit PlotRegistered(plotHash, plotNo, msg.sender);
    }

    function isPlot(bytes32 plotHash) external view returns (bool) {
        return plots[plotHash].exists;
    }

    // -----------------------------------------------------------------------
    // Initial Khatiyan/ROR registration
    // -----------------------------------------------------------------------

    function registerInitialKhatiyan(
        bytes32 khatiyanNo,
        bytes32 plotHash,
        address[] calldata ownerAccounts,
        uint16[] calldata sharesBps,
        bytes32 documentHash
    ) external onlyLandOfficer returns (bytes32 khatiyanHash) {
        require(plots[plotHash].exists, "Plot does not exist");
        require(currentKhatiyanByPlot[plotHash] == bytes32(0), "Plot already has active Khatiyan");

        khatiyanHash = computeKhatiyanHash(khatiyanNo, plotHash);
        require(!khatiyans[khatiyanHash].exists, "Khatiyan already exists");

        _validateOwnersAndShares(ownerAccounts, sharesBps);

        _createKhatiyan(
            khatiyanHash,
            khatiyanNo,
            plotHash,
            bytes32(0),
            ownerAccounts,
            sharesBps,
            documentHash
        );

        currentKhatiyanByPlot[plotHash] = khatiyanHash;
    }

    // -----------------------------------------------------------------------
    // Sale / buy workflow
    // -----------------------------------------------------------------------

    /**
     * Land officer creates agreement after checking real-world documents.
     *
     * Workflow:
     * 1. Officer creates agreement.
     * 2. All current owners/sellers approve.
     * 3. Buyer pays pledge, or directly pays full amount when pledgeAmount = 0.
     * 4. Buyer pays remaining amount before final deadline.
     * 5. Officer finalizes transfer and creates mutated/new Khatiyan.
     */
    function createSaleAgreement(
        bytes32 khatiyanHash,
        address primaryBuyer,
        address[] calldata newOwnerAccounts,
        uint16[] calldata newOwnerSharesBps,
        uint256 totalPrice,
        uint256 pledgeAmount,
        uint64 pledgeDeadline,
        uint64 finalPaymentDeadline,
        bytes32 agreementDocHash,
        bytes32 newKhatiyanNo
    )
        external
        onlyLandOfficer
        onlyExistingUser(primaryBuyer)
        returns (uint256 agreementId)
    {
        Khatiyan storage oldK = khatiyans[khatiyanHash];

        require(oldK.exists, "Khatiyan does not exist");
        require(oldK.active, "Khatiyan is not active");
        require(!oldK.lockedForSale, "Khatiyan already locked");
        require(totalPrice > 0, "Price must be positive");
        require(pledgeAmount <= totalPrice, "Pledge exceeds price");
        require(finalPaymentDeadline > block.timestamp, "Invalid final deadline");

        if (pledgeAmount > 0) {
            require(pledgeDeadline > block.timestamp, "Invalid pledge deadline");
            require(pledgeDeadline <= finalPaymentDeadline, "Pledge deadline after final deadline");
        }

        _validateOwnersAndShares(newOwnerAccounts, newOwnerSharesBps);

        bytes32 newKhatiyanHash = computeKhatiyanHash(newKhatiyanNo, oldK.plotHash);
        require(!khatiyans[newKhatiyanHash].exists, "New Khatiyan already exists");

        oldK.lockedForSale = true;

        agreementCounter++;
        agreementId = agreementCounter;

        SaleAgreement storage ag = agreements[agreementId];
        ag.id = agreementId;
        ag.khatiyanHash = khatiyanHash;
        ag.plotHash = oldK.plotHash;
        ag.primaryBuyer = primaryBuyer;
        ag.totalPrice = totalPrice;
        ag.pledgeAmount = pledgeAmount;
        ag.pledgeDeadline = pledgeDeadline;
        ag.finalPaymentDeadline = finalPaymentDeadline;
        ag.agreementDocHash = agreementDocHash;
        ag.newKhatiyanNo = newKhatiyanNo;
        ag.status = AgreementStatus.Created;
        ag.createdBy = msg.sender;
        ag.createdAt = uint64(block.timestamp);

        for (uint256 i = 0; i < oldK.owners.length; i++) {
            ag.sellers.push(oldK.owners[i]);
            ag.sellerSharesBps.push(oldK.sharesBps[i]);
        }

        for (uint256 i = 0; i < newOwnerAccounts.length; i++) {
            ag.newOwners.push(newOwnerAccounts[i]);
            ag.newOwnerSharesBps.push(newOwnerSharesBps[i]);
        }

        emit SaleAgreementCreated(agreementId, khatiyanHash, primaryBuyer, totalPrice, pledgeAmount);
    }

    function approveSaleAsSeller(uint256 agreementId) external {
        SaleAgreement storage ag = agreements[agreementId];

        require(ag.status == AgreementStatus.Created, "Agreement not approvable");
        require(_isSeller(ag, msg.sender), "Caller is not seller");
        require(!sellerApproved[agreementId][msg.sender], "Already approved");

        sellerApproved[agreementId][msg.sender] = true;
        ag.sellerApprovalCount++;

        emit SaleApprovedBySeller(agreementId, msg.sender);

        if (ag.sellerApprovalCount == ag.sellers.length) {
            ag.status = AgreementStatus.SellersApproved;
        }
    }

    function buyerPayPledge(uint256 agreementId) external payable {
        SaleAgreement storage ag = agreements[agreementId];

        require(ag.status == AgreementStatus.SellersApproved, "Sellers not approved");
        require(msg.sender == ag.primaryBuyer, "Only primary buyer");
        require(ag.pledgeAmount > 0, "No pledge required");
        require(block.timestamp <= ag.pledgeDeadline, "Pledge deadline passed");
        require(msg.value == ag.pledgeAmount, "Incorrect pledge amount");

        ag.escrowPaid += msg.value;
        ag.status = AgreementStatus.PledgePaid;

        emit PledgePaid(agreementId, msg.sender, msg.value);
    }

    function buyerPayRemaining(uint256 agreementId) external payable {
        SaleAgreement storage ag = agreements[agreementId];

        require(msg.sender == ag.primaryBuyer, "Only primary buyer");
        require(
            ag.status == AgreementStatus.PledgePaid ||
            (ag.status == AgreementStatus.SellersApproved && ag.pledgeAmount == 0),
            "Payment not allowed"
        );
        require(block.timestamp <= ag.finalPaymentDeadline, "Final deadline passed");
        require(ag.escrowPaid < ag.totalPrice, "Already fully paid");

        uint256 remaining = ag.totalPrice - ag.escrowPaid;
        require(msg.value == remaining, "Incorrect remaining amount");

        ag.escrowPaid += msg.value;
        ag.status = AgreementStatus.FullyPaid;

        emit FinalPaymentPaid(agreementId, msg.sender, msg.value);
    }

    /**
     * Final ROR/Khatiyan mutation after full payment.
     * This does not directly transfer ETH to sellers; it credits withdrawable balances.
     */
    function finalizeTransfer(
        uint256 agreementId,
        bytes32 newDocumentHash
    ) external onlyLandOfficer returns (bytes32 newKhatiyanHash) {
        SaleAgreement storage ag = agreements[agreementId];
        require(ag.status == AgreementStatus.FullyPaid, "Agreement not fully paid");

        Khatiyan storage oldK = khatiyans[ag.khatiyanHash];
        require(oldK.exists && oldK.active, "Old Khatiyan inactive");

        newKhatiyanHash = computeKhatiyanHash(ag.newKhatiyanNo, ag.plotHash);
        require(!khatiyans[newKhatiyanHash].exists, "New Khatiyan already exists");

        oldK.active = false;
        oldK.lockedForSale = false;

        _createKhatiyan(
            newKhatiyanHash,
            ag.newKhatiyanNo,
            ag.plotHash,
            ag.khatiyanHash,
            ag.newOwners,
            ag.newOwnerSharesBps,
            newDocumentHash
        );

        currentKhatiyanByPlot[ag.plotHash] = newKhatiyanHash;
        ag.status = AgreementStatus.Transferred;

        _creditSellers(ag);

        emit OwnershipTransferred(agreementId, ag.khatiyanHash, newKhatiyanHash);
    }

    function cancelExpiredAgreement(uint256 agreementId) external {
        SaleAgreement storage ag = agreements[agreementId];

        require(
            ag.status == AgreementStatus.Created ||
            ag.status == AgreementStatus.SellersApproved ||
            ag.status == AgreementStatus.PledgePaid,
            "Agreement cannot be cancelled here"
        );

        bool expiredBeforePledge =
            (ag.status == AgreementStatus.Created || ag.status == AgreementStatus.SellersApproved) &&
            ag.pledgeAmount > 0 &&
            block.timestamp > ag.pledgeDeadline;

        bool expiredBeforeFullPayment =
            ag.status == AgreementStatus.PledgePaid &&
            block.timestamp > ag.finalPaymentDeadline;

        bool noPledgeExpiredBeforeFullPayment =
            ag.status == AgreementStatus.SellersApproved &&
            ag.pledgeAmount == 0 &&
            block.timestamp > ag.finalPaymentDeadline;

        require(
            expiredBeforePledge || expiredBeforeFullPayment || noPledgeExpiredBeforeFullPayment,
            "Agreement not expired"
        );

        _cancelAgreement(ag, "Expired");
    }

    function cancelAgreementByOfficer(uint256 agreementId, string calldata reason) external onlyLandOfficer {
        SaleAgreement storage ag = agreements[agreementId];

        require(
            ag.status == AgreementStatus.Created ||
            ag.status == AgreementStatus.SellersApproved,
            "Officer can cancel only before buyer payment"
        );

        _cancelAgreement(ag, reason);
    }

    // -----------------------------------------------------------------------
    // Withdraw escrow/redeposits
    // -----------------------------------------------------------------------

    function withdraw() external {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");

        pendingWithdrawals[msg.sender] = 0;

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Withdraw failed");

        emit Withdrawal(msg.sender, amount);
    }

    // -----------------------------------------------------------------------
    // Read functions
    // -----------------------------------------------------------------------

    function getKhatiyan(bytes32 khatiyanHash)
        external
        view
        returns (
            bytes32 khatiyanNo,
            bytes32 plotHash,
            bytes32 parentKhatiyanHash,
            bytes32 documentHash,
            bool active,
            bool lockedForSale,
            address createdBy,
            uint64 createdAt
        )
    {
        Khatiyan storage k = khatiyans[khatiyanHash];
        require(k.exists, "Khatiyan does not exist");

        return (
            k.khatiyanNo,
            k.plotHash,
            k.parentKhatiyanHash,
            k.documentHash,
            k.active,
            k.lockedForSale,
            k.createdBy,
            k.createdAt
        );
    }

    function getKhatiyanOwners(bytes32 khatiyanHash)
        external
        view
        returns (address[] memory owners, uint16[] memory sharesBps)
    {
        Khatiyan storage k = khatiyans[khatiyanHash];
        require(k.exists, "Khatiyan does not exist");

        return (k.owners, k.sharesBps);
    }

    function getUserKhatiyans(address account) external view returns (bytes32[] memory) {
        return userKhatiyans[account];
    }

    function getAgreementBasic(uint256 agreementId)
        external
        view
        returns (
            bytes32 khatiyanHash,
            bytes32 plotHash,
            address primaryBuyer,
            uint256 totalPrice,
            uint256 pledgeAmount,
            uint256 escrowPaid,
            uint64 pledgeDeadline,
            uint64 finalPaymentDeadline,
            bytes32 agreementDocHash,
            bytes32 newKhatiyanNo,
            uint16 sellerApprovalCount,
            AgreementStatus status,
            address createdBy,
            uint64 createdAt
        )
    {
        SaleAgreement storage ag = agreements[agreementId];
        require(ag.id != 0, "Agreement does not exist");

        return (
            ag.khatiyanHash,
            ag.plotHash,
            ag.primaryBuyer,
            ag.totalPrice,
            ag.pledgeAmount,
            ag.escrowPaid,
            ag.pledgeDeadline,
            ag.finalPaymentDeadline,
            ag.agreementDocHash,
            ag.newKhatiyanNo,
            ag.sellerApprovalCount,
            ag.status,
            ag.createdBy,
            ag.createdAt
        );
    }

    function getAgreementSellers(uint256 agreementId)
        external
        view
        returns (address[] memory sellers, uint16[] memory sellerSharesBps)
    {
        SaleAgreement storage ag = agreements[agreementId];
        require(ag.id != 0, "Agreement does not exist");

        return (ag.sellers, ag.sellerSharesBps);
    }

    function getAgreementNewOwners(uint256 agreementId)
        external
        view
        returns (address[] memory newOwners, uint16[] memory newOwnerSharesBps)
    {
        SaleAgreement storage ag = agreements[agreementId];
        require(ag.id != 0, "Agreement does not exist");

        return (ag.newOwners, ag.newOwnerSharesBps);
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    function _validateOwnersAndShares(
        address[] calldata ownerAccounts,
        uint16[] calldata sharesBps
    ) internal view {
        require(ownerAccounts.length > 0, "No owners");
        require(ownerAccounts.length == sharesBps.length, "Length mismatch");

        uint256 total;

        for (uint256 i = 0; i < ownerAccounts.length; i++) {
            require(users[ownerAccounts[i]].exists, "Owner user missing");
            require(sharesBps[i] > 0, "Zero share");
            total += sharesBps[i];

            for (uint256 j = i + 1; j < ownerAccounts.length; j++) {
                require(ownerAccounts[i] != ownerAccounts[j], "Duplicate owner");
            }
        }

        require(total == TOTAL_BPS, "Shares must equal 10000");
    }

    function _createKhatiyan(
        bytes32 khatiyanHash,
        bytes32 khatiyanNo,
        bytes32 plotHash,
        bytes32 parentKhatiyanHash,
        address[] memory ownerAccounts,
        uint16[] memory sharesBps,
        bytes32 documentHash
    ) internal {
        Khatiyan storage k = khatiyans[khatiyanHash];

        k.khatiyanHash = khatiyanHash;
        k.khatiyanNo = khatiyanNo;
        k.plotHash = plotHash;
        k.parentKhatiyanHash = parentKhatiyanHash;
        k.documentHash = documentHash;
        k.createdBy = msg.sender;
        k.createdAt = uint64(block.timestamp);
        k.active = true;
        k.lockedForSale = false;
        k.exists = true;

        for (uint256 i = 0; i < ownerAccounts.length; i++) {
            k.owners.push(ownerAccounts[i]);
            k.sharesBps.push(sharesBps[i]);
            userKhatiyans[ownerAccounts[i]].push(khatiyanHash);
        }

        emit KhatiyanRegistered(khatiyanHash, plotHash, parentKhatiyanHash, msg.sender);
    }

    function _isSeller(SaleAgreement storage ag, address account) internal view returns (bool) {
        for (uint256 i = 0; i < ag.sellers.length; i++) {
            if (ag.sellers[i] == account) {
                return true;
            }
        }
        return false;
    }

    function _creditSellers(SaleAgreement storage ag) internal {
        uint256 remaining = ag.escrowPaid;

        for (uint256 i = 0; i < ag.sellers.length; i++) {
            uint256 amount;

            if (i == ag.sellers.length - 1) {
                amount = remaining;
            } else {
                amount = (ag.escrowPaid * ag.sellerSharesBps[i]) / TOTAL_BPS;
                remaining -= amount;
            }

            pendingWithdrawals[ag.sellers[i]] += amount;
        }
    }

    function _cancelAgreement(SaleAgreement storage ag, string memory reason) internal {
        require(ag.id != 0, "Agreement does not exist");

        Khatiyan storage k = khatiyans[ag.khatiyanHash];
        if (k.exists && k.active) {
            k.lockedForSale = false;
        }

        uint256 refund = ag.escrowPaid;
        ag.escrowPaid = 0;
        ag.status = AgreementStatus.Cancelled;

        if (refund > 0) {
            pendingWithdrawals[ag.primaryBuyer] += refund;
        }

        emit AgreementCancelled(ag.id, reason);
    }
}
