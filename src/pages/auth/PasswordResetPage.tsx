import { useState, type FormEvent } from "react"
import { Link, useSearchParams } from "react-router"
import { apiPost, type ApiError } from "@/api/httpClient"
import { Button } from "@/components/ui/Button"

export function PasswordResetPage({ confirm = false }: { confirm?: boolean }) {
  const [params] = useSearchParams()
  const token = params.get("token") || ""
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true); setMessage(""); setError("")
    try {
      if (confirm) {
        await apiPost("/auth/password-reset/confirm", { token, nouveauMotDePasse: password })
        setMessage("Votre mot de passe a été mis à jour. Vous pouvez vous connecter.")
      } else {
        await apiPost("/auth/password-reset/request", { email })
        setMessage("Si un compte correspond à cette adresse, les instructions de réinitialisation seront envoyées.")
      }
    } catch (cause) {
      setError((cause as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  return <main className="login-page"><form className="panel login-card" onSubmit={submit}>
    <p className="page-intro__eyebrow">Miséricorde Divine</p>
    <h1>{confirm ? "Nouveau mot de passe" : "Mot de passe oublié"}</h1>
    {confirm ? <>
      {!token && <p role="alert" className="error-message">Le lien de réinitialisation est invalide ou incomplet.</p>}
      <label>Nouveau mot de passe<input type="password" autoComplete="new-password" minLength={8} maxLength={200} required disabled={!token} value={password} onChange={e => setPassword(e.target.value)} /></label>
    </> : <label>Adresse e-mail<input type="email" autoComplete="email" required maxLength={190} value={email} onChange={e => setEmail(e.target.value)} /></label>}
    {error && <p role="alert" className="error-message">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!message && <Button type="submit" disabled={busy || (confirm && !token)}>{busy ? "Envoi…" : confirm ? "Changer le mot de passe" : "Recevoir les instructions"}</Button>}
    <Link to="/connexion">Retour à la connexion</Link>
  </form></main>
}
