import { MONAD_TESTNET } from "@/lib/chain/network";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatUtc(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${hours}:${minutes} UTC`;
}

export function shortAddress(value: string | null | undefined): string {
  if (!value) return "—";
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function formatAgentId(id: string | null | undefined): string {
  if (!id || !/^\d+$/.test(id)) return "—";
  return `#${id.padStart(3, "0")}`;
}

export function formatAgentLabel(id: string | null | undefined): string {
  const compact = formatAgentId(id);
  return compact === "—" ? compact : `Agent ${compact}`;
}

/** Exact amounts: MON with up to 6 decimals when the value is a whole number of micro-MON, otherwise wei. */
export function formatWei(value: string | null | undefined): string {
  if (value == null || !/^\d+$/.test(value)) return "—";
  const wei = BigInt(value);
  if (wei === 0n) return "0 MON";
  const micro = 10n ** 12n;
  if (wei % micro !== 0n) return `${value} wei`;
  const whole = wei / 10n ** 18n;
  const frac = ((wei % 10n ** 18n) / micro).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""} MON`;
}

export function formatDuration(seconds: string | null | undefined): string {
  if (!seconds || !/^\d+$/.test(seconds)) return "—";
  const n = Number(seconds);
  if (n % 86400 === 0) return n === 86400 ? "day" : `${n / 86400} days`;
  if (n % 3600 === 0) return n === 3600 ? "hour" : `${n / 3600} hours`;
  return `${seconds}s`;
}

const KNOWN_FUNCTIONS: Record<string, string> = {
  "0xe2bbb158": "deposit(uint256,uint256)",
  "0x441a3e70": "withdraw(uint256,uint256)",
  "0x9d9892cd": "swap(uint256,uint256,uint256)",
};

/** Readable name for a DemoProtocol selector; null for anything else (shown as the raw selector). */
export function functionName(selector: string | null | undefined): string | null {
  if (!selector) return null;
  return KNOWN_FUNCTIONS[selector.toLowerCase()] ?? null;
}

export function shortHash(value: string | null | undefined): string {
  if (!value) return "—";
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) return value;
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

export function txUrl(hash: string | null | undefined): string | null {
  if (!hash || !/^0x[a-fA-F0-9]{64}$/.test(hash)) return null;
  return `${MONAD_TESTNET.explorerUrl}/tx/${hash}`;
}

export function addressUrl(address: string | null | undefined): string | null {
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return null;
  return `${MONAD_TESTNET.explorerUrl}/address/${address}`;
}

export function statusTone(status: string): "ok" | "pending" | "muted" | "danger" | "warn" {
  if (status === "active" || status === "receipt_verified" || status === "verified") return "ok";
  if (status === "pending" || status === "requested" || status === "executed" || status === "temporary_error") return "pending";
  if (status === "paused") return "warn";
  if (status === "failed" || status === "unverifiable") return "danger";
  return "muted";
}

export function proofStatusLabel(status: string, anchored = false): string {
  let label: string;
  switch (status) {
    case "executed":
      label = "Executed";
      break;
    case "requested":
      label = "Verifying";
      break;
    case "receipt_verified":
      label = "Execution verified";
      break;
    case "unverifiable":
      label = "Unverifiable";
      break;
    case "temporary_error":
      label = "Verification delayed";
      break;
    default:
      label = status;
  }
  return anchored ? `${label} · Anchored` : label;
}

export function statusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "pending":
      return "Pending";
    case "active":
      return "Active";
    case "inactive":
      return "Inactive";
    case "paused":
      return "Paused";
    case "failed":
      return "Failed";
    case "executed":
      return "Executed";
    case "verified":
      return "Outcome verified";
    case "unverifiable":
      return "Unverifiable";
    default:
      return status;
  }
}

/** Primary message for a chain or wallet failure. The raw string stays available as detail. */
export function readableChainError(raw: string): { message: string; detail: string } {
  const detail = raw.trim();
  const lower = detail.toLowerCase();
  if (lower.includes("user rejected") || lower.includes("user denied") || lower.includes("rejected the request")) {
    return { message: "Transaction rejected", detail };
  }
  if (lower.includes("paused") || lower.includes("firewallispaused")) return { message: "Firewall paused", detail };
  if (lower.includes("function") && (lower.includes("not allowed") || lower.includes("notallowed"))) {
    return { message: "Function not allowed", detail };
  }
  if (lower.includes("target") && (lower.includes("not allowed") || lower.includes("notallowed"))) {
    return { message: "Target not allowed", detail };
  }
  if (lower.includes("value") && (lower.includes("exceed") || lower.includes("limit"))) {
    return { message: "Value exceeds policy", detail };
  }
  if (lower.includes("inactive") || lower.includes("not active")) return { message: "Agent inactive", detail };
  if (lower.includes("insufficient") && (lower.includes("gas") || lower.includes("fund"))) {
    return { message: "Insufficient gas", detail };
  }
  if (lower.includes("timeout") || lower.includes("timed out")) return { message: "RPC timeout", detail };
  if (
    lower.includes("failed to fetch") ||
    lower.includes("network") ||
    lower.includes("chain unavailable") ||
    lower.includes("not deployed")
  ) {
    return { message: lower.includes("not deployed") ? "Testnet connection unavailable" : "Network unavailable", detail };
  }
  if (detail.length > 0 && detail.length < 120 && !detail.includes("0x")) return { message: detail, detail };
  return { message: "The transaction could not be completed.", detail };
}
