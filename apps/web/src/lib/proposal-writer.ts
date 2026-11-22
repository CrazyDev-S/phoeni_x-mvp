/**
 * The proposal writer's versions (backend: app/freelancing/proposals/).
 *
 * Numbered like the profile writer's: drafts 1.1, 1.2, ... then Save records
 * 1, and the drafts after it are 2.1, 2.2, ...
 */

import type { ProposalAnswer } from "@/lib/freelancing";

export { isSaved, versionLabel } from "@/lib/profile-writer";

/** The writer's answers to the method's four detective questions. */
export interface ProposalRead {
  fear: string;
  anchor: string;
  outcome: string;
  mirror: string;
}

export interface ProposalSpike {
  name: string;
  /** A project from the profile, one the instructions gave, or a plan for this build. */
  basis: "profile" | "instructions" | "plan" | "";
  source: string;
}

export interface ProposalDocument {
  cover_letter_markdown: string;
  answers: ProposalAnswer[];
  read?: ProposalRead;
  spike?: ProposalSpike;
  questions?: string[];
  change_note?: string;
  researched?: { url: string; title: string; problem: string }[];
}

export interface ProposalVersion {
  id: string;
  proposal_id: string;
  major: number;
  minor: number;
  instruction: string | null;
  document: ProposalDocument;
  based_on_id: string | null;
  generation_id: string | null;
  created_at: string;
}

export interface ProposalVersions {
  items: ProposalVersion[];
  running_generation_id: string | null;
}

/** Under the "freelancing" key, so a proposal save refreshes it too. */
export const proposalVersionsKey = (proposalId: string) =>
  ["freelancing", "proposal-versions", proposalId] as const;

export const proposalVersionsPath = (proposalId: string) =>
  `/api/v1/freelancing/proposals/${proposalId}/versions`;
