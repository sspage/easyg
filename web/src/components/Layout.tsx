import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../services/firebase";

interface LayoutProps {
  children: React.ReactNode;
  userEmail: string;
}

const navItems = [
  { to: "/", label: "Dashboard", icon: "\u2302" },
  { to: "/billing", label: "Billing", icon: "\u2261" },
  { to: "/customers", label: "Customers", icon: "\u263A" },
  { to: "/markup-profiles", label: "Markup Profiles", icon: "\u0025" },
  { to: "/sku-mappings", label: "SKU Mappings", icon: "\u21C4" },
  { to: "/settings", label: "Settings", icon: "\u2699" },
];

export default function Layout({
  children,
  userEmail,
}: LayoutProps): React.ReactElement {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  async function handleLogout() {
    await signOut(auth);
    navigate("/");
  }

  return (
    <div className="app-layout">
      <button
        className="sidebar-toggle"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Toggle navigation"
      >
        {sidebarOpen ? "\u2715" : "\u2630"}
      </button>

      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <h1 className="brand-text">easyG</h1>
          <span className="brand-sub">Billing Automation</span>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `nav-link ${isActive ? "nav-link-active" : ""}`
              }
              onClick={() => setSidebarOpen(false)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <span className="user-email" title={userEmail}>
              {userEmail}
            </span>
          </div>
          <button className="btn btn-sm btn-secondary" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </aside>

      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
