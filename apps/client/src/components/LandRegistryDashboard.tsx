"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type UserRole = "authority" | "user";
type ViewKey = "dashboard" | "registry" | "market" | "proofs" | "authority" | "explorer" | "audit";

type SessionUser = {
  id: string;
  name: string;
  email: string;
  identifier: string;
  role: UserRole;
};

type HealthResponse = {
  api: string;
  mongodb: string;
  chain: {
    blockNumber: number;
    contractAddress: string | null;
    latestMerkleRoot: string | null;
    authority?: {
      serverWallet: string;
      superAdmin: string;
      isAuthority: boolean;
      isSuperAdmin: boolean;
    };
  };
};

type AuthenticityRequest = {
  requestId: string;
  buyerUserId: string;
  buyerName: string;
  buyerIdentifier: string;
  buyerMessage: string;
  buyerChallenge: string;
  challengeField: string;
  status: "requested" | "proved";
  proofMs?: number;
  snarkjsVerified?: boolean;
  proofCommitment?: string;
  createdAt?: string;
  provedAt?: string;
};

type LandRecord = {
  id?: string;
  landId: string;
  chainLandId?: string;
  ownerName: string;
  ownerIdentifier: string;
  ownerUserId?: string;
  ownerSecret?: string;
  plotNumber?: string;
  location?: string;
  deedDocument?: string;
  deedHash?: string;
  ownerCommitment: string;
  merkleRoot?: string;
  transactionHash?: string;
  contractAddress?: string;
  registrationStatus?: "pending" | "approved" | "rejected";
  listedForSale?: boolean;
  salePrice?: string;
  saleCurrency?: string;
  authenticityRequests?: AuthenticityRequest[];
};

type AuthResponse = {
  user: SessionUser;
  underHood?: unknown;
};

type RegisterResponse = {
  land: LandRecord;
  generated: {
    ownerSecret: string;
    chainLandId: string;
    ownerCommitment: string;
    merkleRoot?: string;
    merkleRootHex?: string;
    cidHash: string;
  };
  approval?: {
    status: string;
    message?: string;
    approvedBy?: string;
  };
  underHood?: {
    steps?: string[];
  };
};

type ApprovalResponse = {
  land: LandRecord;
  generated?: {
    merkleRoot: string;
    merkleRootHex: string;
  };
  chain?: {
    transactionHash: string;
    blockNumber?: number;
    contractAddress: string;
    gasUsed?: string;
  };
  approval: {
    status: string;
    approvedBy?: string;
    message?: string;
  };
  underHood?: {
    steps?: string[];
  };
};

type SaleResponse = {
  land: LandRecord;
  underHood?: {
    steps?: string[];
  };
};

type AuthenticityResponse = {
  land: LandRecord;
  request: AuthenticityRequest;
  proof?: {
    snarkjsVerified: boolean;
    proofMs: number;
    landId: string;
    chainLandId: string;
    ownerCommitment: string;
    proofCommitment: string;
    buyerChallenge: string;
    challengeField?: string;
    publicSignals?: string[];
  };
  underHood?: {
    steps?: string[];
    secretSharedWithBuyer?: boolean;
    onlyOwnerCouldProve?: boolean;
  };
};

type BuyResponse = {
  land: LandRecord;
  generated: {
    newOwnerSecret: string;
    transferNonce: string;
    chainLandId: string;
    newOwnerCommitment: string;
    merkleRoot: string;
    merkleRootHex: string;
    cidHash: string;
  };
  proof: {
    snarkjsVerified: boolean;
    proofMs: number;
  };
  chain: {
    proof: {
      valid: boolean;
      transactionHash: string;
      gasUsed?: string;
    };
    transfer: {
      transactionHash: string;
      gasUsed?: string;
    };
  };
  metrics: {
    proofMs: number;
    proofGasUsed?: string;
    transferGasUsed?: string;
    totalGasUsed?: string;
  };
  underHood?: {
    steps?: string[];
  };
};

type ExplorerDecodedLog = {
  name: string;
  signature: string;
  args: Record<string, unknown>;
};

type ExplorerLog = {
  address: string;
  data: string;
  topics: string[];
  index: number;
  transactionIndex: number;
  transactionHash: string;
  blockHash: string;
  blockNumber: number;
  decoded?: ExplorerDecodedLog;
};

type ExplorerTransaction = {
  hash: string;
  from?: string;
  to?: string | null;
  nonce?: number;
  index?: number;
  value?: string;
  type?: number;
  chainId?: string;
  data?: string;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  blockHash?: string | null;
  blockNumber?: number | null;
  receipt: {
    status: number | null;
    gasUsed?: string;
    cumulativeGasUsed?: string;
    contractAddress: string | null;
    logsBloom: string;
  } | null;
  logs: ExplorerLog[];
  registryEvents: ExplorerLog[];
  touchesRegistry: boolean;
};

type ExplorerBlock = {
  number: number;
  hash: string | null;
  parentHash: string;
  nonce: string;
  timestamp: number;
  timestampIso: string;
  miner: string;
  difficulty?: string;
  gasLimit?: string;
  gasUsed?: string;
  baseFeePerGas?: string;
  extraData: string;
  transactionCount: number;
  transactions: ExplorerTransaction[];
  registryEvents: ExplorerLog[];
};

type ExplorerResponse = {
  network: {
    rpcUrl: string;
    latestBlockNumber: number;
    contractAddress: string | null;
    shownBlockCount: number;
  };
  blocks: ExplorerBlock[];
};

type Operation = {
  title: string;
  data: unknown;
};

type RegisterLandForm = {
  landId: string;
  ownerName: string;
  ownerNid: string;
  plotNumber: string;
  location: string;
  deedDocument: string;
};

type SellLandForm = {
  landId: string;
  price: string;
  saleCurrency: string;
  ownerSecret: string;
};

type BuyerCheckForm = {
  landId: string;
  message: string;
};

type BuyForm = {
  landId: string;
  authenticityRequestId: string;
};

type SellerProofForm = {
  landId: string;
  requestId: string;
  ownerSecret: string;
};

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const sessionKey = "landchain-session";

