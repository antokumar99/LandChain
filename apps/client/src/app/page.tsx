"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

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

type LandRecord = {
  id?: string;
  landId: string;
  ownerName: string;
  ownerIdentifier: string;
  ownerCommitment: string;
  merkleRoot: string;
  transactionHash: string;
  contractAddress: string;
  transfers?: Array<{
    proofMs: number;
    proofGasUsed?: string;
    transferGasUsed?: string;
    proofTransactionHash: string;
    transferTransactionHash: string;
  }>;
};

type RegisterResponse = {
  land: LandRecord;
  generated: {
    ownerSecret: string;
    ownerCommitment: string;
    merkleRoot: string;
    merkleRootHex: string;
    cidHash: string;
  };
  chain: {
    transactionHash: string;
    blockNumber: number;
    contractAddress: string;
  };
};

type TransferResponse = {
  land: LandRecord;
  generated: {
    newOwnerSecret: string;
    transferNonce: string;
    newOwnerCommitment: string;
    merkleRoot: string;
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
};

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function shortHash(value?: string | null) {
  if (!value) {
    return "Pending";
  }

  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

export default function Home() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [lands, setLands] = useState<LandRecord[]>([]);
  const [form, setForm] = useState({
    landId: "101",
    ownerName: "Ayesha Rahman",
    ownerIdentifier: "NID-2026-001",
    district: "Dhaka",
    plotNo: "DHK-17A",
  });
  const [transferForm, setTransferForm] = useState({
    landId: "101",
    ownerSecret: "",
    newOwnerName: "Nusrat Karim",
    newOwnerIdentifier: "NID-2026-002",
  });
  const [result, setResult] = useState<RegisterResponse | null>(null);
  const [transferResult, setTransferResult] = useState<TransferResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [transferLoading, setTransferLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(true);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError("");

    try {
      const healthResponse = await fetch(`${apiBase}/health`, { cache: "no-store" });

      if (!healthResponse.ok) {
        throw new Error("Backend health check failed");
      }

      const healthData = (await healthResponse.json()) as HealthResponse;

      setHealth(healthData);

      const landsResponse = await fetch(`${apiBase}/api/lands`, { cache: "no-store" });

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
  }, []);

  useEffect(() => {
    const loadHealth = async () => {
      await refresh();
    };

    loadHealth();
  }, [refresh]);

  const checklist = useMemo(
    () => [
      { label: "Next.js frontend", done: true, detail: "running" },
      { label: "Express backend", done: health?.api === "running", detail: health?.api ?? "offline" },
      {
        label: "MongoDB connected",
        done: health?.mongodb === "connected",
        detail: health?.mongodb ?? "offline",
      },
      {
        label: "Hardhat local blockchain",
        done: typeof health?.chain.blockNumber === "number",
        detail:
          typeof health?.chain.blockNumber === "number"
            ? `block ${health.chain.blockNumber}`
            : "offline",
      },
      {
        label: "LandRegistry deployed",
        done: Boolean(health?.chain.contractAddress),
        detail: shortHash(health?.chain.contractAddress),
      },
      {
        label: "Backend authority",
        done: Boolean(health?.chain.authority?.isAuthority),
        detail: health?.chain.authority?.isAuthority
          ? shortHash(health.chain.authority.serverWallet)
          : "wallet not approved",
      },
      {
        label: "Basic land register API",
        done: Boolean(result || lands.length),
        detail: result ? "last request saved" : `${lands.length} records`,
      },
      {
        label: "Land commitment generated",
        done: Boolean(result?.generated.ownerCommitment),
        detail: shortHash(result?.generated.ownerCommitment),
      },
      {
        label: "Merkle root generated",
        done: Boolean(result?.generated.merkleRoot),
        detail: shortHash(result?.generated.merkleRoot),
      },
      {
        label: "Merkle root stored",
        done: Boolean(result?.chain.transactionHash || health?.chain.latestMerkleRoot),
        detail: shortHash(result?.chain.transactionHash ?? health?.chain.latestMerkleRoot),
      },
      {
        label: "Owner proof generated",
        done: Boolean(transferResult?.proof.snarkjsVerified),
        detail: transferResult ? `${transferResult.metrics.proofMs} ms` : "waiting",
      },
      {
        label: "Contract verifies proof",
        done: Boolean(transferResult?.chain.proof.valid),
        detail: shortHash(transferResult?.chain.proof.transactionHash),
      },
      {
        label: "Transfer after proof",
        done: Boolean(transferResult?.chain.transfer.transactionHash),
        detail: shortHash(transferResult?.chain.transfer.transactionHash),
      },
      {
        label: "Gas and proof time",
        done: Boolean(transferResult?.metrics.totalGasUsed),
        detail: transferResult
          ? `${transferResult.metrics.totalGasUsed ?? "0"} gas / ${transferResult.metrics.proofMs} ms`
          : "waiting",
      },
    ],
    [health, lands.length, result, transferResult],
  );

  async function submitLand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch(`${apiBase}/api/lands/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          landId: form.landId,
          ownerName: form.ownerName,
          ownerIdentifier: form.ownerIdentifier,
          metadata: {
            district: form.district,
            plotNo: form.plotNo,
          },
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Registration failed");
      }

      const registerData = data as RegisterResponse;
      setResult(registerData);
      setTransferForm((current) => ({
        ...current,
        landId: registerData.land.landId,
        ownerSecret: registerData.generated.ownerSecret,
      }));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  async function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTransferLoading(true);
    setError("");
    setTransferResult(null);

    try {
      const response = await fetch(`${apiBase}/api/lands/${transferForm.landId}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerSecret: transferForm.ownerSecret,
          newOwnerName: transferForm.newOwnerName,
          newOwnerIdentifier: transferForm.newOwnerIdentifier,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Transfer failed");
      }

      const transferData = data as TransferResponse;
      setTransferResult(transferData);
      setTransferForm((current) => ({
        ...current,
        ownerSecret: transferData.generated.newOwnerSecret,
      }));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Transfer failed");
    } finally {
      setTransferLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f8f4] text-[#18201b]">
      <section className="border-b border-[#d9decf] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#cfd8c4] bg-[#eef4e7]">
              <Image src="/globe.svg" alt="" width={22} height={22} />
            </div>
            <div>
              <h1 className="text-xl font-semibold">LandChain Registry</h1>
              <p className="text-sm text-[#607064]">{apiBase}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="h-10 rounded-md border border-[#aeb9aa] bg-white px-4 text-sm font-medium text-[#243126] transition hover:bg-[#eef4e7]"
          >
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-5 px-5 py-6 lg:grid-cols-[1fr_360px]">
        <section className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {checklist.map((item) => (
              <div key={item.label} className="rounded-lg border border-[#d9decf] bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium">{item.label}</p>
                  <span
                    className={`h-3 w-3 rounded-full ${item.done ? "bg-[#3d8b5a]" : "bg-[#c68b37]"}`}
                    aria-label={item.done ? "complete" : "pending"}
                  />
                </div>
                <p className="mt-3 break-all font-mono text-xs text-[#667263]">{item.detail}</p>
              </div>
            ))}
          </div>

          <form onSubmit={submitLand} className="rounded-lg border border-[#d9decf] bg-white p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">
                Land ID
                <input
                  value={form.landId}
                  onChange={(event) => setForm({ ...form, landId: event.target.value })}
                  className="h-11 rounded-md border border-[#c8d1c1] px-3 font-normal outline-none ring-[#6b8f71] transition focus:ring-2"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Owner Name
                <input
                  value={form.ownerName}
                  onChange={(event) => setForm({ ...form, ownerName: event.target.value })}
                  className="h-11 rounded-md border border-[#c8d1c1] px-3 font-normal outline-none ring-[#6b8f71] transition focus:ring-2"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Owner Identifier
                <input
                  value={form.ownerIdentifier}
                  onChange={(event) => setForm({ ...form, ownerIdentifier: event.target.value })}
                  className="h-11 rounded-md border border-[#c8d1c1] px-3 font-normal outline-none ring-[#6b8f71] transition focus:ring-2"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                District
                <input
                  value={form.district}
                  onChange={(event) => setForm({ ...form, district: event.target.value })}
                  className="h-11 rounded-md border border-[#c8d1c1] px-3 font-normal outline-none ring-[#6b8f71] transition focus:ring-2"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Plot No
                <input
                  value={form.plotNo}
                  onChange={(event) => setForm({ ...form, plotNo: event.target.value })}
                  className="h-11 rounded-md border border-[#c8d1c1] px-3 font-normal outline-none ring-[#6b8f71] transition focus:ring-2"
                />
              </label>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={loading}
                className="h-11 rounded-md bg-[#2f5d46] px-5 text-sm font-semibold text-white transition hover:bg-[#244a38] disabled:cursor-not-allowed disabled:bg-[#8ca193]"
              >
                {loading ? "Registering" : "Register Land"}
              </button>
              {error ? <p className="text-sm text-[#a33b2f]">{error}</p> : null}
            </div>
          </form>

          <form onSubmit={submitTransfer} className="rounded-lg border border-[#d9decf] bg-white p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">
                Transfer Land ID
                <input
                  value={transferForm.landId}
                  onChange={(event) => setTransferForm({ ...transferForm, landId: event.target.value })}
                  className="h-11 rounded-md border border-[#c8d1c1] px-3 font-normal outline-none ring-[#6b8f71] transition focus:ring-2"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Current Owner Secret
                <input
                  value={transferForm.ownerSecret}
                  onChange={(event) => setTransferForm({ ...transferForm, ownerSecret: event.target.value })}
                  className="h-11 rounded-md border border-[#c8d1c1] px-3 font-normal outline-none ring-[#6b8f71] transition focus:ring-2"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                New Owner Name
                <input
                  value={transferForm.newOwnerName}
                  onChange={(event) => setTransferForm({ ...transferForm, newOwnerName: event.target.value })}
                  className="h-11 rounded-md border border-[#c8d1c1] px-3 font-normal outline-none ring-[#6b8f71] transition focus:ring-2"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                New Owner Identifier
                <input
                  value={transferForm.newOwnerIdentifier}
                  onChange={(event) =>
                    setTransferForm({ ...transferForm, newOwnerIdentifier: event.target.value })
                  }
                  className="h-11 rounded-md border border-[#c8d1c1] px-3 font-normal outline-none ring-[#6b8f71] transition focus:ring-2"
                />
              </label>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={transferLoading}
                className="h-11 rounded-md bg-[#274f67] px-5 text-sm font-semibold text-white transition hover:bg-[#1f4054] disabled:cursor-not-allowed disabled:bg-[#8ca0ac]"
              >
                {transferLoading ? "Proving and transferring" : "Generate Proof and Transfer"}
              </button>
            </div>
          </form>
        </section>

        <aside className="space-y-5">
          <div className="rounded-lg border border-[#d9decf] bg-white p-5">
            <h2 className="text-base font-semibold">Latest Registration</h2>
            {result ? (
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-[#687367]">Commitment</dt>
                  <dd className="break-all font-mono text-xs">{result.generated.ownerCommitment}</dd>
                </div>
                <div>
                  <dt className="text-[#687367]">Merkle Root</dt>
                  <dd className="break-all font-mono text-xs">{result.generated.merkleRoot}</dd>
                </div>
                <div>
                  <dt className="text-[#687367]">Transaction</dt>
                  <dd className="break-all font-mono text-xs">{result.chain.transactionHash}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-4 text-sm text-[#687367]">No registration in this session.</p>
            )}
          </div>

          <div className="rounded-lg border border-[#d9decf] bg-white p-5">
            <h2 className="text-base font-semibold">Latest Proof Transfer</h2>
            {transferResult ? (
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-[#687367]">Proof Time</dt>
                  <dd className="font-mono text-xs">{transferResult.metrics.proofMs} ms</dd>
                </div>
                <div>
                  <dt className="text-[#687367]">Verification Gas</dt>
                  <dd className="font-mono text-xs">{transferResult.metrics.proofGasUsed}</dd>
                </div>
                <div>
                  <dt className="text-[#687367]">Transfer Gas</dt>
                  <dd className="font-mono text-xs">{transferResult.metrics.transferGasUsed}</dd>
                </div>
                <div>
                  <dt className="text-[#687367]">New Owner Secret</dt>
                  <dd className="break-all font-mono text-xs">{transferResult.generated.newOwnerSecret}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-4 text-sm text-[#687367]">No proof transfer in this session.</p>
            )}
          </div>

          <div className="rounded-lg border border-[#d9decf] bg-white p-5">
            <h2 className="text-base font-semibold">Registered Lands</h2>
            <div className="mt-4 space-y-3">
              {lands.length === 0 ? (
                <p className="text-sm text-[#687367]">No lands saved yet.</p>
              ) : (
                lands.slice(0, 6).map((land) => (
                  <div key={land.landId} className="border-t border-[#e6eadf] pt-3 first:border-t-0 first:pt-0">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">#{land.landId}</p>
                      <p className="font-mono text-xs text-[#687367]">{shortHash(land.transactionHash)}</p>
                    </div>
                    <p className="mt-1 text-sm text-[#687367]">{land.ownerName}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
