"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Cpu, LogOut, Palette, Plug, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { initialsOf, nameOf, useMe } from "@/hooks/use-me";
import { tokens } from "@/lib/api";

export function UserMenu() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: me, isLoading } = useMe();

  if (isLoading) {
    return (
      <Skeleton className="size-7 rounded-full" />
    );
  }

  function signOut() {
    tokens.clear();
    queryClient.clear();
    router.replace("/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`${nameOf(me)}, account menu`}
          className="focus-visible:ring-ring/40 shrink-0 rounded-full outline-none focus-visible:ring-2"
        >
          <Avatar className="size-7">
            <AvatarFallback className="bg-brand text-brand-foreground text-[11px] font-semibold">
              {initialsOf(me)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-sm font-medium">{nameOf(me)}</span>
          <span className="text-muted-foreground block truncate text-xs">{me?.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* Three distinct destinations, not three links to the same page:
            each opens the settings section it names. */}
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=profile">
            <User />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=models">
            <Cpu />
            Models & API keys
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=integrations">
            <Plug />
            Integrations
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=appearance">
            <Palette />
            Appearance
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={signOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
