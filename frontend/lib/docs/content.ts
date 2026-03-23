import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type DocMeta = {
  slug: string;
  fileName: string;
  title: string;
  description: string;
};

export type DocPage = DocMeta & {
  markdown: string;
};

const DOC_DEFINITIONS: DocMeta[] = [
  {
    slug: "quickstart-30min",
    fileName: "quickstart-30min.md",
    title: "Integrate in 30 Minutes",
    description: "Launchpad-first quickstart for Base Sepolia with the Dutch Auction SDK.",
  },
  {
    slug: "migration-cofhejs-to-cofhe-sdk",
    fileName: "migration-cofhejs-to-cofhe-sdk.md",
    title: "Migrate to @cofhe/sdk",
    description: "Required migration path from deprecated cofhejs before the April 13, 2026 cutoff.",
  },
  {
    slug: "contract-events-reference",
    fileName: "contract-events-reference.md",
    title: "Contract and Event Reference",
    description: "Core contract methods, hookData formats, and lifecycle events for integrators.",
  },
  {
    slug: "troubleshooting-base-sepolia",
    fileName: "troubleshooting-base-sepolia.md",
    title: "Troubleshooting",
    description: "Common Base Sepolia integration failures and deterministic fixes.",
  },
  {
    slug: "integrator-use-cases",
    fileName: "integrator-use-cases.md",
    title: "Integrator Use-Cases",
    description: "Where this auction system fits launchpads, backend rails, and analytics.",
  },
  {
    slug: "support-model",
    fileName: "support-model.md",
    title: "Support Model",
    description: "v1 support boundaries and ownership model for external teams.",
  },
];

const resolveDocsDirectory = (): string => {
  const candidates = [path.resolve(process.cwd(), "..", "docs"), path.resolve(process.cwd(), "docs")];
  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) {
    throw new Error("Docs directory not found. Expected ../docs or ./docs from frontend runtime.");
  }
  return found;
};

const getDocMetaBySlug = (slug: string): DocMeta | undefined => {
  return DOC_DEFINITIONS.find(doc => doc.slug === slug);
};

export const getDocsNavigation = (): DocMeta[] => DOC_DEFINITIONS;

export const getDocBySlug = async (slug: string): Promise<DocPage | null> => {
  const docMeta = getDocMetaBySlug(slug);
  if (!docMeta) return null;

  const docsDir = resolveDocsDirectory();
  const filePath = path.join(docsDir, docMeta.fileName);
  const markdown = await readFile(filePath, "utf-8");
  return { ...docMeta, markdown };
};

export const getDocNeighbors = (
  slug: string,
): {
  previous: DocMeta | null;
  next: DocMeta | null;
} => {
  const index = DOC_DEFINITIONS.findIndex(doc => doc.slug === slug);
  if (index === -1) return { previous: null, next: null };

  return {
    previous: DOC_DEFINITIONS[index - 1] ?? null,
    next: DOC_DEFINITIONS[index + 1] ?? null,
  };
};
