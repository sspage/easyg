import React, { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import {
  onAuthStateChanged,
  signInWithPopup,
  User,
} from "firebase/auth";
import { auth, googleProvider } from "./services/firebase";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Billing from "./pages/Billing";
import Customers from "./pages/Customers";
import MarkupProfiles from "./pages/MarkupProfiles";
import SkuMappings from "./pages/SkuMappings";
import Settings from "./pages/Settings";
import LoadingSpinner from "./components/LoadingSpinner";
import "./App.css";

export default function App(): React.ReactElement {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const ALLOWED_DOMAIN = "easygcloud.com";

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser && !firebaseUser.email?.endsWith(`@${ALLOWED_DOMAIN}`)) {
        firebaseUser.delete().catch(() => {});
        auth.signOut();
        setLoginError(`Access restricted to @${ALLOWED_DOMAIN} accounts.`);
        setUser(null);
      } else {
        setUser(firebaseUser);
      }
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  async function handleLogin() {
    setLoggingIn(true);
    setLoginError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      if (!result.user.email?.endsWith(`@${ALLOWED_DOMAIN}`)) {
        await result.user.delete().catch(() => {});
        await auth.signOut();
        setLoginError(`Access restricted to @${ALLOWED_DOMAIN} accounts.`);
      }
    } catch (err) {
      setLoginError(
        err instanceof Error ? err.message : "Login failed. Please try again."
      );
    } finally {
      setLoggingIn(false);
    }
  }

  if (authLoading) {
    return (
      <div className="auth-loading">
        <LoadingSpinner message="Checking authentication..." />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-brand">
            <h1>easyG</h1>
            <p>Billing Automation</p>
          </div>
          <p className="login-description">
            Sign in with your Google account to manage billing, customers, and
            Xero integration.
          </p>
          {loginError && <div className="alert alert-error">{loginError}</div>}
          <button
            className="btn btn-primary btn-lg login-btn"
            onClick={handleLogin}
            disabled={loggingIn}
          >
            {loggingIn ? "Signing in..." : "Sign in with Google"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <Layout userEmail={user.email ?? "Unknown"}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/markup-profiles" element={<MarkupProfiles />} />
        <Route path="/sku-mappings" element={<SkuMappings />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  );
}