function shortHash(value?: string | null) {
  if (!value) {
    return "Pending";
  }

  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function formatBlockTime(value?: string) {
  if (!value) {
    return "Pending";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function roleLabel(role?: UserRole) {
  return role === "authority" ? "Authority" : "Citizen";
}

function statusTone(status?: LandRecord["registrationStatus"]) {
  if (status === "approved") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }

  if (status === "rejected") {
    return "bg-rose-50 text-rose-700 ring-rose-200";
  }

  return "bg-amber-50 text-amber-700 ring-amber-200";
}

function money(value?: string, currency?: string) {
  if (!value) {
    return "Not listed";
  }

  return `${value} ${currency ?? "BDT"}`;
}

function getSteps(operation: Operation | null) {
  const data = operation?.data;

  if (data && typeof data === "object" && "underHood" in data) {
    const underHood = (data as { underHood?: { steps?: string[] } }).underHood;

    return underHood?.steps ?? [];
  }

  return [];
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export default function LandRegistryDashboard() {
  const [session, setSession] = useState<SessionUser | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }

    const saved = window.localStorage.getItem(sessionKey);

    if (!saved) {
      return null;
    }

    try {
      return JSON.parse(saved) as SessionUser;
    } catch {
      window.localStorage.removeItem(sessionKey);
      return null;
    }
  });
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authForm, setAuthForm] = useState({
    name: "Rahim Uddin",
    email: "rahim@example.com",
    identifier: "1234567890",
    password: "password123",
    role: "user" as UserRole,
  });
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [lands, setLands] = useState<LandRecord[]>([]);
  const [explorer, setExplorer] = useState<ExplorerResponse | null>(null);
  const [selectedBlockNumber, setSelectedBlockNumber] = useState<number | null>(null);
  const [registerForm, setRegisterForm] = useState({
    landId: "L101",
    ownerName: "Rahim Uddin",
    ownerNid: "1234567890",
    plotNumber: "PLOT-17A",
    location: "Mirpur, Dhaka",
    deedDocument: "deed101.pdf",
  });
  const [sellForm, setSellForm] = useState({
    landId: "L101",
    price: "2500000",
    saleCurrency: "BDT",
    ownerSecret: "",
  });
  const [approvalForm, setApprovalForm] = useState({ landId: "L101" });
  const [buyerCheckForm, setBuyerCheckForm] = useState({
    landId: "L101",
    message: "Please prove you are the authentic owner before I buy this land.",
  });
  const [sellerProofForm, setSellerProofForm] = useState({
    landId: "L101",
    requestId: "",
    ownerSecret: "",
  });
  const [buyForm, setBuyForm] = useState({
    landId: "L101",
    authenticityRequestId: "",
  });
  const [registerResult, setRegisterResult] = useState<RegisterResponse | null>(null);
  const [approvalResult, setApprovalResult] = useState<ApprovalResponse | null>(null);
  const [saleResult, setSaleResult] = useState<SaleResponse | null>(null);
  const [authenticityResult, setAuthenticityResult] = useState<AuthenticityResponse | null>(null);
  const [buyResult, setBuyResult] = useState<BuyResponse | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [error, setError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [sellLoading, setSellLoading] = useState(false);
  const [sellerProofLoading, setSellerProofLoading] = useState(false);
  const [authenticityLoading, setAuthenticityLoading] = useState(false);
  const [buyLoading, setBuyLoading] = useState(false);
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(true);

  const authHeaders = useCallback(
    (json = false, viewer = session) => {
      const headers: Record<string, string> = {};

      if (json) {
        headers["Content-Type"] = "application/json";
      }

      if (viewer) {
        headers["x-landchain-user-id"] = viewer.id;
      }

      return headers;
    },
    [session],
  );

  const fetchExplorer = useCallback(async () => {
    setExplorerLoading(true);

    try {
      const response = await fetch(`${apiBase}/api/explorer?count=8`, { cache: "no-store" });
      const data = (await response.json()) as ExplorerResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Block explorer request failed");
      }

      setExplorer(data);
      setSelectedBlockNumber((current) => {
        const latestBlock = data.blocks[0];

        if (current !== null && data.blocks.some((block) => block.number === current)) {
          return current;
        }

        return latestBlock?.number ?? null;
      });
    } catch (caught) {
      setExplorer(null);
      setError(caught instanceof Error ? caught.message : "Unable to load block explorer");
    } finally {
      setExplorerLoading(false);
    }
  }, []);

  const refresh = useCallback(
    async (viewer = session) => {
      setRefreshing(true);

      try {
        const healthResponse = await fetch(`${apiBase}/health`, { cache: "no-store" });

        if (!healthResponse.ok) {
          throw new Error("Backend health check failed");
        }

        setHealth((await healthResponse.json()) as HealthResponse);

        const landsResponse = await fetch(`${apiBase}/api/lands`, {
          cache: "no-store",
          headers: authHeaders(false, viewer),
        });

        if (landsResponse.ok) {
          const landsData = (await landsResponse.json()) as { lands: LandRecord[] };
          setLands(landsData.lands);
        } else {
          const landsError = (await landsResponse.json()) as { error?: string };
          setLands([]);
          setError(landsError.error ?? "Land list request failed");
        }
      } catch (caught) {
        setHealth(null);
        setError(caught instanceof Error ? caught.message : "Unable to reach backend");
      } finally {
        setRefreshing(false);
      }
    },
    [authHeaders, session],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (activeView === "explorer") {
      let mounted = true;
      const initExplorer = async () => {
        if (mounted) {
          await fetchExplorer();
        }
      };
      void initExplorer();
      return () => {
        mounted = false;
      };
    }
  }, [activeView, fetchExplorer]);

  const myLands = useMemo(
    () => lands.filter((land) => session && land.ownerUserId === session.id),
    [lands, session],
  );
  const listedLands = useMemo(
    () => lands.filter((land) => land.listedForSale && land.ownerUserId !== session?.id),
    [lands, session],
  );
  const pendingLands = useMemo(
    () => lands.filter((land) => land.registrationStatus === "pending"),
    [lands],
  );
  const sellerRequests = useMemo(
    () =>
      myLands.flatMap((land) =>
        (land.authenticityRequests ?? []).map((request) => ({ land, request })),
      ),
    [myLands],
  );
  const buyerRequests = useMemo(
    () =>
      lands.flatMap((land) =>
        (land.authenticityRequests ?? [])
          .filter((request) => request.buyerUserId === session?.id)
          .map((request) => ({ land, request })),
      ),
    [lands, session],
  );
  const traceSteps = useMemo(() => getSteps(operation), [operation]);

  const navItems = useMemo(
    () =>
      [
        { key: "dashboard" as const, label: "Dashboard" },
        { key: "registry" as const, label: "Land Desk" },
        { key: "market" as const, label: "Market" },
        { key: "proofs" as const, label: "Proof Inbox" },
        session?.role === "authority" ? { key: "authority" as const, label: "Authority" } : null,
        { key: "explorer" as const, label: "Explorer" },
        { key: "audit" as const, label: "Audit" },
      ].filter(Boolean) as Array<{ key: ViewKey; label: string }>,
    [session],
  );

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthLoading(true);
    setError("");

    try {
      const endpoint = authMode === "login" ? "login" : "register";
      const payload =
        authMode === "login"
          ? { email: authForm.email, password: authForm.password }
          : authForm;
      const response = await fetch(`${apiBase}/api/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as AuthResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Authentication failed");
      }

      setSession(data.user);
      setActiveView("dashboard");
      window.localStorage.setItem(sessionKey, JSON.stringify(data.user));
      setOperation({ title: `${roleLabel(data.user.role)} signed in`, data });
      await refresh(data.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication failed");
    } finally {
      setAuthLoading(false);
    }
  }

  function logout() {
    setSession(null);
    setActiveView("dashboard");
    window.localStorage.removeItem(sessionKey);
    setOperation({ title: "Signed out", data: { session: null } });
  }

  async function submitLand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRegisterLoading(true);
    setError("");
    setRegisterResult(null);

    try {
      if (!session) {
        throw new Error("Login first");
      }

      const response = await fetch(`${apiBase}/api/lands/register`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({
          ...registerForm,
          ownerIdentifier: registerForm.ownerNid,
          metadata: {
            submittedBy: session.name,
            submittedByRole: session.role,
          },
        }),
      });
      const data = (await response.json()) as RegisterResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Registration failed");
      }

      setRegisterResult(data);
      setSellForm((current) => ({
        ...current,
        landId: data.land.landId,
        ownerSecret: data.generated.ownerSecret,
      }));
      setApprovalForm({ landId: data.land.landId });
      setBuyerCheckForm((current) => ({ ...current, landId: data.land.landId }));
      setSellerProofForm((current) => ({
        ...current,
        landId: data.land.landId,
        ownerSecret: data.generated.ownerSecret,
      }));
      setBuyForm((current) => ({ ...current, landId: data.land.landId }));
      setOperation({ title: "Land application submitted", data });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Registration failed");
    } finally {
      setRegisterLoading(false);
    }
  }

  async function submitApproval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApprovalLoading(true);
    setError("");
    setApprovalResult(null);

    try {
      if (!session) {
        throw new Error("Login first");
      }

      const response = await fetch(
        `${apiBase}/api/lands/${encodeURIComponent(approvalForm.landId)}/approve`,
        {
          method: "POST",
          headers: authHeaders(true),
          body: JSON.stringify({}),
        },
      );
      const data = (await response.json()) as ApprovalResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Approval failed");
      }

      setApprovalResult(data);
      setOperation({ title: "Land approved on chain", data });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Approval failed");
    } finally {
      setApprovalLoading(false);
    }
  }

  async function submitSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSellLoading(true);
    setError("");
    setSaleResult(null);

    try {
      if (!session) {
        throw new Error("Login first");
      }

      const response = await fetch(`${apiBase}/api/lands/${encodeURIComponent(sellForm.landId)}/sell`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({
          price: sellForm.price,
          saleCurrency: sellForm.saleCurrency,
          ownerSecret: sellForm.ownerSecret,
        }),
      });
      const data = (await response.json()) as SaleResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Sale listing failed");
      }

      setSaleResult(data);
      setBuyerCheckForm((current) => ({ ...current, landId: data.land.landId }));
      setSellerProofForm((current) => ({
        ...current,
        landId: data.land.landId,
        ownerSecret: sellForm.ownerSecret,
      }));
      setBuyForm((current) => ({ ...current, landId: data.land.landId }));
      setOperation({ title: "Land listed for sale", data });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sale listing failed");
    } finally {
      setSellLoading(false);
    }
  }

  async function submitAuthenticity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthenticityLoading(true);
    setError("");
    setAuthenticityResult(null);

    try {
      if (!session) {
        throw new Error("Login first");
      }

      const response = await fetch(
        `${apiBase}/api/lands/${encodeURIComponent(buyerCheckForm.landId)}/auth-requests`,
        {
          method: "POST",
          headers: authHeaders(true),
          body: JSON.stringify({ message: buyerCheckForm.message }),
        },
      );
      const data = (await response.json()) as AuthenticityResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Authenticity request failed");
      }

      setAuthenticityResult(data);
      setSellerProofForm((current) => ({
        ...current,
        landId: data.land.landId,
        requestId: data.request.requestId,
      }));
      setBuyForm({
        landId: data.land.landId,
        authenticityRequestId: data.request.requestId,
      });
      setOperation({ title: "Buyer requested seller proof", data });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authenticity request failed");
    } finally {
      setAuthenticityLoading(false);
    }
  }

  async function submitSellerProof(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSellerProofLoading(true);
    setError("");

    try {
      if (!session) {
        throw new Error("Login first");
      }

      const response = await fetch(
        `${apiBase}/api/lands/${encodeURIComponent(
          sellerProofForm.landId,
        )}/auth-requests/${encodeURIComponent(sellerProofForm.requestId)}/prove`,
        {
          method: "POST",
          headers: authHeaders(true),
          body: JSON.stringify({ ownerSecret: sellerProofForm.ownerSecret }),
        },
      );
      const data = (await response.json()) as AuthenticityResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Seller proof failed");
      }

      setAuthenticityResult(data);
      setBuyForm({
        landId: data.land.landId,
        authenticityRequestId: data.request.requestId,
      });
      setOperation({ title: "Seller sent zero-knowledge proof", data });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Seller proof failed");
    } finally {
      setSellerProofLoading(false);
    }
  }

  async function submitBuy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBuyLoading(true);
    setError("");
    setBuyResult(null);

    try {
      if (!session) {
        throw new Error("Login first");
      }

      const response = await fetch(`${apiBase}/api/lands/${encodeURIComponent(buyForm.landId)}/buy`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({
          authenticityRequestId: buyForm.authenticityRequestId,
        }),
      });
      const data = (await response.json()) as BuyResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Purchase failed");
      }

      setBuyResult(data);
      setOperation({ title: "Land transferred to buyer", data });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Purchase failed");
    } finally {
      setBuyLoading(false);
    }
  }

  function selectLandForSale(land: LandRecord) {
    setSellForm({
      landId: land.landId,
      price: land.salePrice ?? "2500000",
      saleCurrency: land.saleCurrency ?? "BDT",
      ownerSecret: land.ownerSecret ?? sellForm.ownerSecret,
    });
    setActiveView("registry");
  }

  function selectMarketLand(land: LandRecord) {
    const request = land.authenticityRequests?.find((entry) => entry.buyerUserId === session?.id);

    setBuyerCheckForm((current) => ({ ...current, landId: land.landId }));
    setBuyForm({
      landId: land.landId,
      authenticityRequestId: request?.requestId ?? buyForm.authenticityRequestId,
    });
    setActiveView("market");
  }

  function selectProofRequest(land: LandRecord, request: AuthenticityRequest) {
    setSellerProofForm({
      landId: land.landId,
      requestId: request.requestId,
      ownerSecret: land.ownerSecret ?? sellerProofForm.ownerSecret,
    });
    setActiveView("proofs");
  }

  function selectApproval(land: LandRecord) {
    setApprovalForm({ landId: land.landId });
    setActiveView("authority");
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-[#f4f2ec] px-4 py-6 text-[#18211f] sm:px-6 lg:px-10">
        <section className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl gap-6 lg:grid-cols-[1fr_420px]">
          <div className="flex flex-col justify-between rounded-lg border border-[#d8d2c6] bg-[#fffdf8] p-6 shadow-sm">
            <div>
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-md bg-[#123c3a] text-sm font-bold text-white">
                  LC
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#49605b]">LandChain Registry</p>
                  <h1 className="text-3xl font-semibold tracking-normal text-[#17211f] sm:text-4xl">
                    Secure land services for owners, buyers, and authorities.
                  </h1>
                </div>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-3">
                <Metric label="MongoDB" value={health?.mongodb ?? "Checking"} tone="teal" />
                <Metric label="Chain Block" value={health?.chain.blockNumber?.toString() ?? "Offline"} tone="indigo" />
                <Metric label="Authority" value={health?.chain.authority?.isAuthority ? "Ready" : "Pending"} tone="amber" />
              </div>
            </div>

            <div className="mt-10 grid gap-3 border-t border-[#e5dfd4] pt-5 text-sm text-[#526560] sm:grid-cols-3">
              <p>Authority approval</p>
              <p>Zero-knowledge ownership proof</p>
              <p>Gas and proof metrics</p>
            </div>
          </div>

          <AuthPanel
            authMode={authMode}
            authForm={authForm}
            authLoading={authLoading}
            error={error}
            onModeChange={setAuthMode}
            onFormChange={setAuthForm}
            onSubmit={submitAuth}
          />
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f4f2ec] text-[#18211f]">
      <header className="sticky top-0 z-20 border-b border-[#d8d2c6] bg-[#fffdf8]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-md bg-[#123c3a] text-sm font-bold text-white">
              LC
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-[#62736d]">LandChain Registry</p>
              <h1 className="text-xl font-semibold text-[#17211f]">Land Services Dashboard</h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label={roleLabel(session.role)} tone={session.role === "authority" ? "indigo" : "teal"} />
            <StatusPill label={health?.mongodb === "connected" ? "Atlas connected" : "Atlas offline"} tone="green" />
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-md border border-[#c9c2b5] px-3 py-2 text-sm font-semibold text-[#263532] transition hover:bg-[#ece7dc]"
            >
              {refreshing ? "Refreshing" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={logout}
              className="rounded-md bg-[#17211f] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#2b3d38]"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[220px_1fr] lg:px-8">
        <aside className="h-fit rounded-lg border border-[#d8d2c6] bg-[#fffdf8] p-2 shadow-sm">
          <div className="px-3 py-3">
            <p className="text-sm font-semibold text-[#17211f]">{session.name}</p>
            <p className="truncate text-xs text-[#62736d]">{session.email}</p>
          </div>
          <nav className="grid gap-1">
            {navItems.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveView(item.key)}
                className={cx(
                  "rounded-md px-3 py-2 text-left text-sm font-semibold transition",
                  activeView === item.key
                    ? "bg-[#123c3a] text-white"
                    : "text-[#465853] hover:bg-[#ece7dc]",
                )}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <section className="grid gap-5">
          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
              {error}
            </div>
          ) : null}

          {activeView === "dashboard" ? (
            <DashboardView
              session={session}
              health={health}
              lands={lands}
              myLands={myLands}
              pendingLands={pendingLands}
              listedLands={listedLands}
              sellerRequests={sellerRequests}
              buyerRequests={buyerRequests}
              operation={operation}
              onNavigate={setActiveView}
            />
          ) : null}

          {activeView === "registry" ? (
            <RegistryView
              myLands={myLands}
              registerForm={registerForm}
              sellForm={sellForm}
              registerResult={registerResult}
              saleResult={saleResult}
              registerLoading={registerLoading}
              sellLoading={sellLoading}
              onRegisterChange={setRegisterForm}
              onSellChange={setSellForm}
              onSubmitLand={submitLand}
              onSubmitSale={submitSale}
              onSelectForSale={selectLandForSale}
            />
          ) : null}

          {activeView === "market" ? (
            <MarketView
              listedLands={listedLands}
              buyerRequests={buyerRequests}
              buyerCheckForm={buyerCheckForm}
              buyForm={buyForm}
              authenticityResult={authenticityResult}
              buyResult={buyResult}
              authenticityLoading={authenticityLoading}
              buyLoading={buyLoading}
              onBuyerCheckChange={setBuyerCheckForm}
              onBuyChange={setBuyForm}
              onSubmitAuthenticity={submitAuthenticity}
              onSubmitBuy={submitBuy}
              onSelectMarketLand={selectMarketLand}
            />
          ) : null}

          {activeView === "proofs" ? (
            <ProofView
              sellerRequests={sellerRequests}
              sellerProofForm={sellerProofForm}
              authenticityResult={authenticityResult}
              sellerProofLoading={sellerProofLoading}
              onSellerProofChange={setSellerProofForm}
              onSubmitSellerProof={submitSellerProof}
              onSelectProofRequest={selectProofRequest}
            />
          ) : null}

          {activeView === "authority" && session.role === "authority" ? (
            <AuthorityView
              pendingLands={pendingLands}
              lands={lands}
              approvalForm={approvalForm}
              approvalResult={approvalResult}
              approvalLoading={approvalLoading}
              onApprovalChange={setApprovalForm}
              onSubmitApproval={submitApproval}
              onSelectApproval={selectApproval}
            />
          ) : null}

          {activeView === "explorer" ? (
            <ExplorerView
              explorer={explorer}
              loading={explorerLoading}
              selectedBlockNumber={selectedBlockNumber}
              onSelectBlock={setSelectedBlockNumber}
              onRefresh={fetchExplorer}
            />
          ) : null}

          {activeView === "audit" ? (
            <AuditView operation={operation} traceSteps={traceSteps} health={health} />
          ) : null}
        </section>
      </div>
    </main>
  );
}

function AuthPanel(props: {
  authMode: "login" | "register";
  authForm: {
    name: string;
    email: string;
    identifier: string;
    password: string;
    role: UserRole;
  };
  authLoading: boolean;
  error: string;
  onModeChange: (mode: "login" | "register") => void;
  onFormChange: (form: {
    name: string;
    email: string;
    identifier: string;
    password: string;
    role: UserRole;
  }) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { authMode, authForm, authLoading, error, onModeChange, onFormChange, onSubmit } = props;

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-[#d8d2c6] bg-[#fffdf8] p-5 shadow-sm">
      <div className="grid grid-cols-2 rounded-md bg-[#ece7dc] p-1">
        {(["login", "register"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onModeChange(mode)}
            className={cx(
              "rounded px-3 py-2 text-sm font-semibold capitalize transition",
              authMode === mode ? "bg-white text-[#17211f] shadow-sm" : "text-[#5f706a]",
            )}
          >
            {mode === "register" ? "Sign up" : "Sign in"}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-4">
        {authMode === "register" ? (
          <>
            <Field
              label="Full Name"
              value={authForm.name}
              onChange={(name) => onFormChange({ ...authForm, name })}
            />
            <Field
              label="NID or Authority ID"
              value={authForm.identifier}
              onChange={(identifier) => onFormChange({ ...authForm, identifier })}
            />
            <div>
              <Label>Account Type</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["user", "authority"] as const).map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => onFormChange({ ...authForm, role })}
                    className={cx(
                      "rounded-md border px-3 py-2 text-sm font-semibold transition",
                      authForm.role === role
                        ? "border-[#123c3a] bg-[#123c3a] text-white"
                        : "border-[#d8d2c6] bg-white text-[#465853] hover:bg-[#f3efe7]",
                    )}
                  >
                    {roleLabel(role)}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}

        <Field
          label="Email"
          value={authForm.email}
          type="email"
          onChange={(email) => onFormChange({ ...authForm, email })}
        />
        <Field
          label="Password"
          value={authForm.password}
          type="password"
          onChange={(password) => onFormChange({ ...authForm, password })}
        />

        {error ? <p className="rounded-md bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p> : null}

        <button
          type="submit"
          className="rounded-md bg-[#123c3a] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#1b514d]"
        >
          {authLoading ? "Please wait" : authMode === "register" ? "Create Account" : "Open Dashboard"}
        </button>
      </div>
    </form>
  );
}

function DashboardView(props: {
  session: SessionUser;
  health: HealthResponse | null;
  lands: LandRecord[];
  myLands: LandRecord[];
  pendingLands: LandRecord[];
  listedLands: LandRecord[];
  sellerRequests: Array<{ land: LandRecord; request: AuthenticityRequest }>;
  buyerRequests: Array<{ land: LandRecord; request: AuthenticityRequest }>;
  operation: Operation | null;
  onNavigate: (view: ViewKey) => void;
}) {
  const {
    session,
    health,
    lands,
    myLands,
    pendingLands,
    listedLands,
    sellerRequests,
    buyerRequests,
    operation,
    onNavigate,
  } = props;

  return (
    <div className="grid gap-5">
      <section className="rounded-lg border border-[#d8d2c6] bg-[#fffdf8] p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#62736d]">{roleLabel(session.role)} workspace</p>
            <h2 className="mt-1 text-2xl font-semibold text-[#17211f]">
              {session.role === "authority" ? "Authority approval desk" : "Ownership and transfer desk"}
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Records" value={lands.length.toString()} tone="indigo" />
            <Metric label="My Lands" value={myLands.length.toString()} tone="teal" />
            <Metric label="For Sale" value={listedLands.length.toString()} tone="amber" />
            <Metric label="Pending" value={pendingLands.length.toString()} tone="rose" />
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        <ActionCard
          title="Register Land"
          detail="Application intake"
          action="Start"
          onClick={() => onNavigate("registry")}
        />
        <ActionCard
          title="Marketplace"
          detail="Listings and buyer requests"
          action="Open"
          onClick={() => onNavigate("market")}
        />
        <ActionCard
          title="Proof Inbox"
          detail="Seller proof queue"
          action="Review"
          onClick={() => onNavigate("proofs")}
        />
        <ActionCard
          title="Block Explorer"
          detail="Blocks, transactions, and logs"
          action="Inspect"
          onClick={() => onNavigate("explorer")}
        />
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <Panel title="Live Network">
          <div className="grid gap-3 sm:grid-cols-2">
            <DataRow label="API" value={health?.api ?? "offline"} />
            <DataRow label="MongoDB" value={health?.mongodb ?? "offline"} />
            <DataRow label="Block" value={health?.chain.blockNumber?.toString() ?? "offline"} />
            <DataRow label="Contract" value={shortHash(health?.chain.contractAddress)} />
            <DataRow label="Merkle Root" value={shortHash(health?.chain.latestMerkleRoot)} wide />
            <DataRow
              label="Server Wallet"
              value={shortHash(health?.chain.authority?.serverWallet)}
              wide
            />
          </div>
        </Panel>

        <Panel title="Inbox">
          <div className="grid gap-3">
            <InboxRow label="Seller Requests" value={sellerRequests.length} />
            <InboxRow label="Buyer Requests" value={buyerRequests.length} />
            <InboxRow label="Last Action" value={operation?.title ?? "No action yet"} />
          </div>
        </Panel>
      </section>
    </div>
  );
}

function RegistryView(props: {
  myLands: LandRecord[];
  registerForm: {
    landId: string;
    ownerName: string;
    ownerNid: string;
    plotNumber: string;
    location: string;
    deedDocument: string;
  };
  sellForm: {
    landId: string;
    price: string;
    saleCurrency: string;
    ownerSecret: string;
  };
  registerResult: RegisterResponse | null;
  saleResult: SaleResponse | null;
  registerLoading: boolean;
  sellLoading: boolean;
  onRegisterChange: (form: RegisterLandForm) => void;
  onSellChange: (form: SellLandForm) => void;
  onSubmitLand: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitSale: (event: FormEvent<HTMLFormElement>) => void;
  onSelectForSale: (land: LandRecord) => void;
}) {
  const {
    myLands,
    registerForm,
    sellForm,
    registerResult,
    saleResult,
    registerLoading,
    sellLoading,
    onRegisterChange,
    onSellChange,
    onSubmitLand,
    onSubmitSale,
    onSelectForSale,
  } = props;

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
      <section className="grid gap-5">
        <Panel title="Register Land">
          <form onSubmit={onSubmitLand} className="grid gap-4 sm:grid-cols-2">
            <Field label="Land ID" value={registerForm.landId} onChange={(landId) => onRegisterChange({ ...registerForm, landId })} />
            <Field label="Owner" value={registerForm.ownerName} onChange={(ownerName) => onRegisterChange({ ...registerForm, ownerName })} />
            <Field label="Owner NID" value={registerForm.ownerNid} onChange={(ownerNid) => onRegisterChange({ ...registerForm, ownerNid })} />
            <Field label="Plot Number" value={registerForm.plotNumber} onChange={(plotNumber) => onRegisterChange({ ...registerForm, plotNumber })} />
            <Field label="Location" value={registerForm.location} onChange={(location) => onRegisterChange({ ...registerForm, location })} />
            <Field label="Deed Document" value={registerForm.deedDocument} onChange={(deedDocument) => onRegisterChange({ ...registerForm, deedDocument })} />
            <div className="sm:col-span-2">
              <PrimaryButton loading={registerLoading}>Submit Application</PrimaryButton>
            </div>
          </form>
        </Panel>

        <Panel title="My Land Records">
          <div className="grid gap-3">
            {myLands.length === 0 ? <EmptyState label="No land records for this account." /> : null}
            {myLands.map((land) => (
              <LandRow key={land.id ?? land.landId} land={land} action="Prepare Sale" onClick={() => onSelectForSale(land)} />
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid gap-5">
        <Panel title="List for Sale">
          <form onSubmit={onSubmitSale} className="grid gap-4">
            <Field label="Land ID" value={sellForm.landId} onChange={(landId) => onSellChange({ ...sellForm, landId })} />
            <Field label="Price" value={sellForm.price} onChange={(price) => onSellChange({ ...sellForm, price })} />
            <Field label="Currency" value={sellForm.saleCurrency} onChange={(saleCurrency) => onSellChange({ ...sellForm, saleCurrency })} />
            <Field
              label="Owner Secret"
              value={sellForm.ownerSecret}
              onChange={(ownerSecret) => onSellChange({ ...sellForm, ownerSecret })}
            />
            <PrimaryButton loading={sellLoading}>List Land</PrimaryButton>
          </form>
        </Panel>

        <ResultPanel
          title="Registry Output"
          data={registerResult ?? saleResult}
          fallback="Waiting for registry action."
        />
      </section>
    </div>
  );
}

function MarketView(props: {
  listedLands: LandRecord[];
  buyerRequests: Array<{ land: LandRecord; request: AuthenticityRequest }>;
  buyerCheckForm: {
    landId: string;
    message: string;
  };
  buyForm: {
    landId: string;
    authenticityRequestId: string;
  };
  authenticityResult: AuthenticityResponse | null;
  buyResult: BuyResponse | null;
  authenticityLoading: boolean;
  buyLoading: boolean;
  onBuyerCheckChange: (form: BuyerCheckForm) => void;
  onBuyChange: (form: BuyForm) => void;
  onSubmitAuthenticity: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitBuy: (event: FormEvent<HTMLFormElement>) => void;
  onSelectMarketLand: (land: LandRecord) => void;
}) {
  const {
    listedLands,
    buyerRequests,
    buyerCheckForm,
    buyForm,
    authenticityResult,
    buyResult,
    authenticityLoading,
    buyLoading,
    onBuyerCheckChange,
    onBuyChange,
    onSubmitAuthenticity,
    onSubmitBuy,
    onSelectMarketLand,
  } = props;

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
      <section className="grid gap-5">
        <Panel title="Available Land">
          <div className="grid gap-3">
            {listedLands.length === 0 ? <EmptyState label="No approved land is listed for sale." /> : null}
            {listedLands.map((land) => (
              <LandRow
                key={land.id ?? land.landId}
                land={land}
                action="Select"
                onClick={() => onSelectMarketLand(land)}
              />
            ))}
          </div>
        </Panel>

        <Panel title="My Buyer Requests">
          <div className="grid gap-3">
            {buyerRequests.length === 0 ? <EmptyState label="No buyer requests from this account." /> : null}
            {buyerRequests.map(({ land, request }) => (
              <RequestRow key={request.requestId} land={land} request={request} />
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid gap-5">
        <Panel title="Ask Seller">
          <form onSubmit={onSubmitAuthenticity} className="grid gap-4">
            <Field label="Land ID" value={buyerCheckForm.landId} onChange={(landId) => onBuyerCheckChange({ ...buyerCheckForm, landId })} />
            <TextArea
              label="Message"
              value={buyerCheckForm.message}
              onChange={(message) => onBuyerCheckChange({ ...buyerCheckForm, message })}
            />
            <PrimaryButton loading={authenticityLoading}>Send Request</PrimaryButton>
          </form>
        </Panel>

        <Panel title="Buy with Proof">
          <form onSubmit={onSubmitBuy} className="grid gap-4">
            <Field label="Land ID" value={buyForm.landId} onChange={(landId) => onBuyChange({ ...buyForm, landId })} />
            <Field
              label="Proof Request ID"
              value={buyForm.authenticityRequestId}
              onChange={(authenticityRequestId) => onBuyChange({ ...buyForm, authenticityRequestId })}
            />
            <PrimaryButton loading={buyLoading}>Complete Purchase</PrimaryButton>
          </form>
        </Panel>

        <ResultPanel
          title="Buyer Output"
          data={buyResult ?? authenticityResult}
          fallback="Waiting for buyer action."
        />
      </section>
    </div>
  );
}

function ProofView(props: {
  sellerRequests: Array<{ land: LandRecord; request: AuthenticityRequest }>;
  sellerProofForm: {
    landId: string;
    requestId: string;
    ownerSecret: string;
  };
  authenticityResult: AuthenticityResponse | null;
  sellerProofLoading: boolean;
  onSellerProofChange: (form: SellerProofForm) => void;
  onSubmitSellerProof: (event: FormEvent<HTMLFormElement>) => void;
  onSelectProofRequest: (land: LandRecord, request: AuthenticityRequest) => void;
}) {
  const {
    sellerRequests,
    sellerProofForm,
    authenticityResult,
    sellerProofLoading,
    onSellerProofChange,
    onSubmitSellerProof,
    onSelectProofRequest,
  } = props;

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
      <Panel title="Seller Requests">
        <div className="grid gap-3">
          {sellerRequests.length === 0 ? <EmptyState label="No buyer proof requests for your land." /> : null}
          {sellerRequests.map(({ land, request }) => (
            <RequestRow
              key={request.requestId}
              land={land}
              request={request}
              action="Answer"
              onClick={() => onSelectProofRequest(land, request)}
            />
          ))}
        </div>
      </Panel>

      <section className="grid gap-5">
        <Panel title="Send ZK Proof">
          <form onSubmit={onSubmitSellerProof} className="grid gap-4">
            <Field label="Land ID" value={sellerProofForm.landId} onChange={(landId) => onSellerProofChange({ ...sellerProofForm, landId })} />
            <Field
              label="Request ID"
              value={sellerProofForm.requestId}
              onChange={(requestId) => onSellerProofChange({ ...sellerProofForm, requestId })}
            />
            <Field
              label="Owner Secret"
              value={sellerProofForm.ownerSecret}
              onChange={(ownerSecret) => onSellerProofChange({ ...sellerProofForm, ownerSecret })}
            />
            <PrimaryButton loading={sellerProofLoading}>Generate Proof</PrimaryButton>
          </form>
        </Panel>

        <ResultPanel
          title="Proof Output"
          data={authenticityResult}
          fallback="Waiting for proof action."
        />
      </section>
    </div>
  );
}

function AuthorityView(props: {
  pendingLands: LandRecord[];
  lands: LandRecord[];
  approvalForm: {
    landId: string;
  };
  approvalResult: ApprovalResponse | null;
  approvalLoading: boolean;
  onApprovalChange: (form: { landId: string }) => void;
  onSubmitApproval: (event: FormEvent<HTMLFormElement>) => void;
  onSelectApproval: (land: LandRecord) => void;
}) {
  const {
    pendingLands,
    lands,
    approvalForm,
    approvalResult,
    approvalLoading,
    onApprovalChange,
    onSubmitApproval,
    onSelectApproval,
  } = props;

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
      <section className="grid gap-5">
        <Panel title="Pending Applications">
          <div className="grid gap-3">
            {pendingLands.length === 0 ? <EmptyState label="No pending applications." /> : null}
            {pendingLands.map((land) => (
              <LandRow
                key={land.id ?? land.landId}
                land={land}
                action="Review"
                onClick={() => onSelectApproval(land)}
              />
            ))}
          </div>
        </Panel>

        <Panel title="Registry Ledger">
          <div className="grid gap-3">
            {lands.map((land) => (
              <LandRow key={land.id ?? land.landId} land={land} />
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid gap-5">
        <Panel title="Approve Land">
          <form onSubmit={onSubmitApproval} className="grid gap-4">
            <Field
              label="Land ID"
              value={approvalForm.landId}
              onChange={(landId) => onApprovalChange({ landId })}
            />
            <PrimaryButton loading={approvalLoading}>Approve On Chain</PrimaryButton>
          </form>
        </Panel>

        <ResultPanel
          title="Authority Output"
          data={approvalResult}
          fallback="Waiting for authority action."
        />
      </section>
    </div>
  );
}

function ExplorerView(props: {
  explorer: ExplorerResponse | null;
  loading: boolean;
  selectedBlockNumber: number | null;
  onSelectBlock: (blockNumber: number) => void;
  onRefresh: () => Promise<void>;
}) {
  const { explorer, loading, selectedBlockNumber, onSelectBlock, onRefresh } = props;
  const selectedBlock =
    explorer?.blocks.find((block) => block.number === selectedBlockNumber) ??
    explorer?.blocks[0] ??
    null;
  const totalTransactions =
    explorer?.blocks.reduce((total, block) => total + block.transactionCount, 0) ?? 0;
  const totalRegistryEvents =
    explorer?.blocks.reduce((total, block) => total + block.registryEvents.length, 0) ?? 0;

  return (
    <div className="grid gap-5">
      <section className="rounded-lg border border-[#d8d2c6] bg-[#fffdf8] p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#62736d]">Public chain data</p>
            <h2 className="mt-1 text-2xl font-semibold text-[#17211f]">Block Explorer</h2>
          </div>
          <button
            type="button"
            onClick={() => void onRefresh()}
            className="min-h-11 rounded-md bg-[#17211f] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#2b3d38] disabled:cursor-not-allowed disabled:bg-[#8a9691]"
            disabled={loading}
          >
            {loading ? "Loading Blocks" : "Refresh Blocks"}
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Latest Block"
            value={explorer?.network.latestBlockNumber.toString() ?? "Offline"}
            tone="indigo"
          />
          <Metric label="Shown" value={explorer?.network.shownBlockCount.toString() ?? "0"} tone="teal" />
          <Metric label="Transactions" value={totalTransactions.toString()} tone="amber" />
          <Metric label="Registry Events" value={totalRegistryEvents.toString()} tone="rose" />
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <Panel title="Chain View">
          <div className="grid gap-3">
            {loading && !explorer ? <EmptyState label="Loading recent blocks." /> : null}
            {!loading && explorer?.blocks.length === 0 ? <EmptyState label="No blocks returned from the chain." /> : null}
            {explorer?.blocks.map((block, index) => (
              <BlockNode
                key={block.number}
                block={block}
                active={selectedBlock?.number === block.number}
                last={index === explorer.blocks.length - 1}
                onClick={() => onSelectBlock(block.number)}
              />
            ))}
          </div>
        </Panel>

        <section className="grid gap-5">
          <Panel title={selectedBlock ? `Block ${selectedBlock.number}` : "Block Details"}>
            {selectedBlock ? <BlockDetails block={selectedBlock} /> : <EmptyState label="Select a block." />}
          </Panel>

          <Panel title="Transactions">
            {selectedBlock ? <TransactionList transactions={selectedBlock.transactions} /> : <EmptyState label="Select a block." />}
          </Panel>
        </section>
      </section>
    </div>
  );
}

function BlockNode(props: {
  block: ExplorerBlock;
  active: boolean;
  last: boolean;
  onClick: () => void;
}) {
  const { block, active, last, onClick } = props;

  return (
    <div className="relative grid grid-cols-[48px_1fr] gap-3">
      <div className="relative flex justify-center">
        <span
          className={cx(
            "z-10 grid h-11 w-11 place-items-center rounded-md border text-xs font-bold",
            active
              ? "border-[#123c3a] bg-[#123c3a] text-white"
              : "border-[#9eafa8] bg-white text-[#263532]",
          )}
        >
          {block.number}
        </span>
        {!last ? <span className="absolute top-11 h-[calc(100%+0.75rem)] w-0.5 bg-[#aebdb7]" /> : null}
      </div>

      <button
        type="button"
        onClick={onClick}
        className={cx(
          "rounded-lg border p-4 text-left transition",
          active
            ? "border-[#123c3a] bg-[#edf7f3] shadow-sm"
            : "border-[#e2dbcf] bg-white hover:border-[#8aa29b] hover:shadow-sm",
        )}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#17211f]">Block {block.number}</p>
            <p className="mt-1 break-all text-xs text-[#62736d]">{block.hash}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <StatusPill label={`${block.transactionCount} tx`} tone={block.transactionCount > 0 ? "indigo" : "teal"} />
            {block.registryEvents.length > 0 ? (
              <StatusPill label={`${block.registryEvents.length} events`} tone="amber" />
            ) : null}
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <MiniData label="Time" value={formatBlockTime(block.timestampIso)} />
          <MiniData label="Gas" value={`${block.gasUsed ?? "0"} / ${block.gasLimit ?? "0"}`} />
        </div>
      </button>
    </div>
  );
}

function BlockDetails(props: { block: ExplorerBlock }) {
  const { block } = props;

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <DataRow label="Hash" value={block.hash ?? "Pending"} wide />
        <DataRow label="Parent Hash" value={block.parentHash} wide />
        <DataRow label="Timestamp" value={formatBlockTime(block.timestampIso)} />
        <DataRow label="Miner" value={shortHash(block.miner)} />
        <DataRow label="Gas Used" value={block.gasUsed ?? "0"} />
        <DataRow label="Gas Limit" value={block.gasLimit ?? "0"} />
        <DataRow label="Base Fee" value={block.baseFeePerGas ?? "0"} />
        <DataRow label="Nonce" value={block.nonce} />
      </div>

      {block.registryEvents.length > 0 ? (
        <div className="grid gap-2">
          <Label>LandRegistry Events</Label>
          {block.registryEvents.map((log) => (
            <EventRow key={`${log.transactionHash}-${log.index}`} log={log} />
          ))}
        </div>
      ) : (
        <EmptyState label="No LandRegistry events in this block." />
      )}
    </div>
  );
}

function TransactionList(props: { transactions: ExplorerTransaction[] }) {
  const { transactions } = props;

  if (transactions.length === 0) {
    return <EmptyState label="This block has no transactions." />;
  }

  return (
    <div className="grid gap-3">
      {transactions.map((transaction) => (
        <details
          key={transaction.hash}
          className="rounded-lg border border-[#e2dbcf] bg-white p-3 open:border-[#123c3a]"
        >
          <summary className="cursor-pointer list-none">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="break-all text-sm font-semibold text-[#17211f]">{transaction.hash}</p>
                <p className="mt-1 break-all text-xs text-[#62736d]">
                  {shortHash(transaction.from)} to {shortHash(transaction.to)}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <StatusPill
                  label={transaction.receipt?.status === 1 ? "Success" : "Pending"}
                  tone={transaction.receipt?.status === 1 ? "green" : "amber"}
                />
                {transaction.touchesRegistry ? <StatusPill label="Registry" tone="indigo" /> : null}
              </div>
            </div>
          </summary>

          <div className="mt-4 grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <DataRow label="From" value={transaction.from ?? "Unknown"} />
              <DataRow label="To" value={transaction.to ?? "Contract creation"} />
              <DataRow label="Value" value={transaction.value ?? "0"} />
              <DataRow label="Gas Used" value={transaction.receipt?.gasUsed ?? "Pending"} />
              <DataRow label="Gas Limit" value={transaction.gasLimit ?? "Pending"} />
              <DataRow label="Nonce" value={transaction.nonce?.toString() ?? "Pending"} />
            </div>

            {transaction.registryEvents.length > 0 ? (
              <div className="grid gap-2">
                <Label>Decoded Events</Label>
                {transaction.registryEvents.map((log) => (
                  <EventRow key={`${log.transactionHash}-${log.index}`} log={log} />
                ))}
              </div>
            ) : null}

            <pre className="max-h-80 overflow-auto rounded-md bg-[#17211f] p-3 text-xs leading-relaxed text-[#e9f2ef]">
              {pretty(transaction)}
            </pre>
          </div>
        </details>
      ))}
    </div>
  );
}

function EventRow(props: { log: ExplorerLog }) {
  const { log } = props;

  return (
    <div className="rounded-md border border-[#d9e4df] bg-[#f6fbf8] p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#123c3a]">{log.decoded?.name ?? "Raw Log"}</p>
          <p className="mt-1 break-all text-xs text-[#62736d]">{log.transactionHash}</p>
        </div>
        <StatusPill label={`log ${log.index}`} tone="teal" />
      </div>
      <pre className="mt-3 max-h-48 overflow-auto rounded bg-white p-3 text-xs leading-relaxed text-[#263532]">
        {pretty(log.decoded?.args ?? { topics: log.topics, data: log.data })}
      </pre>
    </div>
  );
}

function MiniData(props: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[#f7f4ed] px-3 py-2">
      <p className="text-xs font-semibold uppercase text-[#7b8883]">{props.label}</p>
      <p className="mt-1 break-all text-sm font-semibold text-[#263532]">{props.value}</p>
    </div>
  );
}

function AuditView(props: {
  operation: Operation | null;
  traceSteps: string[];
  health: HealthResponse | null;
}) {
  const { operation, traceSteps, health } = props;

  return (
    <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
      <Panel title="Process Trace">
        <div className="grid gap-3">
          {traceSteps.length === 0 ? <EmptyState label="No operation trace yet." /> : null}
          {traceSteps.map((step, index) => (
            <div key={step} className="flex gap-3 rounded-md border border-[#e2dbcf] bg-white p-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-[#123c3a] text-xs font-bold text-white">
                {index + 1}
              </span>
              <p className="text-sm text-[#465853]">{step}</p>
            </div>
          ))}
        </div>
      </Panel>

      <section className="grid gap-5">
        <ResultPanel title={operation?.title ?? "Latest Output"} data={operation?.data ?? health} fallback="No output yet." />
      </section>
    </div>
  );
}

function Panel(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[#d8d2c6] bg-[#fffdf8] p-4 shadow-sm">
      <h2 className="mb-4 text-base font-semibold text-[#17211f]">{props.title}</h2>
      {props.children}
    </section>
  );
}

function Metric(props: { label: string; value: string; tone: "teal" | "indigo" | "amber" | "rose" }) {
  const tone = {
    teal: "bg-[#e7f3ef] text-[#0d5a50]",
    indigo: "bg-[#ebeefb] text-[#354aa0]",
    amber: "bg-[#fff4d9] text-[#8a5a00]",
    rose: "bg-[#fde8e8] text-[#a33b3b]",
  }[props.tone];

  return (
    <div className={cx("rounded-lg p-3", tone)}>
      <p className="text-xs font-semibold uppercase">{props.label}</p>
      <p className="mt-1 truncate text-lg font-semibold">{props.value}</p>
    </div>
  );
}

function ActionCard(props: { title: string; detail: string; action: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="rounded-lg border border-[#d8d2c6] bg-[#fffdf8] p-4 text-left shadow-sm transition hover:border-[#123c3a] hover:shadow"
    >
      <p className="text-base font-semibold text-[#17211f]">{props.title}</p>
      <p className="mt-2 min-h-10 text-sm text-[#62736d]">{props.detail}</p>
      <span className="mt-4 inline-flex rounded-md bg-[#17211f] px-3 py-2 text-sm font-semibold text-white">
        {props.action}
      </span>
    </button>
  );
}

function LandRow(props: { land: LandRecord; action?: string; onClick?: () => void }) {
  const { land, action, onClick } = props;

  return (
    <div className="rounded-lg border border-[#e2dbcf] bg-white p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-[#17211f]">{land.landId}</h3>
            <span className={cx("rounded-full px-2 py-1 text-xs font-semibold ring-1", statusTone(land.registrationStatus))}>
              {land.registrationStatus ?? "pending"}
            </span>
            {land.listedForSale ? <StatusPill label="For sale" tone="amber" /> : null}
          </div>
          <p className="mt-1 text-sm text-[#526560]">
            {land.ownerName} | {land.plotNumber ?? "No plot"} | {land.location ?? "No location"}
          </p>
          <p className="mt-1 text-xs text-[#7b8883]">Commitment {shortHash(land.ownerCommitment)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <p className="text-sm font-semibold text-[#17211f]">{money(land.salePrice, land.saleCurrency)}</p>
          {action && onClick ? (
            <button
              type="button"
              onClick={onClick}
              className="rounded-md border border-[#c9c2b5] px-3 py-2 text-sm font-semibold text-[#263532] transition hover:bg-[#ece7dc]"
            >
              {action}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RequestRow(props: {
  land: LandRecord;
  request: AuthenticityRequest;
  action?: string;
  onClick?: () => void;
}) {
  const { land, request, action, onClick } = props;

  return (
    <div className="rounded-lg border border-[#e2dbcf] bg-white p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-[#17211f]">{land.landId}</h3>
            <StatusPill label={request.status} tone={request.status === "proved" ? "green" : "amber"} />
          </div>
          <p className="mt-1 text-sm text-[#526560]">{request.buyerName}</p>
          <p className="mt-1 text-xs text-[#7b8883]">{request.requestId}</p>
          <p className="mt-2 text-sm text-[#465853]">{request.buyerMessage}</p>
        </div>
        <div className="shrink-0">
          {request.proofMs ? <p className="mb-2 text-sm font-semibold text-[#0d5a50]">{request.proofMs} ms</p> : null}
          {action && onClick ? (
            <button
              type="button"
              onClick={onClick}
              className="rounded-md border border-[#c9c2b5] px-3 py-2 text-sm font-semibold text-[#263532] transition hover:bg-[#ece7dc]"
            >
              {action}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ResultPanel(props: { title: string; data: unknown; fallback: string }) {
  return (
    <Panel title={props.title}>
      {props.data ? (
        <pre className="max-h-105 overflow-auto rounded-md bg-[#17211f] p-3 text-xs leading-relaxed text-[#e9f2ef]">
          {pretty(props.data)}
        </pre>
      ) : (
        <EmptyState label={props.fallback} />
      )}
    </Panel>
  );
}

function DataRow(props: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={cx("rounded-md border border-[#e2dbcf] bg-white p-3", props.wide && "sm:col-span-2")}>
      <p className="text-xs font-semibold uppercase text-[#7b8883]">{props.label}</p>
      <p className="mt-1 wrap-break-word text-sm font-semibold text-[#17211f]">{props.value}</p>
    </div>
  );
}

function InboxRow(props: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-[#e2dbcf] bg-white px-3 py-2">
      <span className="text-sm text-[#526560]">{props.label}</span>
      <span className="text-sm font-semibold text-[#17211f]">{props.value}</span>
    </div>
  );
}

function StatusPill(props: { label: string; tone: "green" | "teal" | "indigo" | "amber" }) {
  const tone = {
    green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    teal: "bg-[#e7f3ef] text-[#0d5a50] ring-[#b7d8d0]",
    indigo: "bg-[#ebeefb] text-[#354aa0] ring-[#cbd3f4]",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
  }[props.tone];

  return <span className={cx("rounded-full px-2 py-1 text-xs font-semibold ring-1", tone)}>{props.label}</span>;
}

function Field(props: {
  label: string;
  value: string;
  type?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1">
      <Label>{props.label}</Label>
      <input
        type={props.type ?? "text"}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="min-h-11 rounded-md border border-[#cfc7ba] bg-white px-3 text-sm text-[#17211f] outline-none transition placeholder:text-[#9daaa5] focus:border-[#123c3a] focus:ring-2 focus:ring-[#b9d6d0]"
      />
    </label>
  );
}

function TextArea(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1">
      <Label>{props.label}</Label>
      <textarea
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        rows={4}
        className="min-h-28 resize-y rounded-md border border-[#cfc7ba] bg-white px-3 py-2 text-sm text-[#17211f] outline-none transition focus:border-[#123c3a] focus:ring-2 focus:ring-[#b9d6d0]"
      />
    </label>
  );
}

function Label(props: { children: React.ReactNode }) {
  return <span className="text-xs font-semibold uppercase text-[#62736d]">{props.children}</span>;
}

function PrimaryButton(props: { children: React.ReactNode; loading?: boolean }) {
  return (
    <button
      type="submit"
      disabled={props.loading}
      className="min-h-11 w-full rounded-md bg-[#123c3a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1b514d] disabled:cursor-not-allowed disabled:bg-[#88a39d]"
    >
      {props.loading ? "Processing" : props.children}
    </button>
  );
}

function EmptyState(props: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-[#d8d2c6] bg-[#faf7f0] px-3 py-4 text-sm text-[#62736d]">
      {props.label}
    </div>
  );
}
