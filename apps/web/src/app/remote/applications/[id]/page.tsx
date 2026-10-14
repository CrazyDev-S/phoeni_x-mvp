"use client";

import { useParams, useRouter } from "next/navigation";

import { ApplicationDetailView } from "@/components/remote/applications/application-detail";

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  return (
    <ApplicationDetailView
      id={id}
      layout="page"
      onDeleted={() => router.push("/remote/applications")}
    />
  );
}
