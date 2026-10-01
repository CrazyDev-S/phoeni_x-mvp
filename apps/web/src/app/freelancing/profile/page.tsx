"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  CheckCircle2,
  ExternalLink,
  Globe,
  Key,
  Lightbulb,
  Link as LinkIcon,
  Plus,
  Save,
  Shield,
  Sliders,
  Sparkles,
  Trash2,
  User,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { ProfileForm } from "@/components/freelancing/profile-form";
import { PhoenixHeroBanner } from "@/components/phoenix-hero-banner";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useMe, nameOf } from "@/hooks/use-me";
import { request } from "@/lib/api";
import type { FreelancerProfile } from "@/lib/freelancing";
import { cn } from "@/lib/utils";

type SectionTab = "profile" | "ai_settings" | "preferences" | "security";

export default function ProfilePage() {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<SectionTab>("profile");

  const [headline, setHeadline] = useState(
    "Full Stack Developer | React, Node.js, Mobile Apps | Turning Ideas into Scalable Products",
  );
  const [aboutYou, setAboutYou] = useState(
    "I'm a passionate full stack developer with 5+ years of experience building web and mobile applications. I specialize in React, Node.js, and modern cloud technologies. I love turning complex problems into simple, elegant solutions and helping businesses grow through great products.",
  );
  const [skills, setSkills] = useState([
    "React",
    "Next.js",
    "TypeScript",
    "Node.js",
    "PostgreSQL",
    "MongoDB",
    "Tailwind CSS",
    "Mobile App",
    "JavaScript",
    "AWS",
    "Docker",
    "System Design",
  ]);
  const [newSkill, setNewSkill] = useState("");
  const [links, setLinks] = useState([
    { label: "Portfolio Website", url: "https://phoenixstar.dev" },
    { label: "GitHub", url: "https://github.com/phoenixstar" },
    { label: "LinkedIn", url: "https://linkedin.com/in/phoenixstar" },
    { label: "Personal Blog", url: "https://blog.phoenixstar.dev" },
  ]);
  const [workType, setWorkType] = useState<"remote" | "hybrid" | "onsite">("remote");

  const handleAddSkill = () => {
    if (newSkill.trim() && !skills.includes(newSkill.trim())) {
      setSkills([...skills, newSkill.trim()]);
      setNewSkill("");
    }
  };

  const removeSkill = (s: string) => {
    setSkills(skills.filter((item) => item !== s));
  };

  const handleSave = () => {
    toast.success("Profile settings saved successfully!");
  };

  const userName = nameOf(me) || "Phoenixstar";

  return (
    <div className="space-y-6">
      <PhoenixHeroBanner
        title="Profile & AI Settings"
        description="Manage your freelancer profile, career preferences, and AI settings to get the best opportunities."
        badge={
          <div className="flex items-center gap-2 rounded-xl border border-orange-200/80 bg-white/90 dark:border-orange-900/60 dark:bg-stone-800/90 px-3.5 py-2 text-xs shadow-xs">
            <span className="text-base">📈</span>
            <div>
              <span className="font-bold text-stone-900 dark:text-stone-100">
                A complete profile gets 3x more views
              </span>
              <p className="text-[11px] text-stone-500">
                Keep your profile up to date to attract better opportunities.
              </p>
            </div>
          </div>
        }
      />

      {/* 2-Column Layout: Navigation Subtabs on Left + Form Content on Right */}
      <div className="grid gap-6 lg:grid-cols-[220px_1fr] items-start">
        {/* Sub-nav Tabs */}
        <div className="space-y-1 rounded-2xl border border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900/80 p-2 shadow-xs">
          <button
            onClick={() => setActiveTab("profile")}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition-all",
              activeTab === "profile"
                ? "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300 shadow-xs"
                : "text-stone-600 hover:text-stone-900 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800/50",
            )}
          >
            <User className="size-4 text-orange-600" />
            <div>
              <div>Profile</div>
              <div className="text-[10px] text-stone-400 font-normal">Personal info, portfolio</div>
            </div>
          </button>

          <button
            onClick={() => setActiveTab("ai_settings")}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition-all",
              activeTab === "ai_settings"
                ? "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300 shadow-xs"
                : "text-stone-600 hover:text-stone-900 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800/50",
            )}
          >
            <Sparkles className="size-4 text-purple-600" />
            <div>
              <div>AI Settings</div>
              <div className="text-[10px] text-stone-400 font-normal">API keys and prompts</div>
            </div>
          </button>

          <button
            onClick={() => setActiveTab("preferences")}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition-all",
              activeTab === "preferences"
                ? "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300 shadow-xs"
                : "text-stone-600 hover:text-stone-900 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800/50",
            )}
          >
            <Sliders className="size-4 text-blue-600" />
            <div>
              <div>Preferences</div>
              <div className="text-[10px] text-stone-400 font-normal">Search & automation</div>
            </div>
          </button>

          <button
            onClick={() => setActiveTab("security")}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition-all",
              activeTab === "security"
                ? "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300 shadow-xs"
                : "text-stone-600 hover:text-stone-900 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800/50",
            )}
          >
            <Shield className="size-4 text-emerald-600" />
            <div>
              <div>Security</div>
              <div className="text-[10px] text-stone-400 font-normal">Account & privacy</div>
            </div>
          </button>
        </div>

        {/* Right Content Area */}
        <div className="space-y-5">
          {/* Personal Overview Card */}
          <Card className="rounded-2xl border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-xs overflow-hidden">
            <div className="border-b border-stone-100 dark:border-stone-800 px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserRound className="size-4.5 text-orange-600" />
                <h3 className="font-bold text-sm text-stone-900 dark:text-stone-100">
                  Personal Overview
                </h3>
              </div>
              <Button
                size="sm"
                onClick={handleSave}
                className="h-8 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold"
              >
                <Save className="size-3.5 mr-1" />
                Save Changes
              </Button>
            </div>

            <CardContent className="p-5 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 font-black text-2xl border border-orange-200 dark:border-orange-800">
                    P
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-base text-stone-900 dark:text-stone-100">
                        {userName}
                      </h4>
                      <BadgeCheck className="size-4.5 text-blue-500" />
                    </div>
                    <p className="text-xs text-stone-500">Freelance Full Stack Developer</p>
                    <div className="flex items-center gap-2 text-[11px] text-stone-500 mt-1">
                      <span className="flex items-center gap-1">
                        <Globe className="size-3 text-stone-400" />
                        Singapore
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1 text-emerald-600 font-medium">
                        <span className="size-1.5 rounded-full bg-emerald-500 inline-block" />
                        Available for work
                      </span>
                    </div>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl border-stone-200 dark:border-stone-700 text-xs font-semibold self-start sm:self-auto"
                >
                  Edit Photo
                </Button>
              </div>

              {/* Professional Headline */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-stone-800 dark:text-stone-200">
                    Professional Headline
                  </label>
                  <span className="text-[11px] text-stone-400 tabular-nums">
                    {headline.length}/150
                  </span>
                </div>
                <Input
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  className="h-10 rounded-xl text-xs"
                />
              </div>

              {/* About You */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-stone-800 dark:text-stone-200">
                    About You
                  </label>
                  <span className="text-[11px] text-stone-400 tabular-nums">
                    {aboutYou.length}/500
                  </span>
                </div>
                <Textarea
                  rows={4}
                  value={aboutYou}
                  onChange={(e) => setAboutYou(e.target.value)}
                  className="rounded-xl text-xs leading-relaxed"
                />
              </div>
            </CardContent>
          </Card>

          {/* Core Skills & Portfolio Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Core Skills */}
            <Card className="rounded-2xl border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-xs overflow-hidden">
              <div className="border-b border-stone-100 dark:border-stone-800 px-4 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm">💼</span>
                  <h4 className="font-bold text-xs text-stone-900 dark:text-stone-100">Core Skills</h4>
                </div>
              </div>

              <CardContent className="p-4 space-y-3">
                <p className="text-[11px] text-stone-500">
                  Add skills to help AI match you with the best opportunities.
                </p>

                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. Python, Vue.js..."
                    value={newSkill}
                    onChange={(e) => setNewSkill(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddSkill()}
                    className="h-8 text-xs rounded-xl"
                  />
                  <Button
                    size="sm"
                    onClick={handleAddSkill}
                    className="h-8 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold px-3"
                  >
                    <Plus className="size-3.5 mr-1" />
                    Add
                  </Button>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {skills.map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-stone-100 dark:bg-stone-800 px-2.5 py-1 text-xs font-medium text-stone-700 dark:text-stone-300"
                    >
                      {s}
                      <button
                        type="button"
                        onClick={() => removeSkill(s)}
                        className="text-stone-400 hover:text-stone-700"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Portfolio & Links */}
            <Card className="rounded-2xl border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-xs overflow-hidden">
              <div className="border-b border-stone-100 dark:border-stone-800 px-4 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <LinkIcon className="size-3.5 text-blue-600" />
                  <h4 className="font-bold text-xs text-stone-900 dark:text-stone-100">
                    Portfolio & Links
                  </h4>
                </div>
              </div>

              <CardContent className="p-4 space-y-2.5">
                {links.map((item, index) => (
                  <div key={item.label} className="space-y-1">
                    <label className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">
                      {item.label}
                    </label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={item.url}
                        onChange={(e) => {
                          const updated = [...links];
                          updated[index].url = e.target.value;
                          setLinks(updated);
                        }}
                        className="h-8 text-xs rounded-xl"
                      />
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Preferred Countries & Rates */}
          <Card className="rounded-2xl border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-xs overflow-hidden">
            <div className="border-b border-stone-100 dark:border-stone-800 px-4 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm">📍</span>
                <h4 className="font-bold text-xs text-stone-900 dark:text-stone-100">
                  Preferred Countries & Rates
                </h4>
              </div>
            </div>

            <CardContent className="p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-stone-800 dark:text-stone-200">
                    Preferred Countries
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {["United States", "Canada", "United Kingdom"].map((c) => (
                      <span
                        key={c}
                        className="rounded-lg bg-stone-100 dark:bg-stone-800 px-2 py-0.5 text-xs text-stone-700 dark:text-stone-300"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-stone-800 dark:text-stone-200">
                    Hourly Rate Range (USD)
                  </label>
                  <div className="flex items-center gap-2">
                    <Input defaultValue="$50" className="h-8 text-xs rounded-xl" />
                    <span className="text-xs text-stone-400">–</span>
                    <Input defaultValue="$120" className="h-8 text-xs rounded-xl" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-stone-800 dark:text-stone-200">
                    Work Type
                  </label>
                  <div className="flex gap-1 rounded-xl bg-stone-100 dark:bg-stone-800 p-1">
                    {(["remote", "hybrid", "onsite"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setWorkType(t)}
                        className={cn(
                          "flex-1 rounded-lg py-1 text-xs font-semibold capitalize transition-all",
                          workType === t
                            ? "bg-white text-orange-600 shadow-xs dark:bg-stone-700 dark:text-orange-400"
                            : "text-stone-500 hover:text-stone-900",
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
