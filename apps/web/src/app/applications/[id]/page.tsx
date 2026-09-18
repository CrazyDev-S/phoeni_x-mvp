"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { ApplicationDetailView } from "@/components/applications/application-detail";
import { Button } from "@/components/ui/button";

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/applications">
          <ArrowLeft />
          All applications
        </Link>
      </Button>
      <ApplicationDetailView
        id={id}
        layout="page"
        onDeleted={() => router.push("/applications")}
      />
    </div>
  );
}
