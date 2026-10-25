import { useCallback, useEffect, useState } from "react"
import { Navigate } from "react-router"
import { apiGet, apiPost, type ApiError } from "@/api/httpClient"
import { useAuth } from "@/auth/AuthProvider"
import { Button } from "@/components/ui/Button"

type OutboxItem = { id: number; eventType: string; aggregateId: string; recipientMasked: string; status: string; attempts: number; manualRetryCount: number; availableAt: string; sentAt: string | null; lastErrorCode: string | null; createdAt: string }
type OutboxData = { items: OutboxItem[]; meta?: Record<string, unknown> }

export function NotificationOutboxPage() {
  const { user } = useAuth()
  const [status, setStatus] = useState("")
  const [page, setPage] = useState(1)
  const [data, setData] = useState<OutboxData>({ items: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const load = useCallback(async () => {
    setBusy(true); setError("")
    try { const response = await apiGet<OutboxItem[]>("/admin/notifications/outbox", { ...(status ? { status } : {}), page, limit: 25 }); setData({ items: response.data, meta: response.meta }) }
    catch (cause) { setError((cause as ApiError).message) }
    finally { setBusy(false) }
  }, [status, page])
  useEffect(() => { if (user?.role === "admin") void load() }, [user, load])
  if (user?.role !== "admin") return <Navigate to="/" replace />
  const retry = async (id: number) => {
    if (!window.confirm(`Remettre la notification #${id} en file d’envoi ?`)) return
    setBusy(true); setError(""); setNotice("")
    try { await apiPost(`/admin/notifications/outbox/${id}/retry`); setNotice(`La notification #${id} a été remise en file.`); await load() }
    catch (cause) { setError((cause as ApiError).message) }
    finally { setBusy(false) }
  }
  const totalPages = Number(data.meta?.totalPages ?? 1)
  return <div className="page">
    <section className="page-intro"><div><p className="page-intro__eyebrow">Administration · E-mail</p><h2>File de notifications</h2><p>Les adresses sont masquées. Les contenus, jetons et clés de déduplication ne sont jamais exposés.</p></div></section>
    <section className="panel"><div className="panel__header"><h3>Notifications</h3><label>État<select value={status} onChange={event => { setStatus(event.target.value); setPage(1) }}><option value="">Tous</option><option value="pending">En attente</option><option value="processing">En cours</option><option value="sent">Envoyé</option><option value="dead">Échec définitif</option></select></label><Button variant="secondary" disabled={busy} onClick={() => void load()}>Actualiser</Button></div>
      {error && <p role="alert" className="error-message">{error}</p>}{notice && <p role="status">{notice}</p>}{busy && <p role="status">Chargement…</p>}
      {!busy && data.items.length === 0 ? <p className="empty-copy">Aucune notification pour ce filtre.</p> : <div className="table-scroll"><table><thead><tr><th>Événement</th><th>Destinataire</th><th>État</th><th>Tentatives</th><th>Dernière erreur</th><th>Créée</th><th>Action</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td>{item.eventType}<small>#{item.id} · compte {item.aggregateId}</small></td><td>{item.recipientMasked}</td><td>{item.status}</td><td>{item.attempts} · relances {item.manualRetryCount}/10</td><td>{item.lastErrorCode || "—"}</td><td>{new Date(item.createdAt).toLocaleString("fr-FR")}</td><td>{item.status === "dead" && <Button variant="secondary" disabled={busy || item.manualRetryCount >= 10} onClick={() => void retry(item.id)}>Relancer</Button>}</td></tr>)}</tbody></table></div>}
      <div className="toolbar"><span>{String(data.meta?.total ?? 0)} notification(s) · page {page} / {totalPages}</span><Button variant="secondary" disabled={page <= 1 || busy} onClick={() => setPage(value => value - 1)}>Précédent</Button><Button variant="secondary" disabled={page >= totalPages || busy} onClick={() => setPage(value => value + 1)}>Suivant</Button></div>
    </section>
  </div>
}
