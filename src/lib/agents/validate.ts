import { CAPABILITIES, type Capability } from "./types.ts";

export type CreateInput = {
  name: string;
  description: string;
  capabilities: Capability[];
  metadataURI: string;
};

const CAPABILITY_SET = new Set<string>(CAPABILITIES);

export function parseCreateInput(
  input: unknown,
): { ok: true; value: CreateInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Invalid agent details." };
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.name !== "string" || typeof raw.description !== "string") {
    return { ok: false, error: "Name and description are required." };
  }
  const name = raw.name.trim();
  const description = raw.description.trim();
  const metadataURI = typeof raw.metadataURI === "string" ? raw.metadataURI.trim() : "";

  if (!name) return { ok: false, error: "Agent name is required." };
  if (name.length > 64) return { ok: false, error: "Agent name must be 64 characters or fewer." };
  if ([...name].some((char) => char.charCodeAt(0) < 0x20)) return { ok: false, error: "Agent name contains invalid characters." };
  if (!description) return { ok: false, error: "Description is required." };
  if (description.length > 280) {
    return { ok: false, error: "Description must be 280 characters or fewer." };
  }
  if (metadataURI.length > 200) {
    return { ok: false, error: "Metadata URI must be 200 characters or fewer." };
  }
  if (metadataURI && !/^https:\/\/\S+$/.test(metadataURI) && !/^ipfs:\/\/\S+$/.test(metadataURI)) {
    return { ok: false, error: "Metadata must be an https or ipfs URI, or left empty." };
  }
  if (!Array.isArray(raw.capabilities) || raw.capabilities.length === 0) {
    return { ok: false, error: "Select at least one capability." };
  }
  const capabilities: Capability[] = [];
  for (const item of raw.capabilities) {
    if (typeof item !== "string" || !CAPABILITY_SET.has(item)) {
      return { ok: false, error: "Unknown capability." };
    }
    const capability = item as Capability;
    if (!capabilities.includes(capability)) capabilities.push(capability);
  }
  if (capabilities.length > 9) return { ok: false, error: "Too many capabilities." };
  return { ok: true, value: { name, description, capabilities, metadataURI } };
}
