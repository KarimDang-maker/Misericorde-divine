import { useEffect, useState, type FormEvent } from "react"
import { Link } from "react-router"
import { apiGet, type ApiError } from "@/api/httpClient"
import { Button } from "@/components/ui/Button"

type SearchItem = { categorie: string; type: string; id: number; reference: string; titre: string; detail: string | null; date: string | null; montant: number | null; statut: string | null }
type SearchResponse = { items: SearchItem[]; meta?: Record<string, unknown> }
const labels: Record<string, string> = { membres: "Membres", cotisations: "Cotisations", recettes: "Recettes", dons: "Dons", depenses: "Dépenses", justificatifs: "Justificatifs" }
const routes: Record<string, (id: number) => string> = {
  membres: id => `/membres?selection=${id}`,
  cotisations: id => `/cotisations?selection=${id}`,
  recettes: id => `/recettes?selection=${id}`,
  dons: id => `/dons?selection=${id}`,
  depenses: id => `/depenses?selection=${id}`,
  justificatifs: id => `/justificatifs?selection=${id}`,
}

export function GlobalSearchPage() {
  const [q, setQ] = useState("")
  const [categories, setCategories] = useState<string[]>([])
  const [available, setAvailable] = useState<string[]>(Object.keys(labels))
  const [dateDebut, setDateDebut] = useState("")
  const [dateFin, setDateFin] = useState("")
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [page, setPage] = useState(1)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!q.trim()) { setResult(null); return }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setBusy(true); setError("")
      try {
        const response = await apiGet<SearchItem[]>("/recherche", { q: q.trim(), ...(categories.length ? { categories: categories.join(",") } : {}), dateDebut: dateDebut || undefined, dateFin: dateFin || undefined, page, limit: 25 }, { signal: controller.signal })
        setResult({ items: response.data, meta: response.meta })
        const fromMeta = response.meta?.categoriesDisponibles
        if (Array.isArray(fromMeta)) setAvailable(fromMeta.map(String))
      } catch (cause) {
        if (!controller.signal.aborted) setError((cause as ApiError).message)
      } finally { if (!controller.signal.aborted) setBusy(false) }
    }, 250)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [q, categories, dateDebut, dateFin, page])

  const submit = (event: FormEvent) => { event.preventDefault(); setPage(1) }
  const toggle = (category: string) => { setPage(1); setCategories(current => current.includes(category) ? current.filter(item => item !== category) : [...current, category]) }
  const totalPages = Number(result?.meta?.totalPages ?? 1)

  return <div className="page">
    <section className="page-intro"><div><p className="page-intro__eyebrow">Recherche globale</p><h2>Retrouver une donnée</h2><p>La recherche et les filtres sont exécutés par le backend selon vos droits d’accès.</p></div></section>
    <section className="panel">
      <form onSubmit={submit} className="form-grid">
        <label>Recherche (2 caractères minimum)<input autoFocus value={q} onChange={event => { setQ(event.target.value); setPage(1) }} placeholder="Nom, référence, libellé…" /></label>
        <label>Depuis<input type="date" value={dateDebut} onChange={event => setDateDebut(event.target.value)} /></label>
        <label>Jusqu’au<input type="date" value={dateFin} min={dateDebut || undefined} onChange={event => setDateFin(event.target.value)} /></label>
        <Button type="submit" disabled={busy || q.trim().length < 2}>Rechercher</Button>
      </form>
      <fieldset className="search-categories"><legend>Catégories</legend>{available.map(category => <label key={category} className="search-category"><input type="checkbox" checked={!categories.length || categories.includes(category)} onChange={() => toggle(category)} />{labels[category] ?? category}</label>)}</fieldset>
      {error && <p role="alert" className="error-message">{error}</p>}
      {busy && <p role="status">Recherche en cours…</p>}
      {q.trim().length > 0 && q.trim().length < 2 && <p>Saisissez au moins deux caractères.</p>}
      {result && !busy && <>
        <p className="page-intro__eyebrow">{String(result.meta?.total ?? 0)} résultat(s)</p>
        {result.items.length === 0 ? <p className="empty-copy">Aucun résultat pour cette recherche.</p> : <div className="search-results">{result.items.map(item => <article className="search-result" key={`${item.categorie}-${item.id}`}><div><span className="page-intro__eyebrow">{labels[item.categorie] ?? item.categorie} · {item.reference}</span><h3>{item.titre}</h3><p>{item.detail || "Aucun détail complémentaire"}</p></div><div className="search-result__meta"><span>{item.date || "—"}</span>{item.montant != null && <strong>{Number(item.montant).toLocaleString("fr-FR")} FCFA</strong>}{routes[item.categorie] && <Link to={routes[item.categorie](item.id)}>Ouvrir la fiche</Link>}</div></article>)}</div>}
        {totalPages > 1 && <div className="toolbar"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Précédent</Button><span>Page {page} / {totalPages}</span><Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}>Suivant</Button></div>}
      </>}
    </section>
  </div>
}
