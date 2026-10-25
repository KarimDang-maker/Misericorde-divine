import { useEffect, useState } from "react"
import { Outlet } from "react-router"
import { Header } from "./Header"
import { Sidebar } from "./Sidebar"
import { Navigate } from "react-router"
import { useAuth } from "@/auth/AuthProvider"
import { apiGet } from "@/api/httpClient"

export function AppShell() {
  const { user, loading, error } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (!user) return
    void apiGet<Record<string, unknown>>("/parametres/preferences").then(({ data }) => {
      document.documentElement.dataset.theme = String(data.theme ?? "clair")
      document.documentElement.classList.toggle("hide-money", Boolean(data.masquerMontants))
      if (data.lignesParPage) window.dispatchEvent(new CustomEvent("app:page-size", { detail: Number(data.lignesParPage) }))
    }).catch(() => {
      document.documentElement.dataset.theme = "clair"
      document.documentElement.classList.remove("hide-money")
    })
    return () => { delete document.documentElement.dataset.theme; document.documentElement.classList.remove("hide-money") }
  }, [user])

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
