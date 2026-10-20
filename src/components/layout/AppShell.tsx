import { useState } from "react"
import { Outlet } from "react-router"
import { Header } from "./Header"
import { Sidebar } from "./Sidebar"
import { Navigate } from "react-router"
import { useAuth } from "@/auth/AuthProvider"

export function AppShell() {
  const { user, loading, error } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  if (loading) return <main className="loading-page" aria-live="polite">Vérification de la session…</main>
  if (!user) return <Navigate to="/connexion" replace state={{ error: error?.message }} />

  return (
    <div className="app-shell">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="app-shell__workspace">
        <Header onMenuOpen={() => setSidebarOpen(true)} />
        <main className="main-content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
