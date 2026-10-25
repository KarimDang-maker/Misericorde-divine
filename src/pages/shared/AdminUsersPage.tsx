import { useCallback, useEffect, useState, type FormEvent } from "react"
import { Navigate } from "react-router"
import { apiGet, apiPatch, apiPost, apiPut, type ApiError } from "@/api/httpClient"
import { useAuth } from "@/auth/AuthProvider"
import { Button } from "@/components/ui/Button"

type ManagedUser = { id: number; email: string; nom: string; role: "admin" | "gestionnaire"; actif: boolean; createdAt: string }

export function AdminUsersPage() {
  const { user } = useAuth()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [form, setForm] = useState({ email: "", nom: "", motDePasse: "", role: "gestionnaire" as ManagedUser["role"] })
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try { const result = await apiGet<ManagedUser[]>("/admin/users", { limit: 100 }); setUsers(result.data); setError("") }
    catch (cause) { setError((cause as ApiError).message) }
  }, [])
  useEffect(() => { if (user?.role === "admin") void load() }, [user, load])
  if (user?.role !== "admin") return <Navigate to="/" replace />

  const create = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("")
    try {
      await apiPost("/admin/users", form)
      setForm({ email: "", nom: "", motDePasse: "", role: "gestionnaire" })
      await load()
    } catch (cause) { setError((cause as ApiError).message) }
    finally { setBusy(false) }
  }
  const update = async (managed: ManagedUser, patch: Partial<ManagedUser>) => {
    setBusy(true); setError("")
    try { await apiPut(`/admin/users/${managed.id}`, patch); await load() }
    catch (cause) { setError((cause as ApiError).message) }
    finally { setBusy(false) }
  }
  const setActive = async (managed: ManagedUser) => {
    if (!window.confirm(`${managed.actif ? "Désactiver" : "Réactiver"} le compte de ${managed.nom} ?`)) return
    setBusy(true); setError("")
    try { await apiPatch(`/admin/users/${managed.id}/statut`, { actif: !managed.actif }); await load() }
    catch (cause) { setError((cause as ApiError).message) }
    finally { setBusy(false) }
  }

  return <section className="page-section">
    <header className="page-heading"><div><p className="page-intro__eyebrow">Administration</p><h1>Utilisateurs</h1><p>Gérez les accès administrateur et gestionnaire.</p></div></header>
    <section className="panel module-tools"><h2>Créer un utilisateur</h2>
      <form className="form-grid" onSubmit={create}>
        <label>Nom<input required minLength={2} maxLength={120} value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })} /></label>
        <label>Adresse e-mail<input type="email" required maxLength={190} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
        <label>Mot de passe temporaire<input type="password" required minLength={12} maxLength={200} autoComplete="new-password" value={form.motDePasse} onChange={e => setForm({ ...form, motDePasse: e.target.value })} /></label>
        <label>Rôle<select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as ManagedUser["role"] })}><option value="gestionnaire">Gestionnaire</option><option value="admin">Administrateur</option></select></label>
        <Button type="submit" disabled={busy}>Créer le compte</Button>
      </form>
    </section>
    <section className="panel module-tools"><h2>Comptes existants</h2>
      {users.map(item => <UserRow key={item.id} item={item} busy={busy} onSave={patch => update(item, patch)} onToggle={() => void setActive(item)} />)}
      {!users.length && <p>Aucun utilisateur.</p>}
    </section>
    {error && <p className="error-message" role="alert">{error}</p>}
  </section>
}

function UserRow({ item, busy, onSave, onToggle }: { item: ManagedUser; busy: boolean; onSave: (patch: Partial<ManagedUser>) => void; onToggle: () => void }) {
  const [nom, setNom] = useState(item.nom)
  const [email, setEmail] = useState(item.email)
  const [role, setRole] = useState(item.role)
  return <form className="edit-form" onSubmit={event => { event.preventDefault(); onSave({ nom, email, role }) }}>
    <label>Nom<input required minLength={2} maxLength={120} value={nom} onChange={e => setNom(e.target.value)} /></label>
    <label>E-mail<input type="email" required maxLength={190} value={email} onChange={e => setEmail(e.target.value)} /></label>
    <label>Rôle<select value={role} onChange={e => setRole(e.target.value as ManagedUser["role"])}><option value="gestionnaire">Gestionnaire</option><option value="admin">Administrateur</option></select></label>
    <span>{item.actif ? "Actif" : "Désactivé"}</span>
    <Button type="submit" variant="secondary" disabled={busy}>Enregistrer</Button>
    <Button type="button" variant="ghost" disabled={busy} onClick={onToggle}>{item.actif ? "Désactiver" : "Activer"}</Button>
  </form>
}
