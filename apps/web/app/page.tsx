"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "../lib/api";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getToken() ? "/trade" : "/signin");
  }, [router]);

  return <div className="loading-screen">Loading…</div>;
}
