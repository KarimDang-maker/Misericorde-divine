import { LogOut, Menu, Search } from "lucide-react"
import { useLocation } from "react-router"
import { navigationItems } from "@/config/navigation"
import { Button } from "@/components/ui/Button"
import { useAuth } from "@/auth/AuthProvider"

type HeaderProps = {
  onMenuOpen: () => void
}

export function Header({ onMenuOpen }: HeaderProps) {
  const { user, logout } = useAuth()
  const location = useLocation()
  const currentItem = navigationItems
    .flatMap((group) => group.items)
    .find((item) => item.path === location.pathname)

  return (
    <header className="topbar">
      <div className="topbar__title">
        <Button
          variant="ghost"
          className="topbar__menu"
          icon={<Menu aria-hidden="true" size={22} />}
          onClick={onMenuOpen}
          aria-label="Ouvrir la navigation"
        />
        <div>
          <p className="topbar__eyebrow">Espace de gestion</p>
          <h1>{currentItem?.label ?? "Page introuvable"}</h1>
        </div>
      </div>

      <div className="topbar__actions">
        <div className="quick-search" role="search">
          <Search aria-hidden="true" size={18} />
          <span>Recherche rapide</span>
          <kbd>⌘ K</kbd>
        </div>
        <div className="account">
          <div className="account__avatar">GC</div>
          <div className="account__meta">
            <strong>{user?.nom ?? "Gestionnaire"}</strong>
            <span>{user?.email}</span>
          </div>
          <Button variant="ghost" aria-label="Se déconnecter" icon={<LogOut size={18} />} onClick={() => void logout()} />
        </div>
      </div>
    </header>
  )
}
