import { useEffect, useState, type FormEvent } from "react"
import { apiGet, apiPost, type ApiError } from "@/api/httpClient"
import { useAuth } from "@/auth/AuthProvider"
import { Button } from "@/components/ui/Button"

type Account = { id: number; code: string; nom: string }

export function AccountAdjustmentPanel({ path, onCreated }: { path: string; onCreated: () => void }) {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ compteId: "", sens: "entree", montant: "", dateOperation: new Date().toISOString().slice(0, 10), motif: "", justificatifReference: "" })
  useEffect(() => {
    if (path === "/comptes" && user?.role === "admin") {
      void apiGet<Account[]>("/comptes", { actif: true }).then(result => setAccounts(result.data)).catch(cause => setError((cause as ApiError).message))
    }
  }, [path, user])
  if (path !== "/comptes" || user?.role !== "admin") return null
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("")
    try {
      await apiPost("/comptes/" + form.compteId + "/ajustements", { sens: form.sens, montant: form.montant, dateOperation: form.dateOperation, motif: form.motif, justificatifReference: form.justificatifReference || null })
      setForm({ ...form, montant: "", motif: "", justificatifReference: "" }); onCreated()
    } catch (cause) { setError((cause as ApiError).message) }
    finally { setBusy(false) }
  }
  return <details><summary>Ajuster le solde (administrateur)</summary><p>Chaque ajustement exige un motif et crée une écriture comptable immuable.</p><form className="form-grid" onSubmit={submit}>
    <label>Compte<select required value={form.compteId} onChange={e => setForm({ ...form, compteId: e.target.value })}><option value="">Choisir…</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.code} · {account.nom}</option>)}</select></label>
    <label>Sens<select value={form.sens} onChange={e => setForm({ ...form, sens: e.target.value })}><option value="entree">Entrée</option><option value="sortie">Sortie</option></select></label>
    <label>Montant<input type="number" min="0.01" step="0.01" required value={form.montant} onChange={e => setForm({ ...form, montant: e.target.value })} /></label>
    <label>Date<input type="date" required value={form.dateOperation} onChange={e => setForm({ ...form, dateOperation: e.target.value })} /></label>
    <label>Motif (10 caractères minimum)<input minLength={10} maxLength={500} required value={form.motif} onChange={e => setForm({ ...form, motif: e.target.value })} /></label>
    <label>Référence du justificatif (facultatif)<input maxLength={190} value={form.justificatifReference} onChange={e => setForm({ ...form, justificatifReference: e.target.value })} /></label>
    <Button type="submit" disabled={busy || !form.compteId}>{busy ? "Enregistrement…" : "Enregistrer l’ajustement"}</Button>
    {error && <p role="alert" className="error-message">{error}</p>}
  </form></details>
}
