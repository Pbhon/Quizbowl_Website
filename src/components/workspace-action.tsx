"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAuth } from "./auth-provider";
import { Button } from "./ui/button";

export function WorkspaceAction() {
  const { user, loading } = useAuth();
  if (loading) return <Button disabled className="mt-7">Checking session…</Button>;
  return <Button asChild className="mt-7"><Link href={user ? "/practice" : "/login"}>{user ? "Explore practice" : "Sign in to your workspace"}<ArrowRight /></Link></Button>;
}
