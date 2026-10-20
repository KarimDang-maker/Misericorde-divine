import { useState, type FormEvent } from "react"
import { Navigate, useLocation } from "react-router"
import { useAuth } from "@/auth/AuthProvider"
import { Button } from "@/components/ui/Button"

export function LoginPage() {
  const { user, login, loading } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState(String((location.state as {error?:string}|null)?.error??""))
  const [busy, setBusy] = useState(false)
  if (user) return <Navigate to="/" replace />
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setMessage(""); try { await login(email, password) } catch (e) { setMessage((e as Error).message) } finally { setBusy(false) } }
  return <main className="login-page"><form className="panel login-card" onSubmit={submit}><p className="page-intro__eyebrow">Miséricorde Divine</p><h1>Connexion</h1><p>Connectez-vous avec votre compte gestionnaire.</p>{message && <p role="alert" className="error-message">{message}</p>}<label>Adresse e-mail<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Mot de passe<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label><Button type="submit" disabled={busy || loading}>{busy ? "Connexion…" : "Se connecter"}</Button></form></main>
}
