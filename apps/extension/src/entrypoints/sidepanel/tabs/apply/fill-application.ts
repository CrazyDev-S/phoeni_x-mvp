import { api, DOCX_MIME, docxName, fetchDocx, toBase64 } from "@/lib/api";
import { extractJob, fillForms, scanForms, type TargetTab } from "@/lib/page";
import type {
  AutofillResponse,
  FileUpload,
  FillResult,
  FillStep,
  FormAnswer,
  LinkedResume,
  ResumeFacts,
} from "@/lib/types";

export interface FillReport {
  results: FillResult[];
  unanswered: FormAnswer[];
  unreachable: string[];
  resume: LinkedResume | null;
  facts: ResumeFacts | null;
  /** False when part of the form could not be answered this time; Re-scan retries. */
  complete: boolean;
}

/**
 * Scan the form on a tab, answer it, and fill it.
 *
 * Answers come from the resume linked to the tab's posting (the backend finds
 * it from the URL, or `resume` names it). Where the form asks for a resume
 * file, that resume is rendered and attached.
 */
export async function fillApplication(
  tab: TargetTab,
  options: { resume: LinkedResume | null; baseResumeId: string },
  onPhase: (label: string, percent: number) => void,
): Promise<FillReport> {
  onPhase("Scanning the form", 10);
  const { frames, unreachableFrames } = await scanForms(tab.tabId);
  if (!frames.length) {
    throw new Error(
      unreachableFrames.length
        ? "The form sits in a frame we cannot reach. Open it directly and try again."
        : "No fillable fields found on this page.",
    );
  }

  onPhase("Working out the answers", 30);
  const job = await extractJob(tab.tabId).catch(() => null);
  const response = await api<AutofillResponse>("/api/v1/extension/autofill", {
    method: "POST",
    body: JSON.stringify({
      job_url: tab.url,
      resume: options.resume ? { kind: options.resume.kind, id: options.resume.id } : undefined,
      base_resume_id: options.baseResumeId || undefined,
      job: job?.description_text ? job : undefined,
      frames: frames.map((f) => ({ frame_key: f.frameKey, url: f.url, fields: f.fields })),
    }),
  });

  // A cached answer set may predate labels in the reply; the scan has them.
  const labels = new Map(frames.flatMap((f) => f.fields.map((x) => [x.id, x.label] as const)));
  const labelOf = (item: { id: string; label: string }) => item.label || labels.get(item.id) || "";

  let upload: FileUpload | undefined;
  if (response.resume && response.answers.some((a) => a.type === "file")) {
    onPhase("Attaching your resume", 50);
    const blob = await fetchDocx({
      resume_id: response.resume.id,
      kind: response.resume.kind,
      profile: "designed",
    });
    upload = {
      // What a recruiter sees in their ATS, so it names the candidate.
      name: docxName(response.facts?.full_name, "Resume"),
      mime: DOCX_MIME,
      base64: await toBase64(blob),
    };
  }

  onPhase("Filling the page", 65);
  const steps: FillStep[] = response.answers.map((a) => ({
    id: a.id,
    type: a.type,
    answer: a.answer,
    checked: a.checked,
    label: labelOf(a),
    file: a.type === "file" ? upload : undefined,
  }));
  const results = await fillForms(tab.tabId, steps);

  return {
    results,
    unanswered: response.unanswered.map((u) => ({ ...u, label: labelOf(u) })),
    unreachable: unreachableFrames,
    resume: response.resume,
    facts: response.facts,
    complete: response.complete,
  };
}
