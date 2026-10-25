import { Bell, ChevronLeft, HeartHandshake, ShieldCheck, X } from "lucide-react"
import { NavLink } from "react-router"
import { navigationItems } from "@/config/navigation"
import { Button } from "@/components/ui/Button"
import { useAuth } from "@/auth/AuthProvider"

type SidebarProps = {
  open: boolean
  onClose: () => void
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { user } = useAuth()
  const groups = user?.role === "admin" ? [...navigationItems, {
    label: "Administration",
    items: [
      { label: "Utilisateurs", path: "/administration/utilisateurs", icon: ShieldCheck, description: "Gestion des comptes, rôles et accès.", apiDependency: "/api/admin/users" },
      { label: "Notifications e-mail", path: "/administration/notifications", icon: Bell, description: "Supervision et relance des notifications en échec.", apiDependency: "/api/admin/notifications/outbox" },
    ],
  }] : navigationItems
  return (
    <>
      {open && (
        <div
          className="sidebar-backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`sidebar ${open ? "sidebar--open" : ""}`}
        aria-label="Navigation principale"
      >
        <div className="sidebar__brand">
          <div className="brand-mark">
            <HeartHandshake aria-hidden="true" size={25} strokeWidth={1.8} />
          </div>
          <div>
            <p className="brand-name">Miséricorde</p>
            <p className="brand-name brand-name--accent">Divine</p>
          </div>
          <Button
            variant="ghost"
            className="sidebar__close"
            icon={<X aria-hidden="true" size={20} />}
            onClick={onClose}
            aria-label="Fermer la navigation"
          />
        </div>

        <nav className="sidebar__nav">
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-group__label">{group.label}</p>
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === "/"}
                    onClick={onClose}
                    className={({ isActive }) =>
                      `nav-item ${isActive ? "nav-item--active" : ""}`
                    }
                  >
                    <Icon aria-hidden="true" size={18} strokeWidth={1.9} />
                    <span>{item.label}</span>
                  </NavLink>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="sidebar__footer-icon">
            <ChevronLeft aria-hidden="true" size={16} />
          </div>
          <div>
            <p>Interface de gestion</p>
            <span>Version de préparation</span>
          </div>
        </div>
      </aside>
    </>
  )
}
