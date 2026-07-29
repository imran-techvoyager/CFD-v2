"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, setSession } from "../../lib/api";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.signup(email, password);
      setSession(res.token, res.user);
      router.push("/trade");
    } catch (err: any) {
      setError(err.message || "sign up failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-logo">
        CFD<span>Trader</span>
      </div>
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Create account</h1>
        {error && <div className="auth-error">{error}</div>}
        <div>
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
        </div>
        <div>
          <label>Password (min 8 characters)</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            minLength={8}
            required
          />
        </div>
        <button className="btn-primary" disabled={loading}>
          {loading ? "Creating account…" : "Sign up"}
        </button>
        <div className="auth-note">
          Every new account starts with <b>$5,000</b> of paper money.
          <br />
          Trade BTC, ETH and SOL on live markets, risk-free.
        </div>
        <div className="auth-alt">
          Already registered? <Link href="/signin">Sign in</Link>
        </div>
      </form>
    </div>
  );
}
